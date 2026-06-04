import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { buildControlApi } from "./app.js";

type DbRow = Record<string, unknown>;

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function readBoundValue(sql: string, values: unknown[], pattern: RegExp) {
  const match = sql.match(pattern);
  if (!match) {
    return undefined;
  }

  return values[Number(match[1]) - 1];
}

function matchesUsageEvent(row: DbRow, sql: string, values: unknown[]) {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as DbRow)
      : {};
  const equalsChecks = [
    ["workspace_id", /workspace_id = \$(\d+)/],
    ["project_id", /project_id = \$(\d+)/],
    ["environment_id", /environment_id = \$(\d+)/],
    ["virtual_key_id", /virtual_key_id = \$(\d+)/],
    ["provider_connection_id", /provider_connection_id = \$(\d+)/],
    ["provider", /provider = \$(\d+)/],
    ["model", /model = \$(\d+)/],
    ["request_id", /request_id = \$(\d+)/],
    ["provider_request_id", /provider_request_id = \$(\d+)/],
    ["status", /status = \$(\d+)/],
  ] as const;

  for (const [column, pattern] of equalsChecks) {
    const expected = readBoundValue(sql, values, pattern);
    if (expected !== undefined && String(row[column] ?? "") !== String(expected)) {
      return false;
    }
  }

  const projectIds = readBoundValue(sql, values, /project_id = any\(\$(\d+)::uuid\[\]\)/);
  if (Array.isArray(projectIds) && !projectIds.map(String).includes(String(row.project_id ?? ""))) {
    return false;
  }

  if (sql.includes("status <> 'success'") && String(row.status ?? "") === "success") {
    return false;
  }

  const metadataPath = typeof metadata.path === "string" ? metadata.path : "";
  if (
    sql.includes("metadata ->> 'path' = '/v1/models' or metadata ->> 'path' like '/v1/models/%'") &&
    metadataPath !== "/v1/models" &&
    !metadataPath.startsWith("/v1/models/")
  ) {
    return false;
  }

  if (sql.includes("coalesce(metadata ->> 'streamed', 'false') = 'true'") && metadata.streamed !== true) {
    return false;
  }

  if (sql.includes("nullif(metadata ->> 'streamerror', '') is not null")) {
    const interrupted = metadata.streamInterrupted === true;
    const streamError = typeof metadata.streamError === "string" && metadata.streamError.trim().length > 0;
    if (!interrupted && !streamError) {
      return false;
    }
  }

  const minLatencyMs = readBoundValue(sql, values, /latency_ms >= \$(\d+)/);
  if (typeof minLatencyMs === "number") {
    const latency = typeof row.latency_ms === "number" ? row.latency_ms : null;
    if (latency === null || latency < minLatencyMs) {
      return false;
    }
  }

  const from = readBoundValue(sql, values, /created_at >= \$(\d+)/);
  if (from instanceof Date && Date.parse(String(row.created_at)) < from.getTime()) {
    return false;
  }

  const to = readBoundValue(sql, values, /created_at <= \$(\d+)/);
  if (to instanceof Date && Date.parse(String(row.created_at)) > to.getTime()) {
    return false;
  }

  const budgetPolicyId = readBoundValue(sql, values, /metadata ->> 'budgetpolicyid' = \$(\d+)/);
  if (budgetPolicyId !== undefined) {
    const metadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const blockedBudgetPolicyIds = Array.isArray(metadata.blockedBudgetPolicyIds)
      ? metadata.blockedBudgetPolicyIds.map(String)
      : [];
    const exhaustedBudgetPolicyIds = Array.isArray(metadata.exhaustedBudgetPolicyIds)
      ? metadata.exhaustedBudgetPolicyIds.map(String)
      : [];
    const matchesBudgetPolicy =
      String(metadata.budgetPolicyId ?? "") === String(budgetPolicyId) ||
      blockedBudgetPolicyIds.includes(String(budgetPolicyId)) ||
      exhaustedBudgetPolicyIds.includes(String(budgetPolicyId));

    if (!matchesBudgetPolicy) {
      return false;
    }
  }

  return true;
}

function filterUsageEvents(rows: DbRow[], sql: string, values: unknown[]) {
  return rows.filter((row) => matchesUsageEvent(row, sql, values));
}

function filterUsageForecastDaily(rows: DbRow[], sql: string, values: unknown[]) {
  const workspaceId = readBoundValue(sql, values, /workspace_id = \$(\d+)/);
  const projectId = readBoundValue(sql, values, /project_id = \$(\d+)/);
  const projectIds = readBoundValue(sql, values, /project_id = any\(\$(\d+)::uuid\[\]\)/);
  const environmentId = readBoundValue(sql, values, /environment_id = \$(\d+)/);
  const fromDate = readBoundValue(sql, values, /bucket_date >= \$(\d+)/);

  const normalizedProjectIds = Array.isArray(projectIds)
    ? projectIds.map((value) => String(value))
    : undefined;

  return rows
    .filter((row) => {
      if (workspaceId && String(row.workspace_id ?? "") !== String(workspaceId)) {
        return false;
      }

      if (projectId && String(row.project_id ?? "") !== String(projectId)) {
        return false;
      }

      if (
        normalizedProjectIds &&
        normalizedProjectIds.length &&
        !normalizedProjectIds.includes(String(row.project_id ?? ""))
      ) {
        return false;
      }

      if (environmentId && String(row.environment_id ?? "") !== String(environmentId)) {
        return false;
      }

      if (fromDate instanceof Date) {
        const bucketDate = new Date(String(row.bucket_date));
        if (Number.isNaN(bucketDate.getTime()) || bucketDate < fromDate) {
          return false;
        }
      }

      return true;
    })
    .sort((left, right) => String(left.bucket_date).localeCompare(String(right.bucket_date)));
}

function sortRowsByCreatedAtDesc(rows: DbRow[]) {
  return [...rows].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function getUsageEventTotalTokens(row: DbRow) {
  return Number(row.prompt_tokens ?? 0) + Number(row.completion_tokens ?? 0);
}

function sortUsageEvents(rows: DbRow[], sql: string) {
  if (sql.includes("order by created_at asc")) {
    return [...rows].sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  }

  if (sql.includes("order by latency_ms desc nulls last, created_at desc")) {
    return [...rows].sort((left, right) => {
      const leftLatency = typeof left.latency_ms === "number" ? left.latency_ms : Number.NEGATIVE_INFINITY;
      const rightLatency = typeof right.latency_ms === "number" ? right.latency_ms : Number.NEGATIVE_INFINITY;
      return rightLatency - leftLatency || String(right.created_at).localeCompare(String(left.created_at));
    });
  }

  if (sql.includes("order by cost_usd desc, created_at desc")) {
    return [...rows].sort((left, right) => {
      return Number(right.cost_usd ?? 0) - Number(left.cost_usd ?? 0) || String(right.created_at).localeCompare(String(left.created_at));
    });
  }

  if (sql.includes("order by (prompt_tokens + completion_tokens) desc, created_at desc")) {
    return [...rows].sort((left, right) => {
      return getUsageEventTotalTokens(right) - getUsageEventTotalTokens(left) || String(right.created_at).localeCompare(String(left.created_at));
    });
  }

  return sortRowsByCreatedAtDesc(rows);
}

function roundCostUsd(value: number) {
  return Number(value.toFixed(12));
}

function buildAggregateRows<Key extends string>(args: {
  rows: DbRow[];
  key: Key;
  compare: (
    left: { keyValue: string | null; eventCount: number; totalTokens: number; totalCostUsd: number },
    right: { keyValue: string | null; eventCount: number; totalTokens: number; totalCostUsd: number },
  ) => number;
}) {
  const grouped = new Map<
    string,
    { keyValue: string | null; eventCount: number; totalTokens: number; totalCostUsd: number }
  >();

  for (const row of args.rows) {
    const keyValue = row[args.key] === null || row[args.key] === undefined ? null : String(row[args.key]);
    const groupKey = keyValue ?? "__null__";
    const current = grouped.get(groupKey) ?? {
      keyValue,
      eventCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
    };

    current.eventCount += 1;
    current.totalTokens += Number(row.prompt_tokens ?? 0) + Number(row.completion_tokens ?? 0);
    current.totalCostUsd = roundCostUsd(current.totalCostUsd + Number(row.cost_usd ?? 0));
    grouped.set(groupKey, current);
  }

  return [...grouped.values()].sort(args.compare).map((group) => ({
    [args.key]: group.keyValue,
    event_count: String(group.eventCount),
    total_tokens: String(group.totalTokens),
    total_cost_usd: String(group.totalCostUsd),
  }));
}

function buildDailyUsageRows(rows: DbRow[]) {
  const grouped = new Map<
    string,
    {
      bucket_date: string;
      request_count: number;
      total_tokens: number;
      total_cost_usd: number;
      blocked_count: number;
      error_count: number;
    }
  >();

  for (const row of rows) {
    const bucketDate = String(row.created_at).slice(0, 10);
    const current = grouped.get(bucketDate) ?? {
      bucket_date: bucketDate,
      request_count: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      blocked_count: 0,
      error_count: 0,
    };

    current.request_count += 1;
    current.total_tokens += Number(row.prompt_tokens ?? 0) + Number(row.completion_tokens ?? 0);
    current.total_cost_usd = roundCostUsd(current.total_cost_usd + Number(row.cost_usd ?? 0));
    if (String(row.status ?? "") === "blocked") {
      current.blocked_count += 1;
    }
    if (String(row.status ?? "") === "error") {
      current.error_count += 1;
    }

    grouped.set(bucketDate, current);
  }

  return [...grouped.values()]
    .sort((left, right) => left.bucket_date.localeCompare(right.bucket_date))
    .map((row) => ({
      bucket_date: row.bucket_date,
      request_count: String(row.request_count),
      total_tokens: String(row.total_tokens),
      total_cost_usd: String(row.total_cost_usd),
      blocked_count: String(row.blocked_count),
      error_count: String(row.error_count),
    }));
}

function createUsageEventRow(overrides: Partial<DbRow> = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    workspace_id: overrides.workspace_id ?? "11111111-1111-4111-8111-111111111111",
    project_id: overrides.project_id ?? "22222222-2222-4222-8222-222222222222",
    environment_id: overrides.environment_id ?? "33333333-3333-4333-8333-333333333333",
    virtual_key_id: overrides.virtual_key_id ?? "44444444-4444-4444-8444-444444444444",
    provider_connection_id: overrides.provider_connection_id ?? "55555555-5555-4555-8555-555555555555",
    request_id: overrides.request_id ?? `req_${Math.random().toString(36).slice(2, 10)}`,
    provider_request_id: overrides.provider_request_id ?? `up_${Math.random().toString(36).slice(2, 10)}`,
    provider: overrides.provider ?? "openai",
    model: overrides.model ?? "gpt-4.1-mini",
    prompt_tokens: overrides.prompt_tokens ?? 0,
    completion_tokens: overrides.completion_tokens ?? 0,
    cost_usd: overrides.cost_usd ?? 0,
    latency_ms: overrides.latency_ms ?? null,
    status: overrides.status ?? "success",
    metadata: overrides.metadata ?? {
      path: "/v1/chat/completions",
    },
    created_at: overrides.created_at ?? "2026-04-03T00:00:00.000Z",
  } satisfies DbRow;
}

function formatDateOnly(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

function createUsageForecastDailyRow(overrides: Partial<DbRow> = {}) {
  const bucketDate = overrides.bucket_date ?? formatDateOnly(new Date());
  const workspaceId = overrides.workspace_id ?? "11111111-1111-4111-8111-111111111111";

  return {
    id: overrides.id ?? randomUUID(),
    bucket_date: bucketDate,
    organization_id: overrides.organization_id ?? null,
    workspace_id: workspaceId,
    project_id: overrides.project_id ?? "22222222-2222-4222-8222-222222222222",
    environment_id: overrides.environment_id ?? "33333333-3333-4333-8333-333333333333",
    provider: overrides.provider ?? "openai",
    owner: overrides.owner ?? "owner@example.com",
    canonical_model: overrides.canonical_model ?? "gpt-4.1-mini",
    request_count: overrides.request_count ?? 1,
    total_prompt_tokens: overrides.total_prompt_tokens ?? 100,
    total_completion_tokens: overrides.total_completion_tokens ?? 50,
    total_tokens: overrides.total_tokens ?? 150,
    total_cost_usd: overrides.total_cost_usd ?? 0.001,
    first_event_at: overrides.first_event_at ?? `${bucketDate}T00:00:00.000Z`,
    last_event_at: overrides.last_event_at ?? `${bucketDate}T23:59:59.000Z`,
    created_at: overrides.created_at ?? `${bucketDate}T23:59:59.000Z`,
    updated_at: overrides.updated_at ?? `${bucketDate}T23:59:59.000Z`,
  };
}

function forecastRowResponse(row: DbRow) {
  return {
    id: String(row.id),
    bucketDate: String(row.bucket_date),
    organizationId: row.organization_id ? String(row.organization_id) : null,
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    provider: row.provider ? String(row.provider) : null,
    owner: row.owner ? String(row.owner) : null,
    canonicalModel: row.canonical_model ? String(row.canonical_model) : null,
    requestCount: Number(row.request_count ?? 0),
    totalPromptTokens: Number(row.total_prompt_tokens ?? 0),
    totalCompletionTokens: Number(row.total_completion_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? 0),
    firstEventAt: row.first_event_at ? String(row.first_event_at) : null,
    lastEventAt: row.last_event_at ? String(row.last_event_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

function createFakeControlApiContext(seed?: {
  usageEvents?: DbRow[];
  usageForecastDaily?: DbRow[];
}) {
  const state = {
    usageEvents: [...(seed?.usageEvents ?? [])] as DbRow[],
    usageForecastDaily: [...(seed?.usageForecastDaily ?? [])] as DbRow[],
  };

  const db = {
    async query(sql: string, values: unknown[] = []) {
      const normalized = normalizeSql(sql);

      if (normalized.includes("select * from usage_events where id = $1 limit 1")) {
        const usageEventId = String(values[0]);
        const row = state.usageEvents.find((item) => String(item.id) === usageEventId) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (normalized.includes("select count(*)::text as count from usage_events where")) {
        const filteredRows = filterUsageEvents(state.usageEvents, normalized, values);
        return {
          rowCount: 1,
          rows: [{ count: String(filteredRows.length) }],
        };
      }

      if (
        normalized.includes("select * from usage_events where") &&
        normalized.includes("order by") &&
        normalized.includes("limit $")
      ) {
        const filteredRows = sortUsageEvents(filterUsageEvents(state.usageEvents, normalized, values), normalized);
        const limit = Number(values[values.length - 2] ?? 50);
        const offset = Number(values[values.length - 1] ?? 0);
        const rows = filteredRows.slice(offset, offset + limit);
        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("to_char(date_trunc('day', created_at at time zone 'utc'), 'yyyy-mm-dd') as bucket_date")) {
        const filteredRows = filterUsageEvents(state.usageEvents, normalized, values);
        const rows = buildDailyUsageRows(filteredRows);
        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("select * from usage_forecast_daily")) {
        const filteredRows = filterUsageForecastDaily(state.usageForecastDaily, normalized, values);
        return {
          rowCount: filteredRows.length,
          rows: filteredRows,
        };
      }

      if (normalized.includes("select count(*)::text as total_events")) {
        const filteredRows = filterUsageEvents(state.usageEvents, normalized, values);
        const latencies = filteredRows
          .map((row) => row.latency_ms)
          .filter((value): value is number => typeof value === "number");
        const averageLatencyMs =
          latencies.length > 0 ? String(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null;
        return {
          rowCount: 1,
          rows: [
            {
              total_events: String(filteredRows.length),
              total_prompt_tokens: String(filteredRows.reduce((sum, row) => sum + Number(row.prompt_tokens ?? 0), 0)),
              total_completion_tokens: String(
                filteredRows.reduce((sum, row) => sum + Number(row.completion_tokens ?? 0), 0),
              ),
              total_cost_usd: String(
                roundCostUsd(filteredRows.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0)),
              ),
              average_latency_ms: averageLatencyMs,
            },
          ],
        };
      }

      if (normalized.includes("group by status")) {
        const filteredRows = filterUsageEvents(state.usageEvents, normalized, values);
        return {
          rowCount: filteredRows.length,
          rows: buildAggregateRows({
            rows: filteredRows,
            key: "status",
            compare: (left, right) => right.eventCount - left.eventCount || String(left.keyValue).localeCompare(String(right.keyValue)),
          }),
        };
      }

      if (normalized.includes("group by provider")) {
        const filteredRows = filterUsageEvents(state.usageEvents, normalized, values);
        return {
          rowCount: filteredRows.length,
          rows: buildAggregateRows({
            rows: filteredRows,
            key: "provider",
            compare: (left, right) =>
              right.totalCostUsd - left.totalCostUsd ||
              right.totalTokens - left.totalTokens ||
              right.eventCount - left.eventCount,
          }),
        };
      }

      if (normalized.includes("group by model")) {
        const filteredRows = filterUsageEvents(state.usageEvents, normalized, values);
        return {
          rowCount: filteredRows.length,
          rows: buildAggregateRows({
            rows: filteredRows,
            key: "model",
            compare: (left, right) =>
              right.totalCostUsd - left.totalCostUsd ||
              right.totalTokens - left.totalTokens ||
              right.eventCount - left.eventCount,
          }),
        };
      }

      throw new Error(`Unhandled fake DB query in usage.test.ts: ${normalized}`);
    },
  };

  return {
    state,
    context: {
      env: {
        CONTROL_API_ADMIN_TOKEN: "test-admin-token",
      },
      db,
    } as Parameters<typeof buildControlApi>[0],
  };
}

function injectAsAdmin(app: Awaited<ReturnType<typeof buildControlApi>>, options: Parameters<typeof app.inject>[0]) {
  return app.inject({
    ...options,
    headers: {
      authorization: "Bearer test-admin-token",
      ...(options.headers ?? {}),
    },
  });
}

test("usage events list route returns filtered results with computed totals", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const environmentId = "33333333-3333-4333-8333-333333333333";
  const matchingEvent = createUsageEventRow({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    workspace_id: workspaceId,
    project_id: projectId,
    environment_id: environmentId,
    provider: "openai",
    model: "gpt-4.1-mini",
    prompt_tokens: 120,
    completion_tokens: 30,
    cost_usd: 0.0012,
    latency_ms: 480,
    status: "success",
    request_id: "req_match",
    provider_request_id: "up_match",
    created_at: "2026-04-03T12:00:00.000Z",
  });
  const { context } = createFakeControlApiContext({
    usageEvents: [
      matchingEvent,
      createUsageEventRow({
        workspace_id: workspaceId,
        project_id: projectId,
        environment_id: environmentId,
        provider: "openai",
        model: "gpt-4.1",
        status: "error",
        created_at: "2026-04-03T11:00:00.000Z",
      }),
      createUsageEventRow({
        workspace_id: "99999999-9999-4999-8999-999999999999",
        created_at: "2026-04-03T10:00:00.000Z",
      }),
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "GET",
      url:
        `/v1/usage-events?workspaceId=${workspaceId}` +
        `&projectId=${projectId}` +
        `&environmentId=${environmentId}` +
        `&provider=openai` +
        `&model=gpt-4.1-mini` +
        `&status=success` +
        `&limit=10&offset=0`,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      items: [
        {
          id: matchingEvent.id,
          workspaceId,
          projectId,
          environmentId,
          virtualKeyId: matchingEvent.virtual_key_id,
          providerConnectionId: matchingEvent.provider_connection_id,
          requestId: "req_match",
          providerRequestId: "up_match",
          provider: "openai",
          model: "gpt-4.1-mini",
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150,
          costUsd: 0.0012,
          latencyMs: 480,
          status: "success",
          metadata: {
            path: "/v1/chat/completions",
          },
          createdAt: "2026-04-03T12:00:00.000Z",
        },
      ],
      total: 1,
    });
  } finally {
    await app.close();
  }
});

test("usage routes support attention and surface filters", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const interruptedEvent = createUsageEventRow({
    id: "abababab-abab-4bab-8bab-abababababab",
    workspace_id: workspaceId,
    status: "error",
    metadata: {
      path: "/v1/chat/completions",
      streamed: true,
      streamInterrupted: true,
      streamError: "Premature close",
    },
    created_at: "2026-04-03T12:00:00.000Z",
  });
  const metadataEvent = createUsageEventRow({
    id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
    workspace_id: workspaceId,
    status: "success",
    metadata: {
      path: "/v1/models",
      protocol: "openai-compatible",
    },
    created_at: "2026-04-03T11:00:00.000Z",
  });
  const successEvent = createUsageEventRow({
    id: "efefefef-efef-4fef-8fef-efefefefefef",
    workspace_id: workspaceId,
    status: "success",
    metadata: {
      path: "/v1/chat/completions",
    },
    created_at: "2026-04-03T10:00:00.000Z",
  });
  const { context } = createFakeControlApiContext({
    usageEvents: [interruptedEvent, metadataEvent, successEvent],
  });
  const app = await buildControlApi(context);

  try {
    const listResponse = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/usage-events?workspaceId=${workspaceId}&statusGroup=attention&surface=interrupted&limit=10&offset=0`,
    });

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().total, 1);
    assert.equal(listResponse.json().items[0]?.id, interruptedEvent.id);

    const summaryResponse = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/usage-events/summary?workspaceId=${workspaceId}&surface=metadata`,
    });

    assert.equal(summaryResponse.statusCode, 200);
    assert.deepEqual(summaryResponse.json(), {
      totalEvents: 1,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      averageLatencyMs: null,
      successRate: 1,
      statusBreakdown: [
        {
          status: "success",
          eventCount: 1,
          totalTokens: 0,
          totalCostUsd: 0,
        },
      ],
      providerBreakdown: [
        {
          provider: "openai",
          eventCount: 1,
          totalTokens: 0,
          totalCostUsd: 0,
        },
      ],
      modelBreakdown: [
        {
          model: "gpt-4.1-mini",
          eventCount: 1,
          totalTokens: 0,
          totalCostUsd: 0,
        },
      ],
    });
  } finally {
    await app.close();
  }
});

test("usage routes support latency floor filters and alternative sorting", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const fastestEvent = createUsageEventRow({
    id: "12121212-1212-4212-8212-121212121212",
    workspace_id: workspaceId,
    latency_ms: 240,
    cost_usd: 0.002,
    prompt_tokens: 50,
    completion_tokens: 20,
    created_at: "2026-04-03T12:00:00.000Z",
  });
  const slowestEvent = createUsageEventRow({
    id: "34343434-3434-4434-8434-343434343434",
    workspace_id: workspaceId,
    latency_ms: 1800,
    cost_usd: 0.001,
    prompt_tokens: 30,
    completion_tokens: 10,
    created_at: "2026-04-03T11:00:00.000Z",
  });
  const costlyEvent = createUsageEventRow({
    id: "56565656-5656-4656-8656-565656565656",
    workspace_id: workspaceId,
    latency_ms: 900,
    cost_usd: 0.01,
    prompt_tokens: 800,
    completion_tokens: 200,
    created_at: "2026-04-03T10:00:00.000Z",
  });
  const { context } = createFakeControlApiContext({
    usageEvents: [fastestEvent, slowestEvent, costlyEvent],
  });
  const app = await buildControlApi(context);

  try {
    const listResponse = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/usage-events?workspaceId=${workspaceId}&minLatencyMs=500&sortBy=latency_desc&limit=10&offset=0`,
    });

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().total, 2);
    assert.deepEqual(
      listResponse.json().items.map((item: { id: string }) => item.id),
      [slowestEvent.id, costlyEvent.id],
    );

    const summaryResponse = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/usage-events/summary?workspaceId=${workspaceId}&minLatencyMs=500`,
    });

    assert.equal(summaryResponse.statusCode, 200);
    assert.equal(summaryResponse.json().totalEvents, 2);
    assert.equal(summaryResponse.json().averageLatencyMs, 1350);
  } finally {
    await app.close();
  }
});

test("usage summary and detail routes expose aggregate metrics and individual events", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const successEvent = createUsageEventRow({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workspace_id: workspaceId,
    provider: "openai",
    model: "gpt-4.1-mini",
    prompt_tokens: 120,
    completion_tokens: 30,
    cost_usd: 0.0012,
    latency_ms: 200,
    status: "success",
    created_at: "2026-04-03T12:00:00.000Z",
  });
  const errorEvent = createUsageEventRow({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    workspace_id: workspaceId,
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    prompt_tokens: 80,
    completion_tokens: 5,
    cost_usd: 0.0004,
    latency_ms: 600,
    status: "error",
    created_at: "2026-04-03T11:00:00.000Z",
  });
  const blockedEvent = createUsageEventRow({
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    workspace_id: workspaceId,
    provider: "openai",
    model: "gpt-4.1",
    prompt_tokens: 0,
    completion_tokens: 0,
    cost_usd: 0,
    latency_ms: null,
    status: "blocked",
    created_at: "2026-04-03T10:00:00.000Z",
  });
  const { context } = createFakeControlApiContext({
    usageEvents: [
      successEvent,
      errorEvent,
      blockedEvent,
      createUsageEventRow({
        workspace_id: "99999999-9999-4999-8999-999999999999",
        prompt_tokens: 999,
        completion_tokens: 999,
        cost_usd: 9.99,
        created_at: "2026-04-03T09:00:00.000Z",
      }),
    ],
  });
  const app = await buildControlApi(context);

  try {
    const summaryResponse = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/usage-events/summary?workspaceId=${workspaceId}`,
    });

    assert.equal(summaryResponse.statusCode, 200);
    assert.deepEqual(summaryResponse.json(), {
      totalEvents: 3,
      totalPromptTokens: 200,
      totalCompletionTokens: 35,
      totalTokens: 235,
      totalCostUsd: 0.0016,
      averageLatencyMs: 400,
      successRate: 0.3333,
      statusBreakdown: [
        {
          status: "blocked",
          eventCount: 1,
          totalTokens: 0,
          totalCostUsd: 0,
        },
        {
          status: "error",
          eventCount: 1,
          totalTokens: 85,
          totalCostUsd: 0.0004,
        },
        {
          status: "success",
          eventCount: 1,
          totalTokens: 150,
          totalCostUsd: 0.0012,
        },
      ],
      providerBreakdown: [
        {
          provider: "openai",
          eventCount: 2,
          totalTokens: 150,
          totalCostUsd: 0.0012,
        },
        {
          provider: "anthropic",
          eventCount: 1,
          totalTokens: 85,
          totalCostUsd: 0.0004,
        },
      ],
      modelBreakdown: [
        {
          model: "gpt-4.1-mini",
          eventCount: 1,
          totalTokens: 150,
          totalCostUsd: 0.0012,
        },
        {
          model: "claude-sonnet-4-20250514",
          eventCount: 1,
          totalTokens: 85,
          totalCostUsd: 0.0004,
        },
        {
          model: "gpt-4.1",
          eventCount: 1,
          totalTokens: 0,
          totalCostUsd: 0,
        },
      ],
    });

    const detailResponse = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/usage-events/${errorEvent.id}`,
    });

    assert.equal(detailResponse.statusCode, 200);
    assert.deepEqual(detailResponse.json(), {
      id: errorEvent.id,
      workspaceId,
      projectId: String(errorEvent.project_id),
      environmentId: String(errorEvent.environment_id),
      virtualKeyId: String(errorEvent.virtual_key_id),
      providerConnectionId: String(errorEvent.provider_connection_id),
      requestId: String(errorEvent.request_id),
      providerRequestId: String(errorEvent.provider_request_id),
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      promptTokens: 80,
      completionTokens: 5,
      totalTokens: 85,
      costUsd: 0.0004,
      latencyMs: 600,
      status: "error",
      metadata: {
        path: "/v1/chat/completions",
      },
      createdAt: "2026-04-03T11:00:00.000Z",
    });

    const missingResponse = await injectAsAdmin(app, {
      method: "GET",
      url: "/v1/usage-events/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });

    assert.equal(missingResponse.statusCode, 404);
    assert.deepEqual(missingResponse.json(), {
      error: {
        message: "Usage event not found",
      },
    });
  } finally {
    await app.close();
  }
});

test("usage daily route aggregates bucketed usage events", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setUTCDate(today.getUTCDate() - 1);
  const firstBucketDate = formatDateOnly(yesterday);
  const secondBucketDate = formatDateOnly(today);
  const firstBucketEvent = createUsageEventRow({
    created_at: `${firstBucketDate}T10:00:00.000Z`,
    workspace_id: workspaceId,
    prompt_tokens: 120,
    completion_tokens: 30,
    cost_usd: 0.0012,
    status: "success",
  });
  const secondBucketSuccessEvent = createUsageEventRow({
    created_at: `${secondBucketDate}T09:00:00.000Z`,
    workspace_id: workspaceId,
    prompt_tokens: 90,
    completion_tokens: 10,
    cost_usd: 0.0008,
    status: "success",
  });
  const secondBucketBlockedEvent = createUsageEventRow({
    created_at: `${secondBucketDate}T11:00:00.000Z`,
    workspace_id: workspaceId,
    prompt_tokens: 10,
    completion_tokens: 0,
    cost_usd: 0,
    status: "blocked",
  });
  const extraBucketEvent = createUsageEventRow({
    created_at: `${firstBucketDate}T08:00:00.000Z`,
    workspace_id: "99999999-9999-4999-8999-999999999999",
    prompt_tokens: 999,
    completion_tokens: 999,
    cost_usd: 9.99,
  });
  const { context } = createFakeControlApiContext({
    usageEvents: [firstBucketEvent, secondBucketSuccessEvent, secondBucketBlockedEvent, extraBucketEvent],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/usage-events/daily?workspaceId=${workspaceId}&window=7`,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      window: 7,
      items: [
        {
          bucketDate: firstBucketDate,
          requestCount: 1,
          totalTokens: 150,
          totalCostUsd: 0.0012,
          blockedCount: 0,
          errorCount: 0,
        },
        {
          bucketDate: secondBucketDate,
          requestCount: 2,
          totalTokens: 110,
          totalCostUsd: 0.0008,
          blockedCount: 1,
          errorCount: 0,
        },
      ],
    });
  } finally {
    await app.close();
  }
});

test("usage routes honor budget policy filters across direct and grouped budget metadata", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const budgetPolicyId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const matchingDirectEvent = createUsageEventRow({
    id: "abababab-abab-4bab-8bab-abababababab",
    workspace_id: workspaceId,
    status: "blocked",
    metadata: {
      reason: "budget_hard_limit_exceeded",
      budgetPolicyId,
    },
    created_at: "2026-04-03T12:00:00.000Z",
  });
  const matchingGroupedEvent = createUsageEventRow({
    id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
    workspace_id: workspaceId,
    status: "blocked",
    metadata: {
      reason: "budget_preflight_estimate_exceeds_remaining_headroom",
      blockedBudgetPolicyIds: [budgetPolicyId],
    },
    created_at: "2026-04-03T11:00:00.000Z",
  });
  const nonMatchingEvent = createUsageEventRow({
    id: "efefefef-efef-4fef-8fef-efefefefefef",
    workspace_id: workspaceId,
    status: "blocked",
    metadata: {
      reason: "budget_hard_limit_exceeded",
      exhaustedBudgetPolicyIds: ["bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"],
    },
    created_at: "2026-04-03T10:00:00.000Z",
  });
  const { context } = createFakeControlApiContext({
    usageEvents: [matchingDirectEvent, matchingGroupedEvent, nonMatchingEvent],
  });
  const app = await buildControlApi(context);

  try {
    const listResponse = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/usage-events?workspaceId=${workspaceId}&budgetPolicyId=${budgetPolicyId}&status=blocked`,
    });

    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json().items.map((item: { id: string }) => item.id),
      [matchingDirectEvent.id, matchingGroupedEvent.id],
    );

    const summaryResponse = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/usage-events/summary?workspaceId=${workspaceId}&budgetPolicyId=${budgetPolicyId}&status=blocked`,
    });

    assert.equal(summaryResponse.statusCode, 200);
    assert.equal(summaryResponse.json().totalEvents, 2);
    assert.equal(summaryResponse.json().statusBreakdown[0]?.status, "blocked");
    assert.equal(summaryResponse.json().statusBreakdown[0]?.eventCount, 2);
  } finally {
    await app.close();
  }
});
