import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDatabase,
  createMember,
  createProject,
  createProviderConnection,
  revokeProviderConnection,
  resolveVirtualKey,
  createWorkspace,
  replaceMemberProjectAssignments,
  runMigrations,
  syncCatalogModelsFromProviderConnection,
} from "@teamops/database";
import type { ProviderPricingConfig } from "@teamops/contracts";

import { buildControlApi } from "./app.js";

async function createSeededApp(
  role: "developer" | "workspace_admin",
  options?: {
    providerMetadata?: Record<string, string>;
    providerKind?: "openai" | "openai-compatible" | "anthropic";
    providerApiKey?: string;
    providerPricingConfig?: ProviderPricingConfig | null;
    providerLabel?: string;
    workspaceName?: string;
  },
) {
  const db = createDatabase("pglite://memory");
  await runMigrations(db);

  const encryptionKeyBase64 = Buffer.alloc(32, 9).toString("base64");

  await db.query(
    `insert into organizations (id, slug, name) values ($1, $2, $3)`,
    ["11111111-1111-4111-8111-111111111111", "teamops", "TeamOps"],
  );

  const workspace = await createWorkspace(db, {
    organizationId: "11111111-1111-4111-8111-111111111111",
    slug: "workspace-a",
    name: options?.workspaceName ?? "Workspace A",
  });
  const project = await createProject(db, {
    workspaceId: workspace.id,
    slug: "project-a",
    name: "Project A",
  });
  const member = await createMember(db, {
    workspaceId: workspace.id,
    email: `${role}@example.com`,
    name: role,
    role,
    roles: [role],
    temporaryAccessExpiresAt: null,
  });
  await db.query(`update members set status = 'active' where id = $1`, [member.id]);
  await replaceMemberProjectAssignments(db, member.id, {
    projectIds: [project.id],
  });

  const provider = await createProviderConnection(
    db,
    {
      workspaceId: workspace.id,
      provider: options?.providerKind ?? "openai",
      label: options?.providerLabel ?? "OpenAI Primary",
      apiKey: options?.providerApiKey ?? "sk-test-primary-12345678",
      metadata:
        options?.providerMetadata ??
        {
          defaultForProtocol: "openai-compatible",
          "ui.modelConfig": JSON.stringify({
            version: 1,
            items: [{ id: "gpt-4.1-mini", label: "gpt-4.1-mini", source: "catalog" }],
          }),
          models: "gpt-4.1-mini",
          "routing.models": "gpt-4.1-mini",
        },
      pricingConfig: options?.providerPricingConfig ?? null,
    },
    encryptionKeyBase64,
  );
  await syncCatalogModelsFromProviderConnection(db, provider);

  const app = await buildControlApi({
    env: {
      CONTROL_API_ADMIN_TOKEN: "test-admin-token",
      ENCRYPTION_KEY_BASE64: encryptionKeyBase64,
    },
    db,
    valkey: {
      async get() {
        return null;
      },
      async setEx() {},
      async del() {},
      async quit() {},
    },
  } as Parameters<typeof buildControlApi>[0]);

  return {
    app,
    db,
    workspace,
    project,
    member,
    provider,
  };
}

test("developer can issue and rotate a self-serve token for an assigned project", async () => {
  const { app, db, workspace, project, member, provider } = await createSeededApp("developer");

  try {
    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: project.id,
        providerConnectionId: provider.id,
        protocol: "openai-compatible",
      },
    });

    assert.equal(issueResponse.statusCode, 201);
    const issued = issueResponse.json();
    assert.equal(issued.issuanceMode, "self_serve");
    assert.equal(issued.issuedByMemberId, member.id);
    assert.equal(issued.projectId, project.id);
    assert.equal(issued.providerConnectionId, null);
    assert.equal(typeof issued.token, "string");
    const issuedRecord = await resolveVirtualKey(db, issued.token);
    assert.deepEqual(issuedRecord?.scopes, [
      "gateway:models",
      "gateway:messages",
      "gateway:chat-completions",
      "gateway:responses",
    ]);

    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    const bootstrap = bootstrapResponse.json();
    assert.equal(bootstrap.allowed, true);
    assert.equal(bootstrap.activeTokens.length, 1);
    assert.equal(bootstrap.activeTokens[0].issuanceMode, "self_serve");
    assert.deepEqual(bootstrap.availableTargets, [
      {
        providerConnectionId: provider.id,
        label: provider.label,
        provider: provider.provider,
        protocol: "openai-compatible",
        status: "ready",
        reason: null,
        uncoveredModels: [],
      },
    ]);

    const rotateResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/${issued.id}/rotate`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(rotateResponse.statusCode, 200);
    const rotated = rotateResponse.json();
    assert.equal(rotated.issuanceMode, "self_serve");
    assert.notEqual(rotated.id, issued.id);
    assert.equal(typeof rotated.token, "string");
    const rotatedRecord = await resolveVirtualKey(db, rotated.token);
    assert.deepEqual(rotatedRecord?.scopes, [
      "gateway:models",
      "gateway:messages",
      "gateway:chat-completions",
      "gateway:responses",
    ]);
  } finally {
    await app.close();
    await db.end();
  }
});

test("self-serve bootstrap and issuance respect workspace TTL settings", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "teamops-self-serve-ttl-"));
  const previousSettingsPath = process.env.WEB_ADMIN_SETTINGS_FILE;
  const { app, db, workspace, project, member } = await createSeededApp("developer");
  process.env.WEB_ADMIN_SETTINGS_FILE = path.join(tempDir, "console-settings.json");

  await writeFile(
    process.env.WEB_ADMIN_SETTINGS_FILE,
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: "2026-04-29T00:00:00.000Z",
        workspaceDefaultsById: {
          [workspace.id]: {
            defaultVirtualKeyTtlHours: 36,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  try {
    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    assert.equal(bootstrapResponse.json().defaults.ttlHours, 36);

    const issuedAt = Date.now();
    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: project.id,
        protocol: "openai-compatible",
      },
    });

    assert.equal(issueResponse.statusCode, 201);
    const issued = issueResponse.json();
    const issuedExpiry = Date.parse(issued.expiresAt);
    assert.ok(issuedExpiry >= issuedAt + 35.9 * 60 * 60 * 1000);
    assert.ok(issuedExpiry <= issuedAt + 36.1 * 60 * 60 * 1000);

    const rotateStartedAt = Date.now();
    const rotateResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/${issued.id}/rotate`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(rotateResponse.statusCode, 200);
    const rotated = rotateResponse.json();
    const rotatedExpiry = Date.parse(rotated.expiresAt);
    assert.ok(rotatedExpiry >= rotateStartedAt + 35.9 * 60 * 60 * 1000);
    assert.ok(rotatedExpiry <= rotateStartedAt + 36.1 * 60 * 60 * 1000);
  } finally {
    process.env.WEB_ADMIN_SETTINGS_FILE = previousSettingsPath;
    await rm(tempDir, { force: true, recursive: true });
    await app.close();
    await db.end();
  }
});

test("workspace admin cannot issue self-serve tokens", async () => {
  const { app, db, workspace, project, member } = await createSeededApp("workspace_admin");

  try {
    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: project.id,
        providerConnectionId: "00000000-0000-4000-8000-000000000001",
        protocol: "openai-compatible",
      },
    });

    assert.equal(issueResponse.statusCode, 403);
    assert.equal(issueResponse.json().error.code, "SELF_SERVE_FORBIDDEN");
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap omits assigned archived projects from self-serve access", async () => {
  const { app, db, workspace, member } = await createSeededApp("developer");

  try {
    const archivedProject = await createProject(db, {
      workspaceId: workspace.id,
      slug: "project-archived",
      name: "Project Archived",
    });
    await db.query(`update projects set status = 'archived' where id = $1`, [archivedProject.id]);
    await replaceMemberProjectAssignments(db, member.id, {
      projectIds: [archivedProject.id],
    });

    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    const bootstrap = bootstrapResponse.json();
    assert.deepEqual(bootstrap.allowedProjects, []);
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap includes configured provider models for self-serve fallback", async () => {
  const { app, db, workspace, member, provider } = await createSeededApp("developer", {
    providerMetadata: {
      defaultForProtocol: "openai-compatible",
      "ui.modelConfig": JSON.stringify({
        version: 1,
        items: [
          {
            id: "deepseek-v3-custom",
            label: "DeepSeek V3 Custom",
            source: "custom",
          },
        ],
      }),
      models: "deepseek-v3-custom, qwen-max",
    },
  });

  try {
    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    const bootstrap = bootstrapResponse.json();
    assert.deepEqual(bootstrap.providerConnections, [
      {
        id: provider.id,
        label: provider.label,
        provider: provider.provider,
        configuredModels: [
          {
            id: "deepseek-v3-custom",
            label: "DeepSeek V3 Custom",
            ownedBy: null,
          },
          {
            id: "qwen-max",
            label: "qwen-max",
            ownedBy: null,
          },
        ],
      },
    ]);
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap derives ready models from manual pricing rules when explicit model metadata is missing", async () => {
  const { app, db, workspace, member, project } = await createSeededApp("developer", {
    providerMetadata: {
      defaultForProtocol: "openai-compatible",
    },
    providerPricingConfig: {
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

  try {
    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    const bootstrap = bootstrapResponse.json();
    assert.equal(bootstrap.availableSources.length, 1);
    assert.deepEqual(bootstrap.availableSources[0]?.models, [
      {
        id: "deepseek-v4-flash",
        label: "deepseek-v4-flash",
        ownedBy: null,
      },
    ]);

    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: project.id,
        protocol: "openai-compatible",
      },
    });

    assert.equal(issueResponse.statusCode, 201);
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap exposes one available source for the Agency Client Delivery glm-5 repro", async () => {
  const { app, db, workspace, member, provider } = await createSeededApp("developer", {
    workspaceName: "Agency Client Delivery",
    providerKind: "openai-compatible",
    providerLabel: "New API 中转平台",
    providerMetadata: {
      defaultForProtocol: "openai-compatible",
      baseUrl: "https://72ai.cc",
      "ui.modelConfig": JSON.stringify({
        version: 1,
        items: [{ id: "glm-5", label: "glm-5", source: "catalog" }],
      }),
      models: "glm-5",
      "routing.models": "glm-5",
    },
    providerPricingConfig: {
      mode: "manual",
      rules: [
        {
          matchType: "canonical",
          model: "glm-5",
          rates: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 1,
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

  try {
    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    const bootstrap = bootstrapResponse.json();
    assert.equal(bootstrap.availableSources.length, 1);
    assert.deepEqual(bootstrap.availableSources[0], {
      providerConnectionId: provider.id,
      label: "New API 中转平台",
      provider: "openai-compatible",
      protocol: "openai-compatible",
      models: [
        {
          id: "glm-5",
          label: "glm-5",
          ownedBy: null,
        },
      ],
    });
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap hides revoked historical sources when an active replacement serves the same model", async () => {
  const { app, db, workspace, member, provider: revokedSource } = await createSeededApp("developer", {
    providerKind: "openai-compatible",
    providerLabel: "UI Save Repro Temp 2",
    providerMetadata: {
      defaultForProtocol: "openai-compatible",
      baseUrl: "https://72ai.cc",
      "ui.modelConfig": JSON.stringify({
        version: 1,
        items: [{ id: "glm-5", label: "glm-5", source: "catalog" }],
      }),
      models: "glm-5",
      "routing.models": "glm-5",
    },
    providerPricingConfig: {
      mode: "manual",
      rules: [
        {
          matchType: "canonical",
          model: "glm-5",
          rates: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 1,
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

  try {
    await revokeProviderConnection(db, revokedSource.id);

    const activeReplacement = await createProviderConnection(
      db,
      {
        workspaceId: workspace.id,
        provider: "openai-compatible",
        label: "Current Active Route",
        apiKey: "sk-test-active-12345678",
        metadata: {
          defaultForProtocol: "openai-compatible",
          baseUrl: "https://72ai.cc",
          "ui.modelConfig": JSON.stringify({
            version: 1,
            items: [{ id: "glm-5", label: "glm-5", source: "catalog" }],
          }),
          models: "glm-5",
          "routing.models": "glm-5",
        },
        pricingConfig: {
          mode: "manual",
          rules: [
            {
              matchType: "canonical",
              model: "glm-5",
              rates: {
                inputUsdPerMillion: 1,
                outputUsdPerMillion: 1,
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
      Buffer.alloc(32, 9).toString("base64"),
    );
    await syncCatalogModelsFromProviderConnection(db, activeReplacement);

    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    const bootstrap = bootstrapResponse.json();
    assert.equal(bootstrap.availableModels.length, 1);
    assert.deepEqual(
      bootstrap.availableSources.map((source: { label: string }) => source.label),
      ["Current Active Route"],
    );
    assert.deepEqual(bootstrap.availableSources[0]?.models, [
      {
        id: "glm-5",
        label: "glm-5",
        ownedBy: null,
      },
    ]);
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap returns a migration error instead of an empty state when catalog source columns are missing", async () => {
  const { app, db, workspace, member } = await createSeededApp("developer");
  const baseQuery = db.query.bind(db);

  db.query = async (sql: string, params?: unknown[]) => {
    if (
      sql.toLowerCase().includes("select cm.*") &&
      sql.toLowerCase().includes("from workspaces w") &&
      sql.toLowerCase().includes("inner join catalog_models cm")
    ) {
      const result = await baseQuery(sql, params);
      return {
        ...result,
        rows: result.rows.map((row) => {
          const nextRow = { ...row };
          delete nextRow.source_provider_connection_id;
          delete nextRow.source_provider_connection_label;
          delete nextRow.source_provider;
          return nextRow;
        }),
      };
    }

    return baseQuery(sql, params);
  };

  try {
    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 500);
    assert.deepEqual(bootstrapResponse.json(), {
      error: {
        code: "TEAMOPS_MISSING_TABLE",
        resource: "workspace_model_catalog",
        message: "Workspace model assignments are unavailable until database migrations are up to date",
      },
    });
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap still loads organization models without workspace assignments", async () => {
  const { app, db, workspace, member } = await createSeededApp("developer");
  const baseQuery = db.query.bind(db);

  db.query = async (sql: string, params?: unknown[]) => {
    if (sql.toLowerCase().includes("from workspace_model_assignments")) {
      const error = new Error(
        'relation "workspace_model_assignments" does not exist',
      ) as Error & { code?: string };
      error.code = "42P01";
      throw error;
    }

    return baseQuery(sql, params);
  };

  try {
    const response = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().availableModels.length, 1);
  } finally {
    await app.close();
    await db.end();
  }
});

test("issue returns 403 when the member is not assigned to the selected project", async () => {
  const { app, db, workspace, member, provider } = await createSeededApp("developer");

  try {
    const unassignedProject = await createProject(db, {
      workspaceId: workspace.id,
      slug: "project-b",
      name: "Project B",
    });

    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: unassignedProject.id,
        providerConnectionId: provider.id,
        protocol: "openai-compatible",
      },
    });

    assert.equal(issueResponse.statusCode, 403);
    assert.equal(issueResponse.json().error.code, "SELF_SERVE_PROJECT_SCOPE_FORBIDDEN");
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap exposes explicit targets even without any default marker", async () => {
  const { app, db, workspace, member, project, provider } = await createSeededApp("developer", {
    providerMetadata: {
      "ui.modelConfig": JSON.stringify({
        version: 1,
        items: [{ id: "gpt-4.1-mini", label: "gpt-4.1-mini", source: "catalog" }],
      }),
      models: "gpt-4.1-mini",
      "routing.models": "gpt-4.1-mini",
    },
  });

  try {
    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    const bootstrap = bootstrapResponse.json();
    assert.deepEqual(bootstrap.availableTargets, [
      {
        providerConnectionId: provider.id,
        label: provider.label,
        provider: provider.provider,
        protocol: "openai-compatible",
        status: "ready",
        reason: null,
        uncoveredModels: [],
      },
    ]);

    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: project.id,
        providerConnectionId: provider.id,
        protocol: "openai-compatible",
      },
    });

    assert.equal(issueResponse.statusCode, 201);
  } finally {
    await app.close();
    await db.end();
  }
});

test("issue returns 409 when the selected provider does not support the requested protocol", async () => {
  const { app, db, workspace, project, member, provider } = await createSeededApp("developer");

  try {
    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: project.id,
        providerConnectionId: provider.id,
        protocol: "anthropic",
      },
    });

    assert.equal(issueResponse.statusCode, 409);
    assert.equal(issueResponse.json().error.code, "SELF_SERVE_PROVIDER_CONNECTION_NOT_READY");
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap still exposes all explicit targets when multiple candidates exist", async () => {
  const { app, db, workspace, project, member } = await createSeededApp("developer");

  try {
    const secondaryProvider = await createProviderConnection(
      db,
      {
        workspaceId: workspace.id,
        provider: "openai",
        label: "OpenAI Secondary",
        apiKey: "sk-test-secondary-12345678",
        metadata: {
          defaultForProtocol: "openai-compatible",
          "ui.modelConfig": JSON.stringify({
            version: 1,
            items: [{ id: "gpt-4.1-mini", label: "gpt-4.1-mini", source: "catalog" }],
          }),
          models: "gpt-4.1-mini",
          "routing.models": "gpt-4.1-mini",
        },
        pricingConfig: null,
      },
      Buffer.alloc(32, 9).toString("base64"),
    );
    await syncCatalogModelsFromProviderConnection(db, secondaryProvider);

    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    const bootstrap = bootstrapResponse.json();
    assert.equal(bootstrap.availableTargets.length, 2);

    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: project.id,
        providerConnectionId: secondaryProvider.id,
        protocol: "openai-compatible",
      },
    });

    assert.equal(issueResponse.statusCode, 409);
  } finally {
    await app.close();
    await db.end();
  }
});

test("model catalog endpoint returns the configured models without reading upstream", async () => {
  const { app, db, workspace, member, provider } = await createSeededApp("developer");
  const originalFetch = globalThis.fetch;
  let observedFetchCount = 0;

  globalThis.fetch = (async () => {
    observedFetchCount += 1;
    throw new Error("self-serve model catalog should not call upstream");
  }) as typeof fetch;

  try {
    const response = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/models?providerConnectionId=${provider.id}`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(observedFetchCount, 0);
    const payload = response.json();
    assert.equal(payload.providerConnectionId, provider.id);
    assert.deepEqual(payload.items, [
      { id: "gpt-4.1-mini", label: "gpt-4.1-mini", ownedBy: null },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await db.end();
  }
});

test("bootstrap marks targets without configured models as missing_configured_models", async () => {
  const { app, db, workspace, member, provider } = await createSeededApp("developer", {
    providerMetadata: {
      defaultForProtocol: "openai-compatible",
    },
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().availableTargets, [
      {
        providerConnectionId: provider.id,
        label: provider.label,
        provider: provider.provider,
        protocol: "openai-compatible",
        status: "missing_configured_models",
        reason: "missing_configured_models",
        uncoveredModels: [],
      },
    ]);
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap ignores malformed legacy provider rows instead of failing the page", async () => {
  const { app, db, workspace, member, provider } = await createSeededApp("developer");

  try {
    await db.query(`update provider_connections set provider = 'legacy-openai' where id = $1`, [provider.id]);

    const response = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.deepEqual(payload.providerConnections, []);
    assert.deepEqual(payload.availableTargets, []);
    assert.deepEqual(payload.availableSources, []);
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap ignores malformed legacy self-serve tokens instead of failing the page", async () => {
  const { app, db, workspace, member, project } = await createSeededApp("developer");

  try {
    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: project.id,
        protocol: "openai-compatible",
      },
    });

    assert.equal(issueResponse.statusCode, 201);
    const issued = issueResponse.json();
    await db.query(`update virtual_keys set environment = 'review' where id = $1`, [issued.id]);

    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    assert.deepEqual(bootstrapResponse.json().activeTokens, []);
  } finally {
    await app.close();
    await db.end();
  }
});

test("bootstrap marks targets with uncovered pricing as pricing_uncovered and issue rejects them", async () => {
  const { app, db, workspace, member, project, provider } = await createSeededApp("developer", {
    providerKind: "openai-compatible",
    providerMetadata: {
      baseUrl: "https://api.deepseek.com",
      defaultForProtocol: "openai-compatible",
      "ui.modelConfig": JSON.stringify({
        version: 1,
        items: [{ id: "deepseek-v4-flash", label: "deepseek-v4-flash", source: "catalog" }],
      }),
      models: "deepseek-v4-flash",
      "routing.models": "deepseek-v4-flash",
    },
  });

  try {
    const bootstrapResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/bootstrap`,
      headers: {
        "x-member-email": member.email,
      },
    });

    assert.equal(bootstrapResponse.statusCode, 200);
    assert.deepEqual(bootstrapResponse.json().availableTargets, [
      {
        providerConnectionId: provider.id,
        label: provider.label,
        provider: provider.provider,
        protocol: "openai-compatible",
        status: "pricing_uncovered",
        reason: "pricing_uncovered",
        uncoveredModels: ["deepseek-v4-flash"],
      },
    ]);

    const issueResponse = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/self-serve-virtual-keys/issue`,
      headers: {
        "x-member-email": member.email,
      },
      payload: {
        projectId: project.id,
        providerConnectionId: provider.id,
        protocol: "openai-compatible",
      },
    });

    assert.equal(issueResponse.statusCode, 409);
    assert.equal(issueResponse.json().error.code, "SELF_SERVE_PROVIDER_CONNECTION_NOT_READY");
  } finally {
    await app.close();
    await db.end();
  }
});
