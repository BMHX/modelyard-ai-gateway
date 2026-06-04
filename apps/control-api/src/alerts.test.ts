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

function matchesAlert(row: DbRow, environments: DbRow[], sql: string, values: unknown[]) {
  const workspaceId = readBoundValue(sql, values, /workspace_id = \$(\d+)/);
  if (workspaceId !== undefined && String(row.workspace_id) !== String(workspaceId)) {
    return false;
  }

  const status = readBoundValue(sql, values, /status = \$(\d+)/);
  if (status !== undefined && String(row.status) !== String(status)) {
    return false;
  }

  const severity = readBoundValue(sql, values, /severity = \$(\d+)/);
  if (severity !== undefined && String(row.severity) !== String(severity)) {
    return false;
  }

  const code = readBoundValue(sql, values, /code = \$(\d+)/);
  if (code !== undefined && String(row.code) !== String(code)) {
    return false;
  }

  const budgetPolicyId = readBoundValue(sql, values, /metadata ->> 'budgetpolicyid' = \$(\d+)/);
  if (budgetPolicyId !== undefined) {
    const metadataBudgetPolicyId =
      row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>).budgetPolicyId : null;
    if (String(metadataBudgetPolicyId ?? "") !== String(budgetPolicyId)) {
      return false;
    }
  }

  const environmentId = readBoundValue(sql, values, /metadata ->> 'environmentid' = \$(\d+)/);
  if (environmentId !== undefined) {
    const metadataEnvironmentId =
      row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>).environmentId : null;
    if (String(metadataEnvironmentId ?? "") !== String(environmentId)) {
      return false;
    }
  }

  const projectId = readBoundValue(sql, values, /metadata ->> 'projectid' = \$(\d+)/);
  if (projectId !== undefined) {
    const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
    const metadataProjectId = metadata.projectId;
    const metadataEnvironmentId = metadata.environmentId;
    const environment =
      metadataEnvironmentId === undefined || metadataEnvironmentId === null
        ? null
        : environments.find((item) => String(item.id) === String(metadataEnvironmentId)) ?? null;

    if (String(metadataProjectId ?? environment?.project_id ?? "") !== String(projectId)) {
      return false;
    }
  }

  return true;
}

function sortAlerts(rows: DbRow[]) {
  return [...rows].sort((left, right) => {
    const statusOrder = String(left.status) === "open" ? 0 : 1;
    const otherStatusOrder = String(right.status) === "open" ? 0 : 1;
    return statusOrder - otherStatusOrder || String(right.created_at).localeCompare(String(left.created_at));
  });
}

function createAlertRow(overrides: Partial<DbRow> = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    workspace_id: overrides.workspace_id ?? "11111111-1111-4111-8111-111111111111",
    severity: overrides.severity ?? "warning",
    code: overrides.code ?? "budget.soft-limit",
    title: overrides.title ?? "Alert title",
    body: overrides.body ?? "Alert body",
    status: overrides.status ?? "open",
    metadata: overrides.metadata ?? {},
    created_at: overrides.created_at ?? "2026-04-03T00:00:00.000Z",
    resolved_at: overrides.resolved_at ?? null,
  } satisfies DbRow;
}

function createEnvironmentRow(overrides: Partial<DbRow> = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    workspace_id: overrides.workspace_id ?? "11111111-1111-4111-8111-111111111111",
    project_id: overrides.project_id ?? "22222222-2222-4222-8222-222222222222",
    slug: overrides.slug ?? "production",
    name: overrides.name ?? "Production",
    runtime: overrides.runtime ?? "production",
    status: overrides.status ?? "active",
    created_at: overrides.created_at ?? "2026-04-01T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-01T00:00:00.000Z",
  } satisfies DbRow;
}

function createFakeControlApiContext(seed?: {
  alerts?: DbRow[];
  environments?: DbRow[];
}) {
  const state = {
    alerts: [...(seed?.alerts ?? [])] as DbRow[],
    environments: [...(seed?.environments ?? [])] as DbRow[],
  };

  const db = {
    async query(sql: string, values: unknown[] = []) {
      const normalized = normalizeSql(sql);

      if (normalized.includes("select * from alerts where") && normalized.includes("order by") && normalized.includes("created_at desc")) {
        const rows = sortAlerts(
          state.alerts.filter((row) => matchesAlert(row, state.environments, normalized, values)),
        );

        return {
          rowCount: rows.length,
          rows,
        };
      }

      throw new Error(`Unhandled fake DB query in alerts.test.ts: ${normalized}`);
    },
  };

  return {
    context: {
      env: {
        CONTROL_API_ADMIN_TOKEN: "test-admin-token",
      },
      db,
    } as Parameters<typeof buildControlApi>[0],
  };
}

test("alerts list route filters by project and environment across alert scope metadata", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const otherProjectId = "aaaaaaaa-2222-4222-8222-222222222222";
  const environmentId = "33333333-3333-4333-8333-333333333333";
  const otherEnvironmentId = "bbbbbbbb-3333-4333-8333-333333333333";

  const environmentScopedAlert = createAlertRow({
    id: "10000000-0000-4000-8000-000000000001",
    workspace_id: workspaceId,
    status: "open",
    created_at: "2026-04-03T10:00:00.000Z",
    metadata: {
      environmentId,
    },
  });
  const projectScopedAlert = createAlertRow({
    id: "10000000-0000-4000-8000-000000000002",
    workspace_id: workspaceId,
    status: "resolved",
    created_at: "2026-04-02T10:00:00.000Z",
    metadata: {
      projectId,
    },
  });
  const otherProjectAlert = createAlertRow({
    id: "10000000-0000-4000-8000-000000000003",
    workspace_id: workspaceId,
    status: "open",
    created_at: "2026-04-01T10:00:00.000Z",
    metadata: {
      environmentId: otherEnvironmentId,
    },
  });

  const { context } = createFakeControlApiContext({
    alerts: [environmentScopedAlert, projectScopedAlert, otherProjectAlert],
    environments: [
      createEnvironmentRow({
        id: environmentId,
        workspace_id: workspaceId,
        project_id: projectId,
      }),
      createEnvironmentRow({
        id: otherEnvironmentId,
        workspace_id: workspaceId,
        project_id: otherProjectId,
      }),
    ],
  });

  const app = await buildControlApi(context);
  const projectResponse = await app.inject({
    method: "GET",
    url: `/v1/alerts?workspaceId=${workspaceId}&projectId=${projectId}`,
    headers: {
      authorization: "Bearer test-admin-token",
    },
  });
  assert.equal(projectResponse.statusCode, 200);
  assert.deepEqual(
    (projectResponse.json() as { items: Array<{ id: string }> }).items.map((item) => item.id),
    [environmentScopedAlert.id, projectScopedAlert.id],
  );

  const environmentResponse = await app.inject({
    method: "GET",
    url: `/v1/alerts?workspaceId=${workspaceId}&environmentId=${environmentId}`,
    headers: {
      authorization: "Bearer test-admin-token",
    },
  });
  assert.equal(environmentResponse.statusCode, 200);
  assert.deepEqual(
    (environmentResponse.json() as { items: Array<{ id: string }> }).items.map((item) => item.id),
    [environmentScopedAlert.id],
  );

  await app.close();
});
