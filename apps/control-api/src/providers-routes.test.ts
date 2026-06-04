import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { deriveCredentialKeyFingerprint, encryptSecret } from "@teamops/database";

import { buildControlApi } from "./app.js";

type DbRow = Record<string, unknown>;

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function createTimestamp(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function createFakeControlApiContext(seed?: {
  providerConnections?: DbRow[];
  workspaces?: DbRow[];
}) {
  const state = {
    providerConnections: [...(seed?.providerConnections ?? [])] as DbRow[],
    workspaces: [...(seed?.workspaces ?? [])] as DbRow[],
    catalogModels: [] as DbRow[],
    workspaceModelAssignments: [] as DbRow[],
    auditLogs: [] as DbRow[],
  };

  const db = {
    async query(sql: string, values: unknown[] = []) {
      const normalized = normalizeSql(sql);

      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      if (normalized.includes("insert into provider_connections")) {
        const createdAt = createTimestamp();
        const workspaceId = String(values[0]);
        const workspace =
          state.workspaces.find((item) => String(item.id) === workspaceId) ?? null;
        const row = {
          id: randomUUID(),
          organization_id: workspace?.organization_id ?? null,
          workspace_id: workspaceId,
          provider: values[1],
          label: values[2],
          encrypted_api_key: values[3],
          credential_key_fingerprint: values[4],
          metadata: JSON.parse(String(values[5])),
          pricing_config: values[6] ? JSON.parse(String(values[6])) : null,
          status: "active",
          revoked_at: null,
          last_tested_at: null,
          last_test_status: null,
          last_test_error: null,
          last_test_status_code: null,
          last_test_latency_ms: null,
          created_at: createdAt,
          updated_at: createdAt,
        } satisfies DbRow;

        state.providerConnections.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("select * from provider_connections where id = $1 limit 1")) {
        const providerConnectionId = String(values[0]);
        const row = state.providerConnections.find((item) => String(item.id) === providerConnectionId) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (
        normalized.includes("select * from provider_connections") &&
        normalized.includes("where id = $1 and status = 'active'") &&
        normalized.includes("limit 1")
      ) {
        const providerConnectionId = String(values[0]);
        const row =
          state.providerConnections.find(
            (item) => String(item.id) === providerConnectionId && String(item.status) === "active",
          ) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (normalized.includes("select * from workspaces where id = $1 limit 1")) {
        const workspaceId = String(values[0]);
        const row = state.workspaces.find((item) => String(item.id) === workspaceId) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (normalized.includes("select organization_id from workspaces where id = $1 limit 1")) {
        const workspaceId = String(values[0]);
        const row = state.workspaces.find((item) => String(item.id) === workspaceId) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [{ organization_id: row.organization_id }] : [],
        };
      }

      if (normalized.includes("update provider_connections") && normalized.includes("set last_tested_at = $2::timestamptz")) {
        const providerConnectionId = String(values[0]);
        const row = state.providerConnections.find((item) => String(item.id) === providerConnectionId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.last_tested_at = values[1];
        row.last_test_status = values[2];
        row.last_test_error = values[3];
        row.last_test_status_code = values[4];
        row.last_test_latency_ms = values[5];
        row.updated_at = createTimestamp();

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("update provider_connections") && normalized.includes("updated_at = now()")) {
        const providerConnectionId = String(values.at(-1));
        const row = state.providerConnections.find((item) => String(item.id) === providerConnectionId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        if (normalized.includes("label = $1")) {
          row.label = values[0];
        }

        const metadataMatch = normalized.match(/metadata = \$(\d+)::jsonb/);
        if (metadataMatch) {
          row.metadata = JSON.parse(String(values[Number(metadataMatch[1]) - 1]));
        }

        const pricingConfigMatch = normalized.match(/pricing_config = \$(\d+)::jsonb/);
        if (pricingConfigMatch) {
          const pricingConfigIndex = Number(pricingConfigMatch[1]) - 1;
          row.pricing_config = values[pricingConfigIndex]
            ? JSON.parse(String(values[pricingConfigIndex]))
            : null;
        }

        const apiKeyMatch = normalized.match(/encrypted_api_key = \$(\d+)/);
        if (apiKeyMatch) {
          row.encrypted_api_key = values[Number(apiKeyMatch[1]) - 1];
        }

        const credentialKeyFingerprintMatch = normalized.match(/credential_key_fingerprint = \$(\d+)/);
        if (credentialKeyFingerprintMatch) {
          row.credential_key_fingerprint = values[Number(credentialKeyFingerprintMatch[1]) - 1];
        }

        row.updated_at = createTimestamp();

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("delete from provider_connection_catalog_models where provider_connection_id = $1")) {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      if (normalized.includes("insert into catalog_models")) {
        const organizationId = String(values[0]);
        const modelId = String(values[1]);
        const protocol = String(values[3]);
        const sourceProviderConnectionId = String(values[4]);
        const existing =
          state.catalogModels.find(
            (item) =>
              String(item.organization_id) === organizationId &&
              String(item.model_id) === modelId &&
              String(item.protocol) === protocol &&
              String(item.source_provider_connection_id) === sourceProviderConnectionId,
          ) ?? null;
        const row =
          existing ??
          ({
            id: randomUUID(),
            organization_id: organizationId,
            model_id: modelId,
            label: values[2],
            protocol,
            source_provider_connection_id: sourceProviderConnectionId,
            source_provider_connection_label: values[5],
            source_provider: values[6],
            status: values[7],
            created_at: createTimestamp(),
            updated_at: createTimestamp(),
          } satisfies DbRow);
        if (!existing) {
          state.catalogModels.push(row);
        } else {
          row.label = values[2];
          row.source_provider_connection_label = values[5];
          row.source_provider = values[6];
          row.status = values[7];
          row.updated_at = createTimestamp();
        }
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("insert into provider_connection_catalog_models")) {
        return {
          rowCount: 1,
          rows: [],
        };
      }

      if (normalized.includes("insert into workspace_model_assignments")) {
        const workspaceId = String(values[0]);
        const catalogModelId = String(values[1]);
        const exists = state.workspaceModelAssignments.some(
          (item) =>
            String(item.workspace_id) === workspaceId &&
            String(item.catalog_model_id) === catalogModelId,
        );
        if (!exists) {
          state.workspaceModelAssignments.push({
            workspace_id: workspaceId,
            catalog_model_id: catalogModelId,
            created_at: createTimestamp(),
          });
        }
        return {
          rowCount: 1,
          rows: [],
        };
      }

      if (normalized.includes("insert into audit_logs")) {
        const row = {
          id: randomUUID(),
          workspace_id: values[0],
          project_id: values[1],
          environment_id: values[2],
          actor_type: values[3],
          actor_id: values[4],
          action: values[5],
          subject_type: values[6],
          subject_id: values[7],
          payload: JSON.parse(String(values[8])),
          created_at: createTimestamp(),
        } satisfies DbRow;

        state.auditLogs.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (
        normalized.includes("select id from audit_logs") &&
        normalized.includes("where workspace_id = $1") &&
        normalized.includes("and action = $2") &&
        normalized.includes("limit 1")
      ) {
        const workspaceId = String(values[0]);
        const action = String(values[1]);
        const row =
          state.auditLogs.find(
            (item) => String(item.workspace_id) === workspaceId && String(item.action) === action,
          ) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [{ id: row.id }] : [],
        };
      }

      throw new Error(`Unhandled fake DB query in providers-routes.test.ts: ${normalized}`);
    },
  };

  return {
    state,
    context: {
      env: {
        CONTROL_API_ADMIN_TOKEN: "test-admin-token",
        ENCRYPTION_KEY_BASE64: Buffer.from("12345678901234567890123456789012").toString("base64"),
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

test("provider onboarding milestones are emitted once for first connect and first test", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const { state, context } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
  });
  const app = await buildControlApi(context);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input) => {
    assert.equal(String(input), "https://api.anthropic.com/v1/models");

    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    const firstCreateResponse = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/provider-connections",
      payload: {
        workspaceId,
        provider: "anthropic",
        label: "Anthropic Primary",
        apiKey: "sk-ant-test-1234",
        metadata: {},
      },
      headers: {
        authorization: "Bearer test-admin-token",
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(firstCreateResponse.statusCode, 201);
    const firstConnection = firstCreateResponse.json();
    assert.equal(firstConnection.workspaceId, workspaceId);
    assert.equal(
      state.auditLogs.filter((entry) => entry.action === "workspace.onboarding.first_provider_connected").length,
      1,
    );

    const secondCreateResponse = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/provider-connections",
      payload: {
        workspaceId,
        provider: "anthropic",
        label: "Anthropic Secondary",
        apiKey: "sk-ant-test-5678",
        metadata: {},
      },
      headers: {
        authorization: "Bearer test-admin-token",
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(secondCreateResponse.statusCode, 201);
    assert.equal(
      state.auditLogs.filter((entry) => entry.action === "workspace.onboarding.first_provider_connected").length,
      1,
    );

    const firstTestResponse = await injectAsAdmin(app, {
      method: "POST",
      url: `/v1/provider-connections/${firstConnection.id}/test`,
      headers: {
        authorization: "Bearer test-admin-token",
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(firstTestResponse.statusCode, 200);
    const firstTest = firstTestResponse.json();
    assert.equal(firstTest.ok, true);
    assert.equal(
      state.auditLogs.filter((entry) => entry.action === "workspace.onboarding.first_provider_tested").length,
      1,
    );
    assert.equal(
      state.auditLogs.find((entry) => entry.action === "workspace.onboarding.first_provider_tested")?.subject_type,
      "workspace",
    );

    const secondConnectionId = String(secondCreateResponse.json().id);
    const secondTestResponse = await injectAsAdmin(app, {
      method: "POST",
      url: `/v1/provider-connections/${secondConnectionId}/test`,
      headers: {
        authorization: "Bearer test-admin-token",
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(secondTestResponse.statusCode, 200);
    assert.equal(
      state.auditLogs.filter((entry) => entry.action === "workspace.onboarding.first_provider_tested").length,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("provider connection metadata can be updated from a sibling workspace in the same organization", async () => {
  const organizationId = "2ff5527a-3046-4182-8fb6-47d7282445e1";
  const sourceWorkspaceId = "f68780c2-0d7d-4f77-a6d6-0ea82ad5d0a4";
  const targetWorkspaceId = "46b8f685-6d95-4b8c-b063-a89479534829";
  const providerConnectionId = "387863d5-2e31-4457-a3ce-b4a07fb90c19";
  const { state, context } = createFakeControlApiContext({
    workspaces: [
      {
        id: sourceWorkspaceId,
        organization_id: organizationId,
        name: "Core",
        slug: "core",
        created_at: createTimestamp(-10_000),
        updated_at: createTimestamp(-10_000),
      },
      {
        id: targetWorkspaceId,
        organization_id: organizationId,
        name: "Apps",
        slug: "apps",
        created_at: createTimestamp(-8_000),
        updated_at: createTimestamp(-8_000),
      },
    ],
    providerConnections: [
      {
        id: providerConnectionId,
        organization_id: null,
        workspace_id: sourceWorkspaceId,
        provider: "openai-compatible",
        label: "Shared gateway",
        encrypted_api_key: "encrypted-value",
        metadata: {
          baseUrl: "https://gateway.example.com",
          modelPrefixes: "qwen-",
        },
        pricing_config: null,
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: createTimestamp(-6_000),
        updated_at: createTimestamp(-6_000),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "PATCH",
      url: `/v1/provider-connections/${providerConnectionId}?workspaceId=${targetWorkspaceId}`,
      payload: {
        metadata: {
          baseUrl: "https://gateway.example.com",
          modelPrefixes: "qwen-, deepseek-",
          models: "qwen-max, deepseek-reasoner",
        },
        pricingConfig: {
          mode: "manual",
          rules: [
            {
              matchType: "fallback",
              model: null,
              rates: {
                inputUsdPerMillion: 0.5,
                outputUsdPerMillion: 2,
                cachedInputUsdPerMillion: null,
                cacheReadInputUsdPerMillion: null,
                cacheWrite5mInputUsdPerMillion: null,
                cacheWrite1hInputUsdPerMillion: null,
                longContextThresholdInputTokens: null,
                longContextInputUsdPerMillion: null,
                longContextOutputUsdPerMillion: null,
                longContextCacheReadInputUsdPerMillion: null,
                longContextCacheWrite5mInputUsdPerMillion: null,
                longContextCacheWrite1hInputUsdPerMillion: null,
              },
            },
          ],
        },
      },
      headers: {
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(response.statusCode, 200);
    const updated = response.json() as Record<string, unknown>;
    assert.equal(updated.workspaceId, sourceWorkspaceId);
    assert.deepEqual(updated.metadata, {
      baseUrl: "https://gateway.example.com",
      modelPrefixes: "qwen-, deepseek-",
      models: "qwen-max, deepseek-reasoner",
    });
    assert.deepEqual(state.providerConnections[0]?.metadata, {
      baseUrl: "https://gateway.example.com",
      modelPrefixes: "qwen-, deepseek-",
      models: "qwen-max, deepseek-reasoner",
    });
    assert.equal((updated.pricingConfig as { mode?: string } | null)?.mode, "manual");
    assert.equal(state.auditLogs[0]?.workspace_id, targetWorkspaceId);
    assert.equal(state.auditLogs[0]?.action, "provider-connection.updated");
  } finally {
    await app.close();
  }
});

test("provider create rejects approved models without pricing coverage", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const { context } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/provider-connections",
      payload: {
        workspaceId,
        provider: "openai-compatible",
        label: "DeepSeek Cluster",
        apiKey: "sk-test-create-12345678",
        metadata: {
          baseUrl: "https://api.deepseek.com",
          "ui.modelConfig": JSON.stringify({
            version: 1,
            items: [{ id: "deepseek-v4-flash", label: "deepseek-v4-flash", source: "catalog" }],
          }),
          models: "deepseek-v4-flash",
          "routing.models": "deepseek-v4-flash",
        },
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json().error.message,
      "Selected models are missing pricing coverage: deepseek-v4-flash",
    );
  } finally {
    await app.close();
  }
});

test("provider update accepts approved models once fallback pricing is configured", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const providerConnectionId = "387863d5-2e31-4457-a3ce-b4a07fb90c19";
  const { context } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
    providerConnections: [
      {
        id: providerConnectionId,
        organization_id: null,
        workspace_id: workspaceId,
        provider: "openai-compatible",
        label: "DeepSeek Cluster",
        encrypted_api_key: "encrypted-value",
        metadata: {
          baseUrl: "https://api.deepseek.com",
          "ui.modelConfig": JSON.stringify({
            version: 1,
            items: [{ id: "deepseek-v4-flash", label: "deepseek-v4-flash", source: "catalog" }],
          }),
          models: "deepseek-v4-flash",
          "routing.models": "deepseek-v4-flash",
        },
        pricing_config: null,
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: createTimestamp(-6_000),
        updated_at: createTimestamp(-6_000),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "PATCH",
      url: `/v1/provider-connections/${providerConnectionId}?workspaceId=${workspaceId}`,
      payload: {
        pricingConfig: {
          mode: "manual",
          rules: [
            {
              matchType: "fallback",
              model: null,
              rates: {
                inputUsdPerMillion: 0.5,
                outputUsdPerMillion: 2,
                cachedInputUsdPerMillion: null,
                cacheReadInputUsdPerMillion: null,
                cacheWrite5mInputUsdPerMillion: null,
                cacheWrite1hInputUsdPerMillion: null,
                longContextThresholdInputTokens: null,
                longContextInputUsdPerMillion: null,
                longContextOutputUsdPerMillion: null,
                longContextCacheReadInputUsdPerMillion: null,
                longContextCacheWrite5mInputUsdPerMillion: null,
                longContextCacheWrite1hInputUsdPerMillion: null,
              },
            },
          ],
        },
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().pricingConfig.mode, "manual");
  } finally {
    await app.close();
  }
});

test("provider create returns a migration error when provider connection schema is behind", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const { context } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
  });
  const baseQuery = context.db.query.bind(context.db);
  context.db.query = async (sql: string, values: unknown[] = []) => {
    if (normalizeSql(sql).includes("insert into provider_connections")) {
      const error = new Error(
        'column "credential_key_fingerprint" of relation "provider_connections" does not exist',
      ) as Error & { code?: string };
      error.code = "42703";
      throw error;
    }

    return baseQuery(sql, values);
  };

  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/provider-connections",
      payload: {
        workspaceId,
        provider: "openai-compatible",
        label: "Schema drift repro",
        apiKey: "sk-test-create-12345678",
        metadata: {
          baseUrl: "https://gateway.example.com",
        },
      },
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: {
        code: "TEAMOPS_MISSING_TABLE",
        resource: "provider_connections",
        message: "Provider connections are unavailable until database migrations are up to date",
      },
    });
  } finally {
    await app.close();
  }
});

test("provider update returns a migration error when credential fingerprint column is missing", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const providerConnectionId = "387863d5-2e31-4457-a3ce-b4a07fb90c19";
  const { context } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
    providerConnections: [
      {
        id: providerConnectionId,
        organization_id: null,
        workspace_id: workspaceId,
        provider: "openai-compatible",
        label: "Shared gateway",
        encrypted_api_key: "encrypted-value",
        metadata: {
          baseUrl: "https://gateway.example.com",
        },
        pricing_config: null,
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: createTimestamp(-6_000),
        updated_at: createTimestamp(-6_000),
      },
    ],
  });
  const baseQuery = context.db.query.bind(context.db);
  context.db.query = async (sql: string, values: unknown[] = []) => {
    const normalized = normalizeSql(sql);
    if (
      normalized.includes("update provider_connections") &&
      normalized.includes("credential_key_fingerprint = $")
    ) {
      const error = new Error(
        'column "credential_key_fingerprint" of relation "provider_connections" does not exist',
      ) as Error & { code?: string };
      error.code = "42703";
      throw error;
    }

    return baseQuery(sql, values);
  };

  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "PATCH",
      url: `/v1/provider-connections/${providerConnectionId}?workspaceId=${workspaceId}`,
      payload: {
        apiKey: "sk-test-rotated-12345678",
      },
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: {
        code: "TEAMOPS_MISSING_TABLE",
        resource: "provider_connections",
        message: "Provider connections are unavailable until database migrations are up to date",
      },
    });
  } finally {
    await app.close();
  }
});

test("provider test returns a controlled error when the stored credential cannot be decrypted", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const providerConnectionId = "387863d5-2e31-4457-a3ce-b4a07fb90c19";
  const { context } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
    providerConnections: [
      {
        id: providerConnectionId,
        organization_id: null,
        workspace_id: workspaceId,
        provider: "openai-compatible",
        label: "DeepSeek Cluster",
        encrypted_api_key: encryptSecret(
          "sk-test-primary-12345678",
          Buffer.alloc(32, 7).toString("base64"),
        ),
        metadata: {
          baseUrl: "https://api.deepseek.com",
          defaultForProtocol: "openai-compatible",
        },
        pricing_config: null,
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: createTimestamp(-6_000),
        updated_at: createTimestamp(-6_000),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: `/v1/provider-connections/${providerConnectionId}/test`,
      headers: {
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(response.statusCode, 424);
    assert.equal(
      response.json().error.code,
      "PROVIDER_CONNECTION_CREDENTIAL_UNREADABLE",
    );
  } finally {
    await app.close();
  }
});

test("provider test returns a controlled error when the stored credential key fingerprint mismatches runtime", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const providerConnectionId = "387863d5-2e31-4457-a3ce-b4a07fb90c19";
  const currentEncryptionKeyBase64 = Buffer.from("12345678901234567890123456789012").toString("base64");
  const { context } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
    providerConnections: [
      {
        id: providerConnectionId,
        organization_id: null,
        workspace_id: workspaceId,
        provider: "openai-compatible",
        label: "DeepSeek Cluster",
        encrypted_api_key: encryptSecret(
          "sk-test-primary-12345678",
          currentEncryptionKeyBase64,
        ),
        credential_key_fingerprint: deriveCredentialKeyFingerprint(Buffer.alloc(32, 8).toString("base64")),
        metadata: {
          baseUrl: "https://api.deepseek.com",
          defaultForProtocol: "openai-compatible",
        },
        pricing_config: null,
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: createTimestamp(-6_000),
        updated_at: createTimestamp(-6_000),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: `/v1/provider-connections/${providerConnectionId}/test`,
      headers: {
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(response.statusCode, 424);
    assert.equal(
      response.json().error.code,
      "PROVIDER_CONNECTION_CREDENTIAL_KEY_MISMATCH",
    );
  } finally {
    await app.close();
  }
});

test("provider model catalog preview returns normalized catalog payload", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const { context, state } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
  });
  const app = await buildControlApi(context);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    assert.equal(String(input), "https://api.openai.com/v1/models");
    return new Response(
      JSON.stringify({
        data: [
          { id: "gpt-4.1-mini", owned_by: "openai" },
          { id: "gpt-4.1", owned_by: "openai" },
        ],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/provider-connections/models/preview",
      payload: {
        workspaceId,
        provider: "openai",
        label: "OpenAI public route",
        apiKey: "sk-openai-preview-12345678",
        metadata: {},
      },
      headers: {
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      providerConnectionId: null,
      fetchedAt: body.fetchedAt,
      status: "ready",
      errorCode: null,
      message: null,
      items: [
        { id: "gpt-4.1", label: "gpt-4.1", ownedBy: "openai" },
        { id: "gpt-4.1-mini", label: "gpt-4.1-mini", ownedBy: "openai" },
      ],
    });
    assert.equal(
      state.auditLogs[0]?.action,
      "provider-connection.model-catalog-previewed",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("saved provider model catalog route returns controlled error payload when upstream fetch fails", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const providerConnectionId = "387863d5-2e31-4457-a3ce-b4a07fb90c19";
  const apiKey = "sk-test-primary-12345678";
  const encryptionKeyBase64 = Buffer.from("12345678901234567890123456789012").toString("base64");
  const { context, state } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
    providerConnections: [
      {
        id: providerConnectionId,
        organization_id: null,
        workspace_id: workspaceId,
        provider: "openai-compatible",
        label: "DeepSeek Cluster",
        encrypted_api_key: encryptSecret(
          apiKey,
          encryptionKeyBase64,
        ),
        metadata: {
          baseUrl: "https://api.deepseek.com",
        },
        pricing_config: null,
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: createTimestamp(-6_000),
        updated_at: createTimestamp(-6_000),
      },
    ],
  });
  const app = await buildControlApi(context);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://api.deepseek.com/v1/models");
    assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${apiKey}`);

    return new Response(
      JSON.stringify({
        error: {
          message: "Invalid API key",
        },
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    const response = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/provider-connections/${providerConnectionId}/models`,
      headers: {
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      providerConnectionId,
      fetchedAt: body.fetchedAt,
      status: "error",
      errorCode: null,
      message: "Invalid API key",
      items: [],
    });
    assert.equal(
      state.auditLogs[0]?.action,
      "provider-connection.model-catalog-read",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("saved provider model catalog route returns structured error when the stored credential key fingerprint mismatches runtime", async () => {
  const workspaceId = "397d77d2-a478-48bb-8447-0f0d79c403ce";
  const providerConnectionId = "387863d5-2e31-4457-a3ce-b4a07fb90c19";
  const currentEncryptionKeyBase64 = Buffer.from("12345678901234567890123456789012").toString("base64");
  const { context } = createFakeControlApiContext({
    workspaces: [
      {
        id: workspaceId,
        organization_id: "7c31ea99-152b-4d68-8ca8-2d08e3d4836f",
        name: "Ops",
        slug: "ops",
        created_at: createTimestamp(-5_000),
        updated_at: createTimestamp(-5_000),
      },
    ],
    providerConnections: [
      {
        id: providerConnectionId,
        organization_id: null,
        workspace_id: workspaceId,
        provider: "openai-compatible",
        label: "DeepSeek Cluster",
        encrypted_api_key: encryptSecret(
          "sk-test-primary-12345678",
          currentEncryptionKeyBase64,
        ),
        credential_key_fingerprint: deriveCredentialKeyFingerprint(Buffer.alloc(32, 8).toString("base64")),
        metadata: {
          baseUrl: "https://api.deepseek.com",
        },
        pricing_config: null,
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: createTimestamp(-6_000),
        updated_at: createTimestamp(-6_000),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/provider-connections/${providerConnectionId}/models`,
      headers: {
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      providerConnectionId,
      fetchedAt: body.fetchedAt,
      status: "error",
      errorCode: "credential_key_mismatch",
      message:
        "The stored upstream API key for this provider connection was encrypted with a different runtime key. Re-enter the provider credential, then refresh the catalog.",
      items: [],
    });
  } finally {
    await app.close();
  }
});
