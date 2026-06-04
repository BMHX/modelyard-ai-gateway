import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { buildControlApi } from "./app.js";

type DbRow = Record<string, unknown>;

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function createFakeControlApiContext(seed?: {
  providerConnections?: DbRow[];
  projects?: DbRow[];
  environments?: DbRow[];
  workspaces?: DbRow[];
  revokedAfterFirstVirtualKeyReadIds?: string[];
}) {
  const state = {
    virtualKeys: [] as DbRow[],
    providerConnections: [...(seed?.providerConnections ?? [])] as DbRow[],
    projects: [...(seed?.projects ?? [])] as DbRow[],
    environments: [...(seed?.environments ?? [])] as DbRow[],
    workspaces: [...(seed?.workspaces ?? [])] as DbRow[],
    auditLogs: [] as DbRow[],
    virtualKeyReadCountById: new Map<string, number>(),
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

      if (normalized.includes("with next_job as ( select id from export_jobs where status = 'pending'")) {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      if (
        normalized.includes("select count(*)::text as total") &&
        normalized.includes("from virtual_keys") &&
        normalized.includes("where workspace_id = $1")
      ) {
        const workspaceId = String(values[0]);
        const rows = state.virtualKeys.filter((row) => String(row.workspace_id) === workspaceId);
        const now = Date.now();

        return {
          rowCount: 1,
          rows: [
            {
              total: String(rows.length),
              active_count: String(
                rows.filter((row) => {
                  const status = String(row.status ?? "");
                  const expiresAt = row.expires_at ? Date.parse(String(row.expires_at)) : null;
                  return status === "active" && (expiresAt === null || expiresAt > now);
                }).length,
              ),
              revoked_count: String(rows.filter((row) => String(row.status ?? "") === "revoked").length),
              expired_count: String(
                rows.filter((row) => {
                  const expiresAt = row.expires_at ? Date.parse(String(row.expires_at)) : null;
                  return expiresAt !== null && expiresAt <= now;
                }).length,
              ),
              never_used_count: String(rows.filter((row) => row.last_used_at === null).length),
              environment_bound_count: String(rows.filter((row) => row.environment_id !== null).length),
            },
          ],
        };
      }

      if (
        normalized.includes("select * from virtual_keys") &&
        normalized.includes("where workspace_id = $1") &&
        normalized.includes("limit $2 offset $3")
      ) {
        const workspaceId = String(values[0]);
        const limit = Number(values[1]);
        const offset = Number(values[2]);
        const rows = state.virtualKeys
          .filter((row) => String(row.workspace_id) === workspaceId)
          .sort((left, right) => {
            const getRank = (row: DbRow) => {
              const status = String(row.status ?? "");
              const expiresAt = row.expires_at ? Date.parse(String(row.expires_at)) : null;

              if (status === "active" && (expiresAt === null || expiresAt > Date.now())) {
                return 0;
              }

              if (status === "active") {
                return 1;
              }

              return 2;
            };

            const rankDiff = getRank(left) - getRank(right);
            if (rankDiff !== 0) {
              return rankDiff;
            }

            const leftSortValue = String(left.last_used_at ?? left.created_at ?? "");
            const rightSortValue = String(right.last_used_at ?? right.created_at ?? "");
            const usageDiff = rightSortValue.localeCompare(leftSortValue);
            if (usageDiff !== 0) {
              return usageDiff;
            }

            return String(left.label ?? "").localeCompare(String(right.label ?? ""));
          })
          .slice(offset, offset + limit);
        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("select * from virtual_keys where id = $1 limit 1")) {
        const virtualKeyId = String(values[0]);
        const row = state.virtualKeys.find((item) => String(item.id) === virtualKeyId) ?? null;
        const nextReadCount = (state.virtualKeyReadCountById.get(virtualKeyId) ?? 0) + 1;
        state.virtualKeyReadCountById.set(virtualKeyId, nextReadCount);

        if (
          row &&
          nextReadCount > 1 &&
          seed?.revokedAfterFirstVirtualKeyReadIds?.includes(virtualKeyId)
        ) {
          row.status = "revoked";
        }

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (normalized.includes("insert into virtual_keys")) {
        const createdAt = new Date().toISOString();
        const row = {
          id: randomUUID(),
          workspace_id: values[0],
          provider_connection_id: values[1],
          project_id: values[2],
          environment_id: values[3],
          label: values[4],
          owner: values[5] ?? null,
          team: values[6] ?? null,
          service: values[7] ?? null,
          environment: values[8],
          key_prefix: values[9],
          key_hash: values[10],
          scopes: JSON.parse(String(values[11])),
          expires_at: values[12],
          status: "active",
          last_used_at: null,
          created_at: createdAt,
        } satisfies DbRow;

        state.virtualKeys.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("update virtual_keys set status = 'revoked' where id = $1 returning *")) {
        const virtualKeyId = String(values[0]);
        const row = state.virtualKeys.find((item) => String(item.id) === virtualKeyId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.status = "revoked";
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("update virtual_keys set status = 'revoked' where id = $1")) {
        const virtualKeyId = String(values[0]);
        const row = state.virtualKeys.find((item) => String(item.id) === virtualKeyId) ?? null;
        if (row) {
          row.status = "revoked";
        }
        return {
          rowCount: row ? 1 : 0,
          rows: [],
        };
      }

      if (normalized.includes("select * from environments where id = $1 limit 1")) {
        const environmentId = String(values[0]);
        const row = state.environments.find((item) => String(item.id) === environmentId) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (normalized.includes("select * from projects where id = $1 limit 1")) {
        const projectId = String(values[0]);
        const row = state.projects.find((item) => String(item.id) === projectId) ?? null;
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

      if (normalized.includes("select * from provider_connections where id = $1 limit 1")) {
        const providerConnectionId = String(values[0]);
        const row = state.providerConnections.find((item) => String(item.id) === providerConnectionId) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
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
          created_at: new Date().toISOString(),
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

      throw new Error(`Unhandled fake DB query in virtual-keys.test.ts: ${normalized}`);
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

test("virtual key create/list/revoke flow returns token once and records audit logs", async () => {
  const workspaceId = "429ad29e-826a-4e5a-9d69-9502366d2296";
  const providerConnectionId = "3a73749d-15b7-46bd-aec4-f0f42bce4da3";
  const { state, context } = createFakeControlApiContext({
    providerConnections: [
      {
        id: providerConnectionId,
        workspace_id: workspaceId,
        provider: "anthropic",
        label: "Anthropic Primary",
        metadata: {},
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const createResponse = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/virtual-keys",
      payload: {
        workspaceId,
        providerConnectionId,
        label: "claude-code-prod",
        scopes: ["ci", "bot"],
        expiresAt: null,
      },
      headers: {
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json();
    assert.equal(created.workspaceId, workspaceId);
    assert.equal(created.providerConnectionId, providerConnectionId);
    assert.equal(created.label, "claude-code-prod");
    assert.equal(created.status, "active");
    assert.equal(created.lastUsedAt, null);
    assert.equal(created.environment, "production");
    assert.ok(created.token.startsWith("teamops_vk_"));
    assert.ok(typeof created.keyPrefix === "string" && created.keyPrefix.length > 0);

    const listResponse = await injectAsAdmin(app, {
      method: "GET",
      url: `/v1/virtual-keys?workspaceId=${workspaceId}`,
    });

    assert.equal(listResponse.statusCode, 200);
    const listed = listResponse.json() as {
      items: Array<Record<string, unknown>>;
      total: number;
      summary: {
        total: number;
        active: number;
        revoked: number;
        expired: number;
        neverUsed: number;
        environmentBound: number;
      };
    };
    assert.equal(listed.items.length, 1);
    assert.equal(listed.total, 1);
    assert.deepEqual(listed.summary, {
      total: 1,
      active: 1,
      revoked: 0,
      expired: 0,
      neverUsed: 1,
      environmentBound: 0,
    });
    assert.equal(listed.items[0]?.id, created.id);
    assert.equal(listed.items[0]?.status, "active");
    assert.equal("token" in (listed.items[0] ?? {}), false);

    const revokeResponse = await injectAsAdmin(app, {
      method: "POST",
      url: `/v1/virtual-keys/${created.id}/revoke`,
    });

    assert.equal(revokeResponse.statusCode, 200);
    const revoked = revokeResponse.json();
    assert.equal(revoked.id, created.id);
    assert.equal(revoked.status, "revoked");

    const secondCreateResponse = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/virtual-keys",
      payload: {
        workspaceId,
        providerConnectionId,
        label: "claude-code-staging",
        scopes: ["qa"],
        expiresAt: null,
      },
      headers: {
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(secondCreateResponse.statusCode, 201);
    assert.deepEqual(
      state.auditLogs.map((row) => row.action),
      [
        "virtual-key.created",
        "virtual-key.revoked",
        "workspace.onboarding.first_virtual_key_created",
        "virtual-key.created",
      ],
    );
    assert.equal(
      state.auditLogs.filter((row) => row.action === "workspace.onboarding.first_virtual_key_created").length,
      1,
    );
    assert.equal(
      state.auditLogs.find((row) => row.action === "workspace.onboarding.first_virtual_key_created")?.subject_type,
      "workspace",
    );
    assert.equal(
      state.virtualKeys.filter((row) => row.status === "revoked").length,
      1,
    );
  } finally {
    await app.close();
  }
});

test("virtual key creation accepts legacy shared provider connections from a sibling workspace in the same organization", async () => {
  const organizationId = "f5823979-86ca-4028-b5e2-949a5ed2d377";
  const sourceWorkspaceId = "2df615e6-6366-4fe4-acd6-d0f8eaa53f7f";
  const targetWorkspaceId = "b62f13f4-60d2-4bb5-83bf-75fe3a4fc40e";
  const providerConnectionId = "a823f2c6-824f-4bdd-8c5a-a24d7251d084";
  const { context } = createFakeControlApiContext({
    workspaces: [
      {
        id: sourceWorkspaceId,
        organization_id: organizationId,
        name: "Core",
        slug: "core",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: targetWorkspaceId,
        organization_id: organizationId,
        name: "Apps",
        slug: "apps",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    providerConnections: [
      {
        id: providerConnectionId,
        workspace_id: sourceWorkspaceId,
        organization_id: null,
        provider: "openai-compatible",
        label: "Shared legacy gateway",
        metadata: {
          baseUrl: "https://gateway.example.com",
        },
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const createResponse = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/virtual-keys",
      payload: {
        workspaceId: targetWorkspaceId,
        providerConnectionId,
        label: "shared-provider-key",
        scopes: ["gateway:models"],
        expiresAt: null,
      },
      headers: {
        "x-actor-type": "member",
        "x-actor-id": "ops@example.com",
      },
    });

    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json() as Record<string, unknown>;
    assert.equal(created.workspaceId, targetWorkspaceId);
    assert.equal(created.providerConnectionId, providerConnectionId);
  } finally {
    await app.close();
  }
});

test("virtual key creation infers project and runtime from environment binding", async () => {
  const workspaceId = "8a560679-fafe-4f22-aeb0-b6157c51e139";
  const providerConnectionId = "749ff693-2b5e-4a06-b04e-220882243bad";
  const projectId = "9140e80e-ecb1-4caf-bcf5-b0d435a31e0e";
  const environmentId = "45cf9dbf-c7bc-40fc-8e45-e5c0b7298cf5";
  const { context } = createFakeControlApiContext({
    providerConnections: [
      {
        id: providerConnectionId,
        workspace_id: workspaceId,
        provider: "anthropic",
        label: "Anthropic Primary",
        metadata: {},
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    environments: [
      {
        id: environmentId,
        workspace_id: workspaceId,
        project_id: projectId,
        slug: "prod",
        name: "Production",
        runtime: "staging",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/virtual-keys",
      payload: {
        workspaceId,
        providerConnectionId,
        label: "preview-key",
        environmentId,
        expiresAt: null,
      },
    });

    assert.equal(response.statusCode, 201);
    const created = response.json();
    assert.equal(created.projectId, projectId);
    assert.equal(created.environmentId, environmentId);
    assert.equal(created.environment, "staging");
  } finally {
    await app.close();
  }
});

test("virtual key creation rejects mismatched environment and project bindings", async () => {
  const workspaceId = "8585af70-5976-4787-a314-084c7d8074cc";
  const providerConnectionId = "f9c58381-34d2-4f62-9b3f-839b9271a6cf";
  const environmentProjectId = "57caa3d9-cd94-4037-ac62-68e9c4c7f709";
  const requestedProjectId = "dba4eb5c-bf55-4a34-b539-7e4e8920d59e";
  const environmentId = "038a92c1-8d78-4c88-9f93-d846ecc6eea3";
  const { context } = createFakeControlApiContext({
    providerConnections: [
      {
        id: providerConnectionId,
        workspace_id: workspaceId,
        provider: "anthropic",
        label: "Anthropic Primary",
        metadata: {},
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    projects: [
      {
        id: requestedProjectId,
        workspace_id: workspaceId,
        slug: "support",
        name: "Support",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    environments: [
      {
        id: environmentId,
        workspace_id: workspaceId,
        project_id: environmentProjectId,
        slug: "prod",
        name: "Production",
        runtime: "production",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/virtual-keys",
      payload: {
        workspaceId,
        providerConnectionId,
        label: "claude-code-prod",
        projectId: requestedProjectId,
        environmentId,
        expiresAt: null,
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: {
        message: "Selected environment does not belong to the requested project",
      },
    });
  } finally {
    await app.close();
  }
});

test("virtual key creation rejects past expiry timestamps", async () => {
  const workspaceId = "59d52dd2-8c95-4c64-8e10-a1ca688ee71d";
  const providerConnectionId = "f4bad6a8-8ac9-4d8d-a1df-f41fcd75af41";
  const { context } = createFakeControlApiContext({
    providerConnections: [
      {
        id: providerConnectionId,
        workspace_id: workspaceId,
        provider: "anthropic",
        label: "Anthropic Primary",
        metadata: {},
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/virtual-keys",
      payload: {
        workspaceId,
        providerConnectionId,
        label: "temporary-access",
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: {
        message: "expiresAt must be in the future",
      },
    });
  } finally {
    await app.close();
  }
});

test("virtual key creation normalizes reserved scopes and drops empty duplicates", async () => {
  const workspaceId = "d30b4212-7969-4dd2-a85b-cf8e7f9132c0";
  const providerConnectionId = "a4d9fd2d-408c-4f41-a72d-f927524415d3";
  const { state, context } = createFakeControlApiContext({
    providerConnections: [
      {
        id: providerConnectionId,
        workspace_id: workspaceId,
        provider: "openai",
        label: "OpenAI Primary",
        metadata: {},
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: "/v1/virtual-keys",
      payload: {
        workspaceId,
        providerConnectionId,
        label: "scoped-access",
        scopes: [" gateway:MODELS ", "", "gateway:models", "qa", "qa"],
        expiresAt: null,
      },
    });

    assert.equal(response.statusCode, 201);
    const created = response.json();
    assert.deepEqual(created.scopes, ["gateway:models", "qa"]);
    assert.deepEqual(state.virtualKeys[0]?.scopes, ["gateway:models", "qa"]);
  } finally {
    await app.close();
  }
});

test("virtual key rotation returns a new token and revokes the old key", async () => {
  const workspaceId = "d72ddfd7-c299-4b3c-a49d-1b1df1b0bf1a";
  const providerConnectionId = "ca8ef4b7-14f0-4dd9-8c6d-92ed33f0521b";
  const originalVirtualKeyId = randomUUID();
  const originalPrefix = "teamops_vk_old_prefix";
  const { state, context } = createFakeControlApiContext({
    providerConnections: [
      {
        id: providerConnectionId,
        workspace_id: workspaceId,
        provider: "anthropic",
        label: "Anthropic Primary",
        metadata: {},
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  state.virtualKeys.push({
    id: originalVirtualKeyId,
    workspace_id: workspaceId,
    provider_connection_id: providerConnectionId,
    project_id: null,
    environment_id: null,
    label: "claude-code-prod",
    environment: "production",
    key_prefix: originalPrefix,
    key_hash: "hash-old",
    scopes: ["ci"],
    expires_at: null,
    status: "active",
    last_used_at: null,
    created_at: new Date().toISOString(),
  });

  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: `/v1/virtual-keys/${originalVirtualKeyId}/rotate`,
    });

    assert.equal(response.statusCode, 201);
    const rotated = response.json();
    assert.ok(rotated.token.startsWith("teamops_vk_"));
    assert.notEqual(rotated.id, originalVirtualKeyId);
    assert.equal(rotated.providerConnectionId, providerConnectionId);
    assert.equal(rotated.label, "claude-code-prod");
    assert.equal(rotated.status, "active");

    const oldRecord = state.virtualKeys.find((item) => String(item.id) === originalVirtualKeyId);
    assert.equal(oldRecord?.status, "revoked");

    const newRecord = state.virtualKeys.find((item) => String(item.id) === rotated.id);
    assert.equal(newRecord?.status, "active");
    assert.equal(newRecord?.provider_connection_id, providerConnectionId);

    assert.equal(state.auditLogs[0]?.action, "virtual-key.rotated");
    assert.deepEqual(state.auditLogs[0]?.payload, {
      previousVirtualKeyId: originalVirtualKeyId,
      previousKeyPrefix: originalPrefix,
      nextVirtualKeyId: rotated.id,
      nextKeyPrefix: rotated.keyPrefix,
      providerConnectionId,
      requestContext: {
        requestId: "req-1",
        ip: "127.0.0.1",
        userAgent: "lightMyRequest",
      },
    });
  } finally {
    await app.close();
  }
});

test("virtual key rotation returns 409 when the key becomes inactive before the rotation lock is acquired", async () => {
  const workspaceId = "1a2ef75b-c3aa-4f9d-a2e8-2c8a83ab98fd";
  const providerConnectionId = "57b1d232-7ad9-439a-b8cb-a3ee6d9874d6";
  const originalVirtualKeyId = randomUUID();
  const { state, context } = createFakeControlApiContext({
    providerConnections: [
      {
        id: providerConnectionId,
        workspace_id: workspaceId,
        provider: "anthropic",
        label: "Anthropic Primary",
        metadata: {},
        status: "active",
        revoked_at: null,
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        last_test_status_code: null,
        last_test_latency_ms: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    revokedAfterFirstVirtualKeyReadIds: [originalVirtualKeyId],
  });
  state.virtualKeys.push({
    id: originalVirtualKeyId,
    workspace_id: workspaceId,
    provider_connection_id: providerConnectionId,
    project_id: null,
    environment_id: null,
    label: "claude-code-prod",
    environment: "production",
    key_prefix: "teamops_vk_race_prefix",
    key_hash: "hash-race",
    scopes: ["ci"],
    expires_at: null,
    status: "active",
    last_used_at: null,
    created_at: new Date().toISOString(),
  });

  const app = await buildControlApi(context);

  try {
    const response = await injectAsAdmin(app, {
      method: "POST",
      url: `/v1/virtual-keys/${originalVirtualKeyId}/rotate`,
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), {
      error: {
        message: "Virtual key is no longer active; refresh and try again",
      },
    });
    assert.equal(state.auditLogs.length, 0);
    assert.equal(state.virtualKeys.filter((item) => String(item.status) === "active").length, 0);
  } finally {
    await app.close();
  }
});
