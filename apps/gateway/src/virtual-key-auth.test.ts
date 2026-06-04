import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { encryptSecret, hashVirtualKey } from "@teamops/database";

import { buildGateway } from "./app.js";

type DbRow = Record<string, unknown>;
const encryptionKeyBase64 = Buffer.alloc(32, 9).toString("base64");

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function createFakeGatewayContext(seed?: {
  virtualKeys?: DbRow[];
  providerConnections?: DbRow[];
  budgetPolicies?: DbRow[];
  alerts?: DbRow[];
}) {
  const state = {
    virtualKeys: [...(seed?.virtualKeys ?? [])] as DbRow[],
    providerConnections: [...(seed?.providerConnections ?? [])] as DbRow[],
    budgetPolicies: [...(seed?.budgetPolicies ?? [])] as DbRow[],
    alerts: [...(seed?.alerts ?? [])] as DbRow[],
    usageEvents: [] as DbRow[],
    virtualKeyLookupCount: 0,
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

      if (normalized === "select 1") {
        return {
          rowCount: 1,
          rows: [{ "?column?": 1 }],
        };
      }

      if (normalized.includes("select * from virtual_keys where key_hash = $1 limit 1")) {
        state.virtualKeyLookupCount += 1;
        const keyHash = String(values[0]);
        const row = state.virtualKeys.find((item) => String(item.key_hash) === keyHash) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (normalized.includes("select * from provider_connections where id = $1 and status = 'active' limit 1")) {
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

      if (
        normalized.includes("select pc.* from provider_connections pc") &&
        normalized.includes("inner join workspaces w on w.id = $1") &&
        normalized.includes("and pc.status = 'active'")
      ) {
        const rows = state.providerConnections.filter(
          (item) => String(item.status) === "active",
        );
        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("select * from budget_policies where workspace_id = $1 order by created_at desc")) {
        const workspaceId = String(values[0]);
        const rows = state.budgetPolicies.filter((item) => String(item.workspace_id) === workspaceId);
        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("select cm.* from workspaces w") &&
        normalized.includes("inner join catalog_models cm on cm.organization_id = w.organization_id")
      ) {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      if (normalized.includes("select * from scheduled_reports where workspace_id = $1 order by created_at desc, id desc")) {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      if (normalized.includes("select coalesce(sum(ue.cost_usd), 0) as total from usage_events ue")) {
        return {
          rowCount: 1,
          rows: [
            {
              total: state.usageEvents.reduce((sum, item) => sum + Number(item.cost_usd ?? 0), 0),
            },
          ],
        };
      }

      if (normalized.includes("count(*)::text as blocked_events") && normalized.includes("from usage_events ue")) {
        return {
          rowCount: 1,
          rows: [
            {
              blocked_events: "0",
              estimated_events: "0",
              estimated_cost_usd: "0",
            },
          ],
        };
      }

      if (normalized.includes("select * from alerts")) {
        let valueIndex = 0;
        const workspaceId = normalized.includes("workspace_id = $1") ? String(values[valueIndex++]) : null;
        const status = normalized.includes(" and status = $") ? String(values[valueIndex++]) : null;
        const severity = normalized.includes(" and severity = $") ? String(values[valueIndex++]) : null;
        const code = normalized.includes(" and code = $") ? String(values[valueIndex++]) : null;
        const budgetPolicyId = normalized.includes("metadata ->> 'budgetpolicyid' = $")
          ? String(values[valueIndex++])
          : null;

        const rows = state.alerts.filter((item) => {
          const metadata = (item.metadata as Record<string, unknown>) ?? {};

          if (workspaceId && String(item.workspace_id) !== workspaceId) {
            return false;
          }
          if (status && String(item.status) !== status) {
            return false;
          }
          if (severity && String(item.severity) !== severity) {
            return false;
          }
          if (code && String(item.code) !== code) {
            return false;
          }
          if (budgetPolicyId && String(metadata.budgetPolicyId ?? "") !== budgetPolicyId) {
            return false;
          }

          return true;
        });

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("insert into alerts")) {
        const dedupeKey = values[6] ? String(values[6]) : null;
        const metadata = JSON.parse(String(values[5])) as Record<string, unknown>;
        const existingAlert =
          dedupeKey === null ? null : state.alerts.find((item) => String(item.dedupe_key ?? "") === dedupeKey) ?? null;
        const timestamp = new Date().toISOString();

        if (existingAlert) {
          existingAlert.workspace_id = values[0];
          existingAlert.severity = values[1];
          existingAlert.code = values[2];
          existingAlert.title = values[3];
          existingAlert.body = values[4];
          existingAlert.status = "open";
          existingAlert.metadata = metadata;
          existingAlert.resolved_at = null;
          return {
            rowCount: 1,
            rows: [existingAlert],
          };
        }

        const row = {
          id: randomUUID(),
          workspace_id: values[0],
          severity: values[1],
          code: values[2],
          title: values[3],
          body: values[4],
          status: "open",
          metadata,
          dedupe_key: dedupeKey,
          created_at: timestamp,
          resolved_at: null,
        } satisfies DbRow;

        state.alerts.push(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (
        normalized.includes("update alerts set status = 'resolved', resolved_at = now()") &&
        normalized.includes("code = 'budget.pricing-unavailable'")
      ) {
        const budgetPolicyId = String(values[0]);
        const provider = String(values[1]);
        const model = String(values[2]).toLowerCase();
        const resolvedAt = new Date().toISOString();
        const rows = state.alerts.filter((item) => {
          const metadata = (item.metadata as Record<string, unknown>) ?? {};
          return (
            String(item.status) === "open" &&
            String(item.code) === "budget.pricing-unavailable" &&
            String(metadata.budgetPolicyId ?? "") === budgetPolicyId &&
            String(metadata.provider ?? "") === provider &&
            String(metadata.model ?? "").toLowerCase() === model
          );
        });

        for (const row of rows) {
          row.status = "resolved";
          row.resolved_at = resolvedAt;
        }

        return {
          rowCount: rows.length,
          rows: rows.map((row) => ({ id: row.id })),
        };
      }

      if (normalized.includes("insert into usage_events")) {
        const row = {
          id: randomUUID(),
          workspace_id: values[0],
          project_id: values[1],
          environment_id: values[2],
          virtual_key_id: values[3],
          provider_connection_id: values[4],
          request_id: values[5],
          provider_request_id: values[6],
          provider: values[7],
          model: values[8],
          prompt_tokens: values[9],
          completion_tokens: values[10],
          cost_usd: values[11],
          latency_ms: values[12],
          status: values[13],
          metadata: JSON.parse(String(values[14])),
          created_at: new Date().toISOString(),
        } satisfies DbRow;

        state.usageEvents.push(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("update virtual_keys set last_used_at = now() where id = $1")) {
        const virtualKeyId = String(values[0]);
        const row = state.virtualKeys.find((item) => String(item.id) === virtualKeyId) ?? null;
        if (row) {
          row.last_used_at = new Date().toISOString();
        }
        return {
          rowCount: row ? 1 : 0,
          rows: [],
        };
      }

      throw new Error(`Unhandled fake DB query in virtual-key-auth.test.ts: ${normalized}`);
    },
  };

  return {
    state,
    context: {
      env: {
        ENCRYPTION_KEY_BASE64: encryptionKeyBase64,
        DEMO_MODE: "0",
      },
      db,
    } as Parameters<typeof buildGateway>[0],
  };
}

function createVirtualKeyRow(args: {
  rawToken: string;
  status: "active" | "revoked";
  providerConnectionId?: string | null;
  expiresAt?: string | null;
  scopes?: string[];
}) {
  return {
    id: randomUUID(),
    workspace_id: "be926448-6d8b-4d8a-9f95-a0177e4d31dc",
    provider_connection_id: args.providerConnectionId ?? null,
    project_id: null,
    environment_id: null,
    environment: "production",
    label: "claude-code-prod",
    key_prefix: args.rawToken.slice(0, 18),
    key_hash: hashVirtualKey(args.rawToken),
    scopes: args.scopes ?? [],
    status: args.status,
    last_used_at: null,
    expires_at: args.expiresAt ?? null,
    created_at: new Date().toISOString(),
  } satisfies DbRow;
}

function createProviderConnectionRow(args: {
  id: string;
  provider: "anthropic" | "openai" | "openai-compatible";
  status?: "active" | "revoked";
  metadata?: Record<string, string>;
  pricingConfig?: Record<string, unknown> | null;
}) {
  return {
    id: args.id,
    workspace_id: "be926448-6d8b-4d8a-9f95-a0177e4d31dc",
    provider: args.provider,
    label: `${args.provider} primary`,
    encrypted_api_key: encryptSecret("provider-key-test", encryptionKeyBase64),
    metadata: args.metadata ?? {},
    pricing_config: args.pricingConfig ?? null,
    status: args.status ?? "active",
    revoked_at: args.status === "revoked" ? new Date().toISOString() : null,
    last_tested_at: null,
    last_test_status: null,
    last_test_error: null,
    last_test_status_code: null,
    last_test_latency_ms: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } satisfies DbRow;
}

function createBudgetPolicyRow(args: {
  id?: string;
  workspaceId?: string;
  projectId?: string | null;
  environmentId?: string | null;
  environment?: "development" | "staging" | "production" | null;
  monthlyUsdLimit?: number;
  softLimitPercent?: number;
  status?: "active" | "paused";
}) {
  const now = new Date().toISOString();
  return {
    id: args.id ?? randomUUID(),
    workspace_id: args.workspaceId ?? "be926448-6d8b-4d8a-9f95-a0177e4d31dc",
    project_id: args.projectId ?? null,
    environment_id: args.environmentId ?? null,
    environment: args.environment ?? null,
    monthly_usd_limit: args.monthlyUsdLimit ?? 100,
    soft_limit_percent: args.softLimitPercent ?? 80,
    status: args.status ?? "active",
    created_at: now,
    updated_at: now,
  } satisfies DbRow;
}

test("gateway returns 401 and records blocked usage for invalid virtual keys", async () => {
  const { state, context } = createFakeGatewayContext();
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: "Bearer teamops_vk_missing",
      },
      payload: {
        model: "claude-sonnet-4-20250514",
      },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      type: "error",
      error: {
        type: "authentication_error",
        code: "teamops_invalid_virtual_key",
        message: "Invalid virtual key",
      },
      request_id: response.headers["x-teamops-request-id"],
    });
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(
      String(response.headers.vary),
      /authorization/i,
    );

    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "blocked");
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).reason, "invalid_virtual_key");
    assert.equal(state.usageEvents[0]?.virtual_key_id, null);
    assert.equal(state.virtualKeyLookupCount, 1);
  } finally {
    await app.close();
  }
});

test("gateway rejects non-virtual bearer tokens before virtual key lookup", async () => {
  const { state, context } = createFakeGatewayContext();
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: "Bearer sk-provider-key",
      },
      payload: {
        model: "claude-sonnet-4-20250514",
      },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      type: "error",
      error: {
        type: "authentication_error",
        code: "teamops_invalid_virtual_key",
        message: "Invalid virtual key",
      },
      request_id: response.headers["x-teamops-request-id"],
    });

    assert.equal(state.virtualKeyLookupCount, 0);
    assert.equal(state.usageEvents.length, 1);
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).reason, "invalid_virtual_key");
  } finally {
    await app.close();
  }
});

test("gateway rejects revoked virtual keys before provider resolution and does not update last_used_at", async () => {
  const rawToken = "teamops_vk_revoked_example";
  const revokedRow = createVirtualKeyRow({
    rawToken,
    status: "revoked",
  });
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [revokedRow],
  });
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
      payload: {
        model: "claude-sonnet-4-20250514",
      },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      type: "error",
      error: {
        type: "authentication_error",
        code: "teamops_virtual_key_not_active",
        message: "Invalid virtual key",
      },
      request_id: response.headers["x-teamops-request-id"],
    });
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(
      String(response.headers.vary),
      /authorization/i,
    );

    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.virtual_key_id, revokedRow.id);
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).reason, "virtual_key_not_active");
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).virtualKeyStatus, "revoked");
    assert.equal(revokedRow.last_used_at, null);
  } finally {
    await app.close();
  }
});

test("gateway returns OpenAI-compatible auth errors on chat completions routes", async () => {
  const { state, context } = createFakeGatewayContext();
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer teamops_vk_missing",
      },
      payload: {
        model: "gpt-4.1-mini",
      },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: {
        message: "Invalid virtual key",
        type: "authentication_error",
        param: null,
        code: "teamops_invalid_virtual_key",
      },
    });

    assert.equal(response.headers["x-teamops-gateway-protocol"], "openai-compatible");
    assert.equal(state.usageEvents.length, 1);
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).reason, "invalid_virtual_key");
  } finally {
    await app.close();
  }
});

test("gateway rejects expired virtual keys before provider resolution", async () => {
  const rawToken = "teamops_vk_expired_example";
  const expiredRow = createVirtualKeyRow({
    rawToken,
    status: "active",
    providerConnectionId: "2dab1fef-14c7-4dbc-8af5-6a762e450c0c",
    expiresAt: "2020-01-01T00:00:00.000Z",
  });
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [expiredRow],
  });
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
      payload: {
        model: "claude-sonnet-4-20250514",
      },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      type: "error",
      error: {
        type: "authentication_error",
        code: "teamops_virtual_key_expired",
        message: "Invalid virtual key",
      },
      request_id: response.headers["x-teamops-request-id"],
    });

    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "blocked");
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).reason, "virtual_key_expired");
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).expiresAt, expiredRow.expires_at);
    assert.equal(expiredRow.last_used_at, null);
  } finally {
    await app.close();
  }
});

test("gateway blocks requests when reserved virtual key scopes do not include the requested route", async () => {
  const rawToken = "teamops_vk_models_only";
  const scopedVirtualKey = createVirtualKeyRow({
    rawToken,
    status: "active",
    scopes: ["gateway:models"],
  });
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [scopedVirtualKey],
  });
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
      payload: {
        model: "claude-sonnet-4-20250514",
      },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), {
      type: "error",
      error: {
        type: "permission_error",
        code: "teamops_virtual_key_scope_denied",
        message: "This virtual key is not allowed to access the requested route",
      },
      request_id: response.headers["x-teamops-request-id"],
    });

    assert.equal(scopedVirtualKey.last_used_at, null);
    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "blocked");
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).reason, "virtual_key_scope_denied");
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).requiredScope, "gateway:messages");
    assert.deepEqual((state.usageEvents[0]?.metadata as Record<string, unknown>).grantedScopes, ["gateway:models"]);
  } finally {
    await app.close();
  }
});

test("gateway blocks protocol mismatches for provider-bound virtual keys", async () => {
  const providerConnectionId = "a2da1f9c-f3cb-4d68-8dba-599cf9617a70";
  const rawToken = "teamops_vk_bound_anthropic";
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId,
      }),
    ],
    providerConnections: [
      createProviderConnectionRow({
        id: providerConnectionId,
        provider: "anthropic",
      }),
    ],
  });
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
      payload: {
        model: "gpt-4.1-mini",
      },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), {
      error: {
        message: "This virtual key is bound to a provider connection that does not support the requested protocol",
        type: "invalid_request_error",
        param: null,
        code: "teamops_virtual_key_provider_protocol_mismatch",
      },
    });

    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "blocked");
    assert.equal(
      (state.usageEvents[0]?.metadata as Record<string, unknown>).reason,
      "virtual_key_provider_protocol_mismatch",
    );
    assert.equal(
      (state.usageEvents[0]?.metadata as Record<string, unknown>).providerConnectionId,
      providerConnectionId,
    );
  } finally {
    await app.close();
  }
});

test("gateway blocks unbound virtual keys instead of falling back to workspace routing", async () => {
  const rawToken = "teamops_vk_unbound_provider";
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId: null,
      }),
    ],
    providerConnections: [],
  });
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
      payload: {
        model: "gpt-4.1-mini",
      },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), {
      error: {
        message:
          "This virtual key is not bound to an access target. Reissue or update it from Virtual Keys or Access before retrying.",
        type: "invalid_request_error",
        param: null,
        code: "teamops_virtual_key_provider_binding_required",
      },
    });

    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "blocked");
    assert.equal(
      (state.usageEvents[0]?.metadata as Record<string, unknown>).reason,
      "virtual_key_provider_binding_required",
    );
  } finally {
    await app.close();
  }
});

test("gateway exposes pricing-only configured models for unbound self-serve keys in demo mode", async () => {
  const rawToken = "teamops_vk_pricing_only_models";
  const providerConnectionId = "7b3ff8e4-06a0-4244-a3fb-aec51a5f91ee";
  const virtualKey = createVirtualKeyRow({
    rawToken,
    status: "active",
    providerConnectionId: null,
  });
  const providerConnection = createProviderConnectionRow({
    id: providerConnectionId,
    provider: "openai-compatible",
    metadata: {
      baseUrl: "https://api.deepseek.com",
      defaultForProtocol: "openai-compatible",
    },
    pricingConfig: {
      mode: "manual",
      rules: [
        {
          matchType: "canonical",
          model: "deepseek-v4-flash",
          rates: {
            inputUsdPerMillion: 0.14,
            outputUsdPerMillion: 0.28,
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
  });
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [virtualKey],
    providerConnections: [providerConnection],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json().data.map((item: { id?: string }) => item.id),
      ["deepseek-v4-flash"],
    );
    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "success");
  } finally {
    await app.close();
  }
});

test("gateway blocks models that are not approved for the bound provider connection", async () => {
  const providerConnectionId = "9d53c6b8-fbcf-4b20-a451-0677cfaf0df1";
  const rawToken = "teamops_vk_model_whitelist";
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId,
      }),
    ],
    providerConnections: [
      createProviderConnectionRow({
        id: providerConnectionId,
        provider: "openai",
        metadata: {
          models: "gpt-4.1-mini",
          "routing.models": "gpt-4.1-mini",
        },
      }),
    ],
  });
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
      payload: {
        model: "gpt-4.1",
      },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), {
      error: {
        message: "The model 'gpt-4.1' is not approved for this provider connection",
        type: "permission_error",
        param: null,
        code: "teamops_model_not_allowed_for_provider_connection",
      },
    });
    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "blocked");
    assert.equal(
      (state.usageEvents[0]?.metadata as Record<string, unknown>).requestedModel,
      "gpt-4.1",
    );
  } finally {
    await app.close();
  }
});

test("gateway allows reserved model scopes on OpenAI-compatible model list routes in demo mode", async () => {
  const rawToken = "teamops_vk_models_example";
  const providerConnectionId = "b8c3aa4d-9de4-4cb3-b69d-d8dc39b3dd58";
  const virtualKey = createVirtualKeyRow({
    rawToken,
    status: "active",
    providerConnectionId,
    scopes: ["gateway:models"],
  });
  const providerConnection = createProviderConnectionRow({
    id: providerConnectionId,
    provider: "openai",
    metadata: {
      models: "gpt-4.1-mini",
      "routing.models": "gpt-4.1-mini",
    },
  });
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [virtualKey],
    providerConnections: [providerConnection],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-teamops-gateway-protocol"], "openai-compatible");
    assert.equal(response.headers["x-teamops-provider"], "openai");
    assert.equal(response.headers["x-teamops-upstream-status"], "200");
    assert.equal(response.headers["cache-control"], "no-store");

    const payload = response.json();
    assert.equal(payload.object, "list");
    assert(Array.isArray(payload.data));
    assert.deepEqual(
      payload.data.map((item: { id?: string }) => item.id),
      ["gpt-4.1-mini"],
    );
    assert.equal(virtualKey.last_used_at !== null, true);
    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "success");
    assert.equal(state.usageEvents[0]?.provider, "openai");
    assert.equal(state.usageEvents[0]?.provider_request_id, "demo_models");
    assert.equal(state.usageEvents[0]?.model, null);
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).path, "/v1/models");
    assert.equal((state.usageEvents[0]?.metadata as Record<string, unknown>).httpStatusCode, 200);
  } finally {
    await app.close();
  }
});

test("gateway ignores unknown descriptive scopes when serving OpenAI-compatible model detail in demo mode", async () => {
  const rawToken = "teamops_vk_model_detail_example";
  const providerConnectionId = "4d8af96b-3426-4ab9-8196-0b81f7590fc0";
  const virtualKey = createVirtualKeyRow({
    rawToken,
    status: "active",
    providerConnectionId,
    scopes: ["qa"],
  });
  const providerConnection = createProviderConnectionRow({
    id: providerConnectionId,
    provider: "openai",
  });
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [virtualKey],
    providerConnections: [providerConnection],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/models/gpt-4.1-mini",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-teamops-gateway-protocol"], "openai-compatible");
    const payload = response.json();
    assert.equal(payload.id, "gpt-4.1-mini");
    assert.equal(payload.object, "model");
    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "success");
    assert.equal(state.usageEvents[0]?.model, "gpt-4.1-mini");
    assert.equal(state.usageEvents[0]?.provider_request_id, "gpt-4.1-mini");
  } finally {
    await app.close();
  }
});

test("gateway returns model_not_found for unknown OpenAI-compatible model detail in demo mode", async () => {
  const rawToken = "teamops_vk_model_missing_example";
  const providerConnectionId = "3f2d60c3-b59f-49b7-bec4-4f3d304c2f6a";
  const virtualKey = createVirtualKeyRow({
    rawToken,
    status: "active",
    providerConnectionId,
  });
  const providerConnection = createProviderConnectionRow({
    id: providerConnectionId,
    provider: "openai",
  });
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [virtualKey],
    providerConnections: [providerConnection],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/models/not-a-real-model",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.headers["x-teamops-gateway-protocol"], "openai-compatible");
    assert.equal(response.headers["x-teamops-upstream-status"], "404");
    assert.deepEqual(response.json(), {
      error: {
        message: "The model 'not-a-real-model' does not exist",
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found",
      },
    });
    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.usageEvents[0]?.status, "error");
    assert.equal(state.usageEvents[0]?.model, "not-a-real-model");
    assert.equal(state.usageEvents[0]?.provider_request_id, "not-a-real-model");
  } finally {
    await app.close();
  }
});

test("gateway records pricing-unavailable alerts per budget policy and resolves them once pricing is configured", async () => {
  const rawToken = "teamops_vk_budget_pricing_example";
  const providerConnectionId = "ff72bbcc-e75d-402c-95ce-1d917471d777";
  const budgetPolicy = createBudgetPolicyRow({
    id: "f58c3d40-43e6-4495-9467-8d4d39389c0c",
  });
  const providerConnection = createProviderConnectionRow({
    id: providerConnectionId,
    provider: "openai",
  });
  const { state, context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId,
      }),
    ],
    providerConnections: [providerConnection],
    budgetPolicies: [budgetPolicy],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const blockedResponse = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
      payload: {
        model: "gpt-budget-test",
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
    });

    assert.equal(blockedResponse.statusCode, 403);
    assert.equal(state.alerts.length, 1);
    assert.equal(state.alerts[0]?.code, "budget.pricing-unavailable");
    assert.equal(state.alerts[0]?.status, "open");
    assert.equal(
      ((state.alerts[0]?.metadata as Record<string, unknown>).budgetPolicyId),
      budgetPolicy.id,
    );

    providerConnection.metadata["pricing.gpt-budget-test.inputUsdPer1m"] = "1";
    providerConnection.metadata["pricing.gpt-budget-test.outputUsdPer1m"] = "2";

    const successResponse = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
      },
      payload: {
        model: "gpt-budget-test",
        messages: [
          {
            role: "user",
            content: "hello again",
          },
        ],
      },
    });

    assert.equal(successResponse.statusCode, 200);
    assert.equal(state.alerts.length, 1);
    assert.equal(state.alerts[0]?.status, "resolved");
  } finally {
    await app.close();
  }
});

test("gateway allows desktop app null origins outside production", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;

  const rawToken = "teamops_vk_desktop_origin_example";
  const providerConnectionId = "6f1bb1bd-0d9c-4c70-bbd9-b8e0db50930f";
  const { context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId,
      }),
    ],
    providerConnections: [
      createProviderConnectionRow({
        id: providerConnectionId,
        provider: "openai",
      }),
    ],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
        origin: "null",
        "sec-fetch-site": "cross-site",
      },
      payload: {
        model: "gpt-desktop-origin-test",
        messages: [
          {
            role: "user",
            content: "hello from cherry",
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
  }
});

test("gateway allows desktop app null origins on loopback hosts in production", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const rawToken = "teamops_vk_desktop_origin_blocked";
  const providerConnectionId = "2d5f3027-559f-4875-8c76-4e06d6b6694b";
  const { context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId,
      }),
    ],
    providerConnections: [
      createProviderConnectionRow({
        id: providerConnectionId,
        provider: "openai",
      }),
    ],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
        host: "127.0.0.1:4002",
        origin: "null",
        "sec-fetch-site": "cross-site",
      },
      payload: {
        model: "gpt-desktop-origin-test",
        messages: [
          {
            role: "user",
            content: "hello from cherry",
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
  }
});

test("gateway still blocks desktop app null origins on non-loopback hosts in production unless explicitly allowed", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.GATEWAY_CORS_ALLOWED_ORIGINS;
  process.env.NODE_ENV = "production";
  delete process.env.GATEWAY_CORS_ALLOWED_ORIGINS;

  const rawToken = "teamops_vk_desktop_origin_blocked_remote";
  const providerConnectionId = "9f0c4ae4-b9a5-45a0-b960-3a74565cf34b";
  const { context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId,
      }),
    ],
    providerConnections: [
      createProviderConnectionRow({
        id: providerConnectionId,
        provider: "openai",
      }),
    ],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
        host: "gateway.example.com",
        origin: "null",
        "sec-fetch-site": "cross-site",
      },
      payload: {
        model: "gpt-desktop-origin-test",
        messages: [
          {
            role: "user",
            content: "hello from cherry",
          },
        ],
      },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), {
      error: {
        message: "Cross-origin browser access is not allowed for this route",
      },
    });
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowedOrigins === undefined) {
      delete process.env.GATEWAY_CORS_ALLOWED_ORIGINS;
    } else {
      process.env.GATEWAY_CORS_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
    await app.close();
  }
});

test("gateway allows originless desktop-style cross-site requests outside production", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;

  const rawToken = "teamops_vk_desktop_originless_example";
  const providerConnectionId = "a86b75c4-c589-42be-b7e3-99331be08f0a";
  const { context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId,
      }),
    ],
    providerConnections: [
      createProviderConnectionRow({
        id: providerConnectionId,
        provider: "openai",
      }),
    ],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
        "sec-fetch-site": "cross-site",
      },
      payload: {
        model: "gpt-desktop-originless-test",
        messages: [
          {
            role: "user",
            content: "hello from cherry without origin",
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
  }
});

test("gateway allows originless cross-site requests on loopback hosts in production", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const rawToken = "teamops_vk_desktop_originless_loopback";
  const providerConnectionId = "1d631a8f-91bf-4ca9-a20e-3611e54353fe";
  const { context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId,
      }),
    ],
    providerConnections: [
      createProviderConnectionRow({
        id: providerConnectionId,
        provider: "openai",
      }),
    ],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
        host: "127.0.0.1:4002",
        "sec-fetch-site": "cross-site",
      },
      payload: {
        model: "gpt-desktop-originless-test",
        messages: [
          {
            role: "user",
            content: "hello from cherry without origin",
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
  }
});

test("gateway still blocks originless cross-site requests in production on non-loopback hosts", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const rawToken = "teamops_vk_desktop_originless_blocked";
  const providerConnectionId = "31d3154e-2674-4e0d-88a2-b8d173fe85d9";
  const { context } = createFakeGatewayContext({
    virtualKeys: [
      createVirtualKeyRow({
        rawToken,
        status: "active",
        providerConnectionId,
      }),
    ],
    providerConnections: [
      createProviderConnectionRow({
        id: providerConnectionId,
        provider: "openai",
      }),
    ],
  });
  context.env.DEMO_MODE = "1";
  const app = await buildGateway(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${rawToken}`,
        host: "gateway.example.com",
        "sec-fetch-site": "cross-site",
      },
      payload: {
        model: "gpt-desktop-originless-test",
        messages: [
          {
            role: "user",
            content: "hello from cherry without origin",
          },
        ],
      },
    });

    assert.equal(response.statusCode, 403);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
  }
});
