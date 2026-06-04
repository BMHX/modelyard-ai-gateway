import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { ProviderPricingConfig } from "@teamops/contracts";

import {
  createDatabase,
  createProviderConnection,
  createWorkspace,
  listAssignedCatalogModelsForWorkspace,
  runMigrations,
} from "./index.js";

async function createLegacyWorkspaceModelCatalogDatabase() {
  const db = createDatabase("pglite://memory");
  await runMigrations(db);
  await db.query("delete from schema_migrations where version = $1", [
    "0031_workspace_model_catalog_source_repair.sql",
  ]);
  await db.query("drop table if exists provider_connection_catalog_models");
  await db.query("drop table if exists workspace_model_assignments");
  await db.query("drop table if exists catalog_models");
  await db.query(`
    create table catalog_models (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id) on delete cascade,
      model_id text not null,
      label text not null,
      protocol text not null,
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (organization_id, protocol, model_id)
    )
  `);
  await db.query(`
    create table workspace_model_assignments (
      workspace_id uuid not null references workspaces(id) on delete cascade,
      catalog_model_id uuid not null references catalog_models(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (workspace_id, catalog_model_id)
    )
  `);
  await db.query(`
    create table provider_connection_catalog_models (
      provider_connection_id uuid not null references provider_connections(id) on delete cascade,
      catalog_model_id uuid not null references catalog_models(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (provider_connection_id, catalog_model_id)
    )
  `);
  return db;
}

async function seedLegacyCatalogWorkspace(args: {
  providerInputs: Array<{
    label: string;
    provider?: "openai" | "openai-compatible" | "anthropic";
    metadata: Record<string, string>;
    pricingConfig?: ProviderPricingConfig | null;
  }>;
  legacyCatalogModelId: string;
  legacyModelId: string;
  legacyLabel?: string;
  legacyStatus?: "active" | "archived";
  mappedProviderIndexes?: number[];
  workspaceCount?: number;
}) {
  const db = await createLegacyWorkspaceModelCatalogDatabase();
  const encryptionKeyBase64 = Buffer.alloc(32, 9).toString("base64");
  const organizationId = "11111111-1111-4111-8111-111111111111";
  await db.query(
    `insert into organizations (id, slug, name) values ($1, $2, $3)`,
    [organizationId, "teamops", "TeamOps"],
  );

  const workspaceCount = args.workspaceCount ?? 2;
  const workspaces = [];
  for (let index = 0; index < workspaceCount; index += 1) {
    workspaces.push(
      await createWorkspace(db, {
        organizationId,
        slug: `workspace-${index + 1}`,
        name: index === 0 ? "Agency Client Delivery" : `Workspace ${index + 1}`,
      }),
    );
  }

  const providers = [];
  for (const providerInput of args.providerInputs) {
    providers.push(
      await createProviderConnection(
        db,
        {
          workspaceId: workspaces[0].id,
          provider: providerInput.provider ?? "openai-compatible",
          label: providerInput.label,
          apiKey: `sk-test-${providerInput.label}`,
          metadata: providerInput.metadata,
          pricingConfig: providerInput.pricingConfig ?? null,
        },
        encryptionKeyBase64,
      ),
    );
  }

  await db.query(
    `
      insert into catalog_models (
        id,
        organization_id,
        model_id,
        label,
        protocol,
        status
      )
      values ($1, $2, $3, $4, $5, $6)
    `,
    [
      args.legacyCatalogModelId,
      organizationId,
      args.legacyModelId,
      args.legacyLabel ?? args.legacyModelId,
      "openai-compatible",
      args.legacyStatus ?? "active",
    ],
  );

  for (const workspace of workspaces) {
    await db.query(
      `
        insert into workspace_model_assignments (workspace_id, catalog_model_id)
        values ($1, $2)
      `,
      [workspace.id, args.legacyCatalogModelId],
    );
  }

  for (const providerIndex of args.mappedProviderIndexes ?? []) {
    await db.query(
      `
        insert into provider_connection_catalog_models (provider_connection_id, catalog_model_id)
        values ($1, $2)
      `,
      [providers[providerIndex]?.id, args.legacyCatalogModelId],
    );
  }

  return { db, organizationId, providers, workspaces };
}

test("runMigrations repairs legacy catalog rows and preserves ids for uniquely mapped models", async () => {
  const legacyCatalogModelId = randomUUID();
  const { db, providers, workspaces } = await seedLegacyCatalogWorkspace({
    legacyCatalogModelId,
    legacyModelId: "glm-5",
    providerInputs: [
      {
        label: "New API 中转平台",
        metadata: {
          baseUrl: "https://72ai.cc",
          models: "glm-5",
          "routing.models": "glm-5",
          "ui.modelConfig":
            '{"version":1,"items":[{"id":"glm-5","label":"glm-5","source":"catalog"}]}',
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
    ],
    mappedProviderIndexes: [0],
    workspaceCount: 5,
  });

  try {
    await runMigrations(db);

    const columns = await db.query<{ column_name: string }>(
      `
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = 'catalog_models'
      `,
    );
    assert(columns.rows.some((row) => row.column_name === "source_provider_connection_id"));
    assert(columns.rows.some((row) => row.column_name === "source_provider_connection_label"));
    assert(columns.rows.some((row) => row.column_name === "source_provider"));

    const indexes = await db.query<{ indexdef: string }>(
      `
        select indexdef
        from pg_indexes
        where schemaname = 'public' and tablename = 'catalog_models'
      `,
    );
    assert(
      indexes.rows.some((row) =>
        row.indexdef.includes("(organization_id, protocol, model_id, source_provider_connection_id)"),
      ),
    );

    const models = await listAssignedCatalogModelsForWorkspace(
      db,
      workspaces[0].id,
      "openai-compatible",
    );
    assert.equal(models.length, 1);
    assert.equal(models[0]?.id, legacyCatalogModelId);
    assert.equal(models[0]?.sourceProviderConnectionId, providers[0]?.id);
    assert.equal(models[0]?.sourceProviderConnectionLabel, "New API 中转平台");

    const mappings = await db.query<{
      provider_connection_id: string;
      catalog_model_id: string;
    }>(`select provider_connection_id, catalog_model_id from provider_connection_catalog_models`);
    assert.deepEqual(mappings.rows, [
      {
        provider_connection_id: providers[0]?.id ?? "",
        catalog_model_id: legacyCatalogModelId,
      },
    ]);
  } finally {
    await db.end();
  }
});

test("runMigrations derives source bindings from manual pricing rules", async () => {
  const legacyCatalogModelId = randomUUID();
  const { db, providers, workspaces } = await seedLegacyCatalogWorkspace({
    legacyCatalogModelId,
    legacyModelId: "deepseek-v4-flash",
    providerInputs: [
      {
        label: "DeepSeek 集群",
        metadata: {
          baseUrl: "https://api.deepseek.com",
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
      },
    ],
  });

  try {
    await runMigrations(db);
    const models = await listAssignedCatalogModelsForWorkspace(
      db,
      workspaces[0].id,
      "openai-compatible",
    );
    assert.equal(models.length, 1);
    assert.equal(models[0]?.sourceProviderConnectionId, providers[0]?.id);
    assert.equal(models[0]?.modelId, "deepseek-v4-flash");
  } finally {
    await db.end();
  }
});

test("runMigrations splits legacy catalog rows across multiple discovered sources and copies assignments", async () => {
  const legacyCatalogModelId = randomUUID();
  const { db, providers, workspaces } = await seedLegacyCatalogWorkspace({
    legacyCatalogModelId,
    legacyModelId: "glm-5",
    providerInputs: [
      {
        label: "Relay A",
        metadata: {
          baseUrl: "https://relay-a.example.com",
          models: "glm-5",
        },
      },
      {
        label: "Relay B",
        metadata: {
          baseUrl: "https://relay-b.example.com",
          models: "glm-5",
        },
      },
    ],
  });

  try {
    await runMigrations(db);

    const rows = await db.query<{
      id: string;
      source_provider_connection_id: string;
    }>(`
      select id, source_provider_connection_id
      from catalog_models
      where organization_id = $1 and protocol = 'openai-compatible' and model_id = 'glm-5'
      order by created_at asc, id asc
    `, [workspaces[0].organizationId]);
    assert.equal(rows.rows.length, 2);
    assert(rows.rows.some((row) => row.id === legacyCatalogModelId));
    assert.deepEqual(
      rows.rows.map((row) => row.source_provider_connection_id).sort(),
      providers.map((provider) => provider.id).sort(),
    );

    const assignments = await db.query<{ workspace_id: string; catalog_model_id: string }>(
      `
        select workspace_id, catalog_model_id
        from workspace_model_assignments
        order by workspace_id asc, catalog_model_id asc
      `,
    );
    assert.equal(assignments.rows.length, workspaces.length * 2);
  } finally {
    await db.end();
  }
});

test("runMigrations fails when an active legacy catalog row has no source provider candidate", async () => {
  const { db } = await seedLegacyCatalogWorkspace({
    legacyCatalogModelId: randomUUID(),
    legacyModelId: "orphan-model",
    providerInputs: [],
  });

  try {
    await assert.rejects(
      () => runMigrations(db),
      /could not be matched to any source provider connection/,
    );
  } finally {
    await db.end();
  }
});
