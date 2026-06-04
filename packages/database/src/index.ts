import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Results as PGliteResults, type Transaction as PGliteTransaction } from "@electric-sql/pglite";
import { Client, Pool } from "pg";

import {
  ControlPlaneOperatorSchema,
  EventDrivenTriggerSchema,
  getProviderConfiguredModelCatalogItems,
  IdentityProviderSchema,
  PromptInspectionReviewStatusSchema,
  PromptPolicyEvidenceModeSchema,
  PromptPolicyEnforcementModeSchema,
  PromptPolicySchema,
  ProviderPricingConfigSchema,
  ReportDistributionSchema,
  ReportGovernanceSchema,
  ReportWorkflowSchema,
  normalizeMemberRole,
  normalizeVirtualKeyScopes,
} from "@teamops/contracts";

import type {
  Alert,
  AlertQuery,
  ControlPlaneOperator,
  AuditLog,
  CatalogModel,
  IdentityProvider,
  BudgetPolicy,
  BudgetPolicySummary,
  CreateSavedViewInput,
  CreateScheduledReportInput,
  EventDrivenTriggerEvent,
  UpdateSavedViewInput,
  UpdateScheduledReportInput,
  CreateBudgetPolicyInput,
  CreateEnvironmentInput,
  CreateExportJobInput,
  CreateMemberInput,
  CreateOrganizationInput,
  CreateProjectInput,
  CreateProviderConnectionInput,
  CreateVirtualKeyInput,
  CreateWorkspaceInput,
  Environment,
  ExportJob,
  ModelMapping,
  Member,
  MemberProjectAssignment,
  Organization,
  OrganizationSummary,
  PriceSnapshot,
  PromptInspection,
  PromptBatchReviewInput,
  PromptInspectionSort,
  PromptInspectionSummary,
  PromptPolicy,
  Project,
  ProviderConnection,
  ProviderPricingConfig,
  RecordUsageEventInput,
  ReportGovernance,
  ReplaceMemberProjectAssignmentsInput,
  SavedView,
  ScheduledReport,
  SyncWorkspaceModelAssignmentsInput,
  UpsertIdentityProviderInput,
  UpsertCatalogModelInput,
  UpdateExportJobInput,
  UpdateEnvironmentInput,
  UpdateBudgetPolicyInput,
  UpdateAlertInput,
  UpdateMemberInput,
  UpdateOrganizationInput,
  UpdatePromptPolicyInput,
  UpdateProjectInput,
  UpdateProviderConnectionInput,
  UpdateWorkspaceInput,
  PromptReviewInput,
  UsageEvent,
  UsageEventDailyPoint,
  UsageForecastDaily,
  UsageLedgerEntry,
  VirtualKey,
  VirtualKeyInventorySummary,
  Workspace,
  WorkspaceOption,
  EvidenceBundle,
  FingerprintIssuance,
  FingerprintKeyVersion,
  FingerprintKeyVersionListQuery,
  FingerprintLookupQuery,
  IssueFingerprintInput,
  LineageBuildDescriptor,
  RotateFingerprintKeyVersionInput,
  VerifyLineageArtifactsInput,
  VerifyLineageArtifactsResponse,
} from "@teamops/contracts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");
const requiredPostMigrationRelations = [
  "public.saved_views",
  "public.scheduled_reports",
  "public.catalog_models",
  "public.workspace_model_assignments",
  "public.provider_connection_catalog_models",
] as const;

export type DbField = {
  name: string;
  dataTypeID?: number;
};

export type DbQueryResult<T = DbRow> = {
  rows: T[];
  rowCount: number;
  fields?: DbField[];
};

export type Queryable = {
  query<T = DbRow>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>>;
};

type TransactionQueryable = Queryable & {
  release?: () => void | Promise<void>;
};

export type Database = Queryable & {
  kind: "pg" | "pglite";
  end(): Promise<void>;
  exec?(sql: string): Promise<unknown>;
  connect?(): Promise<TransactionQueryable>;
  transaction?<T>(callback: (client: TransactionQueryable) => Promise<T>): Promise<T>;
};

type DbRow = Record<string, unknown>;
export type ProviderConnectionCandidate = {
  connection: ProviderConnection;
  metadata: Record<string, string>;
  encryptedApiKey: string;
  credentialKeyFingerprint: string | null;
};

export type StoredIdentityProvider = IdentityProvider & {
  encryptedClientSecret: string | null;
};

export type ExternalIdentityRecord = {
  id: string;
  organizationId: string;
  identityProviderId: string;
  operatorId: string;
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ControlPlaneSessionRecord = {
  id: string;
  organizationId: string;
  organizationSlug: string;
  operatorId: string;
  operatorEmail: string;
  operatorName: string;
  operatorStatus: ControlPlaneOperator["status"];
  identityProviderId: string;
  externalIdentityId: string;
  email: string;
  amr: string[];
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  activeMembershipId: string | null;
  activeRole: string | null;
  revokedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export type ActiveMemberIdentity = Member & {
  workspaceName: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
};

export class DatabaseValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "DatabaseValidationError";
  }
}

export class DatabaseSchemaDriftError extends Error {
  readonly code = "TEAMOPS_SCHEMA_DRIFT";

  constructor(
    public readonly resource: "workspace_model_catalog" | "provider_connections",
    message: string,
  ) {
    super(message);
    this.name = "DatabaseSchemaDriftError";
  }
}

const unassignedMemberRoleSentinel = "__none__";

function normalizePgQueryResult<T>(
  result:
    | {
        rows?: T[];
        rowCount?: number | null;
        fields?: Array<{ name: string; dataTypeID: number }>;
      }
    | Array<{
        rows?: T[];
        rowCount?: number | null;
        fields?: Array<{ name: string; dataTypeID: number }>;
      }>,
): DbQueryResult<T> {
  const results = Array.isArray(result) ? result : [result];
  const lastResult = results.at(-1);
  const rows = lastResult?.rows ?? [];
  const rowCount =
    lastResult?.rowCount ??
    results.reduce((total, entry) => total + (entry.rowCount ?? entry.rows?.length ?? 0), 0);

  return {
    rows,
    rowCount,
    fields: lastResult?.fields?.map((field) => ({
      name: field.name,
      dataTypeID: field.dataTypeID,
    })),
  };
}

function normalizePGliteQueryResult<T>(result: PGliteResults<T>): DbQueryResult<T> {
  return {
    rows: result.rows,
    rowCount: Math.max(result.affectedRows ?? 0, result.rows.length),
    fields: result.fields?.map((field) => ({
      name: field.name,
      dataTypeID: field.dataTypeID,
    })),
  };
}

function stripUnsupportedMigrationStatements(sql: string) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*/imu, "")
    .trim();
}

function createPGliteQueryable(client: Pick<PGlite, "query"> | PGliteTransaction): TransactionQueryable {
  return {
    async query<T = DbRow>(sql: string, params?: unknown[]) {
      const result = await client.query<T>(sql, params);
      return normalizePGliteQueryResult(result);
    },
  };
}

function parsePGliteDataDir(connectionString: string) {
  const rawPath = connectionString.slice("pglite://".length);
  if (!rawPath || rawPath === "memory") {
    return "memory://teamops-desktop";
  }

  if (rawPath.startsWith("/")) {
    return decodeURIComponent(rawPath);
  }

  return decodeURIComponent(rawPath);
}

function ensurePGliteDataDir(dataDir: string) {
  if (dataDir.startsWith("memory://")) {
    return;
  }

  mkdirSync(path.dirname(dataDir), {
    recursive: true,
  });
}

export function createDatabase(connectionString: string) {
  if (connectionString.startsWith("pglite://")) {
    const dataDir = parsePGliteDataDir(connectionString);
    ensurePGliteDataDir(dataDir);
    const db = new PGlite(dataDir);
    const queryable = createPGliteQueryable(db);

    return {
      kind: "pglite" as const,
      query: queryable.query,
      async exec(sql: string) {
        await db.waitReady;
        return db.exec(sql);
      },
      async transaction<T>(callback: (client: TransactionQueryable) => Promise<T>) {
        await db.waitReady;
        return db.transaction(async (tx) => callback(createPGliteQueryable(tx)));
      },
      async end() {
        await db.close();
      },
    } satisfies Database;
  }

  const pool = new Pool({
    connectionString,
    max: 10,
  });

  return {
    kind: "pg" as const,
    async query<T = DbRow>(sql: string, params?: unknown[]) {
      const result = await pool.query(sql, params as any[]);
      return normalizePgQueryResult(result as any);
    },
    async connect() {
      const client = await pool.connect();
      return {
        async query<T = DbRow>(sql: string, params?: unknown[]) {
          const result = await client.query(sql, params as any[]);
          return normalizePgQueryResult(result as any);
        },
        release: () => client.release(),
      } satisfies TransactionQueryable;
    },
    async end() {
      await pool.end();
    },
  } satisfies Database;
}

export const PROMPT_POLICY_CHANGED_CHANNEL = "prompt_policy_changed";

export type PgNotificationListener = {
  close(): Promise<void>;
};

function assertValidPgNotificationChannel(channel: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(channel)) {
    throw new Error(`Invalid Postgres notification channel: ${channel}`);
  }
}

export async function createPgNotificationListener(args: {
  connectionString: string;
  channel: string;
  onMessage(payload: string): void;
  onReconnect?(): void;
  onError?(error: unknown): void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}): Promise<PgNotificationListener> {
  assertValidPgNotificationChannel(args.channel);

  let closed = false;
  let client: Client | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  const initialBackoffMs = args.initialBackoffMs ?? 500;
  const maxBackoffMs = args.maxBackoffMs ?? 10_000;
  let nextBackoffMs = initialBackoffMs;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      await connect(true);
    }, nextBackoffMs);
    nextBackoffMs = Math.min(nextBackoffMs * 2, maxBackoffMs);
  };

  const releaseClient = async (target: Client | null) => {
    if (!target) {
      return;
    }

    try {
      await target.end();
    } catch {
      // Ignore shutdown failures and preserve the reconnect loop.
    }
  };

  const connect = async (isReconnect: boolean) => {
    if (closed) {
      return;
    }

    const nextClient = new Client({
      connectionString: args.connectionString,
    });

    const handleDisconnect = (error?: unknown) => {
      if (closed || client !== nextClient) {
        return;
      }

      args.onError?.(error ?? new Error(`Notification listener for ${args.channel} disconnected`));
      client = null;
      void releaseClient(nextClient);
      scheduleReconnect();
    };

    nextClient.on("notification", (message) => {
      if (message.channel === args.channel && typeof message.payload === "string") {
        args.onMessage(message.payload);
      }
    });
    nextClient.on("error", handleDisconnect);
    nextClient.on("end", () => handleDisconnect());

    try {
      await nextClient.connect();
      await nextClient.query(`listen ${args.channel}`);
      client = nextClient;
      nextBackoffMs = initialBackoffMs;
      if (isReconnect) {
        args.onReconnect?.();
      }
    } catch (error) {
      args.onError?.(error);
      void releaseClient(nextClient);
      scheduleReconnect();
    }
  };

  await connect(false);

  return {
    async close() {
      closed = true;
      clearReconnectTimer();
      const activeClient = client;
      client = null;
      await releaseClient(activeClient);
    },
  };
}

export async function pingDatabase(db: Database) {
  await db.query("select 1");
}

async function withTransaction<T>(db: Database | Queryable, callback: (client: Queryable) => Promise<T>) {
  if ("transaction" in db && typeof db.transaction === "function" && !("connect" in db && typeof db.connect === "function")) {
    return db.transaction(async (transactionClient) => callback(transactionClient));
  }

  const connect = (db as Database).connect;
  const transactionClient =
    typeof connect === "function"
      ? await connect.call(db)
      : (db as TransactionQueryable);

  try {
    await transactionClient.query("begin");
    const result = await callback(transactionClient);
    await transactionClient.query("commit");
    return result;
  } catch (error) {
    try {
      await transactionClient.query("rollback");
    } catch {
      // Preserve the original failure if rollback also errors.
    }
    throw error;
  } finally {
    transactionClient.release?.();
  }
}

async function assertRequiredRelations(db: Database, relations: readonly string[]) {
  for (const relation of relations) {
    const result = await db.query<{ relation_name: string | null }>("select to_regclass($1) as relation_name", [relation]);
    if (!result.rows[0]?.relation_name) {
      throw new Error(`Expected relation ${relation} to exist after migrations, but it was not materialized`);
    }
  }
}

async function listTableColumnNames(db: Database, tableName: string) {
  const result = await db.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position
    `,
    [tableName],
  );

  return new Set(result.rows.map((row) => row.column_name));
}

async function listTableIndexes(db: Database, tableName: string) {
  const result = await db.query<{ indexname: string; indexdef: string }>(
    `
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public' and tablename = $1
      order by indexname
    `,
    [tableName],
  );

  return result.rows;
}

function hasSourceAwareCatalogUniqueIndex(indexes: Array<{ indexdef: string }>) {
  return indexes.some((row) => {
    const normalized = row.indexdef.toLowerCase();
    return (
      normalized.includes("unique index") &&
      normalized.includes("(organization_id, protocol, model_id, source_provider_connection_id)")
    );
  });
}

async function assertWorkspaceModelCatalogSchema(db: Database) {
  const columnNames = await listTableColumnNames(db, "catalog_models");
  const missingColumns = [
    "source_provider_connection_id",
    "source_provider_connection_label",
    "source_provider",
  ].filter((columnName) => !columnNames.has(columnName));

  if (missingColumns.length > 0) {
    throw new DatabaseSchemaDriftError(
      "workspace_model_catalog",
      `catalog_models is missing required source columns: ${missingColumns.join(", ")}`,
    );
  }

  const indexes = await listTableIndexes(db, "catalog_models");
  if (!hasSourceAwareCatalogUniqueIndex(indexes)) {
    throw new DatabaseSchemaDriftError(
      "workspace_model_catalog",
      "catalog_models is missing the source-aware unique index on (organization_id, protocol, model_id, source_provider_connection_id)",
    );
  }
}

type CatalogModelRepairRow = {
  id: string;
  organizationId: string;
  modelId: string;
  label: string;
  protocol: CatalogModel["protocol"];
  status: CatalogModel["status"];
  createdAt: string;
  updatedAt: string;
  sourceProviderConnectionId: string | null;
  sourceProviderConnectionLabel: string | null;
  sourceProvider: CatalogModel["sourceProvider"] | null;
};

type CatalogModelRepairCandidate = {
  sourceProviderConnectionId: string;
  sourceProviderConnectionLabel: string;
  sourceProvider: CatalogModel["sourceProvider"];
  priority: number;
  providerCreatedAt: string;
};

function mapCatalogModelRepairRow(row: DbRow): CatalogModelRepairRow {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    modelId: String(row.model_id),
    label: String(row.label),
    protocol: String(row.protocol) as CatalogModel["protocol"],
    status: String(row.status) as CatalogModel["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
    sourceProviderConnectionId:
      row.source_provider_connection_id === null || row.source_provider_connection_id === undefined
        ? null
        : String(row.source_provider_connection_id),
    sourceProviderConnectionLabel:
      row.source_provider_connection_label === null || row.source_provider_connection_label === undefined
        ? null
        : String(row.source_provider_connection_label),
    sourceProvider:
      row.source_provider === null || row.source_provider === undefined
        ? null
        : (String(row.source_provider) as CatalogModel["sourceProvider"]),
  };
}

function buildProviderCatalogSourceRows(connections: ProviderConnection[]) {
  return connections.flatMap((connection) => {
    const protocol = getProviderRoutingProtocolForProvider(connection.provider);
    const configuredModels = getProviderConfiguredModelCatalogItems(
      connection.metadata,
      connection.pricingConfig,
    );

    return configuredModels.map((model) => ({
      organizationId: connection.organizationId ?? null,
      modelId: model.id,
      label: model.label,
      protocol,
      sourceProviderConnectionId: connection.id,
      sourceProviderConnectionLabel: connection.label,
      sourceProvider: connection.provider,
      providerStatus: connection.status,
      providerCreatedAt: connection.createdAt,
    }));
  });
}

async function repairWorkspaceModelCatalogSchema(db: Database) {
  const relationResult = await db.query<{ relation_name: string | null }>(
    "select to_regclass($1) as relation_name",
    ["public.catalog_models"],
  );
  if (!relationResult.rows[0]?.relation_name) {
    return;
  }

  await withTransaction(db, async (transaction) => {
    await transaction.query(`
      alter table catalog_models
        add column if not exists source_provider_connection_id uuid references provider_connections(id) on delete cascade,
        add column if not exists source_provider_connection_label text,
        add column if not exists source_provider text
    `);

    await transaction.query(`
      alter table catalog_models
      drop constraint if exists catalog_models_organization_id_protocol_model_id_key
    `);
    await transaction.query(`
      drop index if exists catalog_models_organization_id_protocol_model_id_key
    `);

    const catalogRowsResult = await transaction.query(
      `
        select *
        from catalog_models
        order by organization_id asc, protocol asc, model_id asc, created_at asc, id asc
      `,
    );
    const catalogRows = catalogRowsResult.rows.map(mapCatalogModelRepairRow);

    const providerConnectionsResult = await transaction.query(`
      select *
      from provider_connections
      order by created_at asc, id asc
    `);
    const providerConnections = providerConnectionsResult.rows.map(mapProviderConnection);
    const providerConnectionsById = new Map(
      providerConnections.map((connection) => [connection.id, connection]),
    );
    const discoveredSources = buildProviderCatalogSourceRows(providerConnections);
    const discoveredSourcesByModel = new Map<string, typeof discoveredSources>();

    for (const source of discoveredSources) {
      if (!source.organizationId) {
        continue;
      }
      const key = [
        source.organizationId,
        source.protocol,
        source.modelId,
      ].join(":");
      const existing = discoveredSourcesByModel.get(key);
      if (existing) {
        existing.push(source);
      } else {
        discoveredSourcesByModel.set(key, [source]);
      }
    }

    const mappingRows = await transaction.query<{
      provider_connection_id: string;
      catalog_model_id: string;
    }>(`
      select provider_connection_id, catalog_model_id
      from provider_connection_catalog_models
    `);
    const mappedProviderIdsByCatalogModelId = new Map<string, string[]>();
    for (const row of mappingRows.rows) {
      const key = String(row.catalog_model_id);
      const existing = mappedProviderIdsByCatalogModelId.get(key);
      if (existing) {
        existing.push(String(row.provider_connection_id));
      } else {
        mappedProviderIdsByCatalogModelId.set(key, [String(row.provider_connection_id)]);
      }
    }

    const assignmentRows = await transaction.query<{
      workspace_id: string;
      catalog_model_id: string;
    }>(`
      select workspace_id, catalog_model_id
      from workspace_model_assignments
    `);
    const workspaceAssignmentsByCatalogModelId = new Map<string, string[]>();
    for (const row of assignmentRows.rows) {
      const key = String(row.catalog_model_id);
      const existing = workspaceAssignmentsByCatalogModelId.get(key);
      if (existing) {
        existing.push(String(row.workspace_id));
      } else {
        workspaceAssignmentsByCatalogModelId.set(key, [String(row.workspace_id)]);
      }
    }

    const legacyRows = catalogRows.filter(
      (row) =>
        !row.sourceProviderConnectionId ||
        !row.sourceProviderConnectionLabel ||
        !row.sourceProvider,
    );

    for (const row of legacyRows) {
      const candidates = new Map<string, CatalogModelRepairCandidate>();
      const mappedProviderIds = mappedProviderIdsByCatalogModelId.get(row.id) ?? [];

      for (const providerConnectionId of mappedProviderIds) {
        const connection = providerConnectionsById.get(providerConnectionId);
        if (!connection || !connection.organizationId) {
          continue;
        }
        if (getProviderRoutingProtocolForProvider(connection.provider) !== row.protocol) {
          continue;
        }
        candidates.set(providerConnectionId, {
          sourceProviderConnectionId: connection.id,
          sourceProviderConnectionLabel: connection.label,
          sourceProvider: connection.provider,
          priority: 0,
          providerCreatedAt: connection.createdAt,
        });
      }

      const discoveredCandidates = discoveredSourcesByModel.get(
        [row.organizationId, row.protocol, row.modelId].join(":"),
      ) ?? [];
      for (const candidate of discoveredCandidates) {
        const existing = candidates.get(candidate.sourceProviderConnectionId);
        if (existing) {
          continue;
        }
        candidates.set(candidate.sourceProviderConnectionId, {
          sourceProviderConnectionId: candidate.sourceProviderConnectionId,
          sourceProviderConnectionLabel: candidate.sourceProviderConnectionLabel,
          sourceProvider: candidate.sourceProvider,
          priority: 1,
          providerCreatedAt: candidate.providerCreatedAt,
        });
      }

      const sortedCandidates = [...candidates.values()].sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }
        if (left.providerCreatedAt !== right.providerCreatedAt) {
          return left.providerCreatedAt.localeCompare(right.providerCreatedAt);
        }
        return left.sourceProviderConnectionId.localeCompare(right.sourceProviderConnectionId);
      });

      if (sortedCandidates.length === 0) {
        throw new DatabaseSchemaDriftError(
          "workspace_model_catalog",
          `catalog_models row ${row.id} (${row.organizationId}/${row.protocol}/${row.modelId}, status=${row.status}) could not be matched to any source provider connection`,
        );
      }

      const [primaryCandidate, ...secondaryCandidates] = sortedCandidates;
      await transaction.query(
        `
          update catalog_models
          set
            source_provider_connection_id = $2,
            source_provider_connection_label = $3,
            source_provider = $4,
            updated_at = now()
          where id = $1
        `,
        [
          row.id,
          primaryCandidate.sourceProviderConnectionId,
          primaryCandidate.sourceProviderConnectionLabel,
          primaryCandidate.sourceProvider,
        ],
      );

      for (const candidate of secondaryCandidates) {
        const inserted = await transaction.query<{ id: string }>(
          `
            insert into catalog_models (
              organization_id,
              model_id,
              label,
              protocol,
              source_provider_connection_id,
              source_provider_connection_label,
              source_provider,
              status,
              created_at,
              updated_at
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, now())
            returning id
          `,
          [
            row.organizationId,
            row.modelId,
            row.label,
            row.protocol,
            candidate.sourceProviderConnectionId,
            candidate.sourceProviderConnectionLabel,
            candidate.sourceProvider,
            row.status,
            row.createdAt,
          ],
        );

        const insertedCatalogModelId = String(inserted.rows[0]?.id);
        for (const workspaceId of workspaceAssignmentsByCatalogModelId.get(row.id) ?? []) {
          await transaction.query(
            `
              insert into workspace_model_assignments (workspace_id, catalog_model_id)
              values ($1, $2)
              on conflict do nothing
            `,
            [workspaceId, insertedCatalogModelId],
          );
        }
      }
    }

    const repairedCatalogRowsResult = await transaction.query(
      `
        select *
        from catalog_models
        order by organization_id asc, protocol asc, model_id asc, created_at asc, id asc
      `,
    );
    const repairedCatalogRows = repairedCatalogRowsResult.rows.map(mapCatalogModelRepairRow);
    const existingCatalogKeySet = new Set(
      repairedCatalogRows.map((row) =>
        [
          row.organizationId,
          row.protocol,
          row.modelId,
          row.sourceProviderConnectionId ?? "",
        ].join(":"),
      ),
    );

    const orgWorkspaceIdsResult = await transaction.query<{
      id: string;
      organization_id: string;
    }>(`
      select id, organization_id
      from workspaces
    `);
    const workspaceIdsByOrganizationId = new Map<string, string[]>();
    for (const row of orgWorkspaceIdsResult.rows) {
      const organizationId = String(row.organization_id);
      const existing = workspaceIdsByOrganizationId.get(organizationId);
      if (existing) {
        existing.push(String(row.id));
      } else {
        workspaceIdsByOrganizationId.set(organizationId, [String(row.id)]);
      }
    }

    for (const source of discoveredSources) {
      if (!source.organizationId || source.providerStatus !== "active") {
        continue;
      }
      const key = [
        source.organizationId,
        source.protocol,
        source.modelId,
        source.sourceProviderConnectionId,
      ].join(":");
      if (existingCatalogKeySet.has(key)) {
        continue;
      }

      const inserted = await transaction.query<{ id: string }>(
        `
          insert into catalog_models (
            organization_id,
            model_id,
            label,
            protocol,
            source_provider_connection_id,
            source_provider_connection_label,
            source_provider,
            status
          )
          values ($1, $2, $3, $4, $5, $6, $7, 'active')
          returning id
        `,
        [
          source.organizationId,
          source.modelId,
          source.label,
          source.protocol,
          source.sourceProviderConnectionId,
          source.sourceProviderConnectionLabel,
          source.sourceProvider,
        ],
      );
      const catalogModelId = String(inserted.rows[0]?.id);
      existingCatalogKeySet.add(key);

      for (const workspaceId of workspaceIdsByOrganizationId.get(source.organizationId) ?? []) {
        await transaction.query(
          `
            insert into workspace_model_assignments (workspace_id, catalog_model_id)
            values ($1, $2)
            on conflict do nothing
          `,
          [workspaceId, catalogModelId],
        );
      }
    }

    const sourceIntegrityRows = await transaction.query<{
      id: string;
      organization_id: string;
      protocol: string;
      model_id: string;
      status: string;
    }>(`
      select id, organization_id, protocol, model_id, status
      from catalog_models
      where source_provider_connection_id is null
         or source_provider_connection_label is null
         or source_provider is null
    `);
    if (sourceIntegrityRows.rowCount > 0) {
      const failedRow = sourceIntegrityRows.rows[0];
      throw new DatabaseSchemaDriftError(
        "workspace_model_catalog",
        `catalog_models row ${failedRow?.id} (${failedRow?.organization_id}/${failedRow?.protocol}/${failedRow?.model_id}, status=${failedRow?.status}) still has missing source fields after repair`,
      );
    }

    const duplicateRows = await transaction.query<{
      canonical_id: string;
      duplicate_id: string;
    }>(`
      with ranked_rows as (
        select
          id,
          first_value(id) over (
            partition by organization_id, protocol, model_id, source_provider_connection_id
            order by created_at asc, id asc
          ) as canonical_id,
          row_number() over (
            partition by organization_id, protocol, model_id, source_provider_connection_id
            order by created_at asc, id asc
          ) as row_rank
        from catalog_models
      )
      select canonical_id, id as duplicate_id
      from ranked_rows
      where row_rank > 1
    `);
    for (const row of duplicateRows.rows) {
      await transaction.query(
        `
          insert into workspace_model_assignments (workspace_id, catalog_model_id)
          select workspace_id, $1
          from workspace_model_assignments
          where catalog_model_id = $2
          on conflict do nothing
        `,
        [row.canonical_id, row.duplicate_id],
      );
      await transaction.query(`delete from catalog_models where id = $1`, [row.duplicate_id]);
    }

    await transaction.query(`delete from provider_connection_catalog_models`);
    await transaction.query(`
      insert into provider_connection_catalog_models (
        provider_connection_id,
        catalog_model_id
      )
      select source_provider_connection_id, id
      from catalog_models
    `);

    await transaction.query(`
      alter table catalog_models
      alter column source_provider_connection_id set not null,
      alter column source_provider_connection_label set not null,
      alter column source_provider set not null
    `);
    await transaction.query(`
      alter table catalog_models
      drop constraint if exists catalog_models_organization_id_protocol_model_id_source_provider_connection_id_key
    `);
    await transaction.query(`
      drop index if exists catalog_models_organization_id_protocol_model_id_source_provider_connection_id_key
    `);
    await transaction.query(`
      alter table catalog_models
      add constraint catalog_models_organization_id_protocol_model_id_source_provider_connection_id_key
      unique (organization_id, protocol, model_id, source_provider_connection_id)
    `);
  });
}

export async function runMigrations(db: Database) {
  await db.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const appliedRows = await db.query<{ version: string }>("select version from schema_migrations");
  const applied = new Set(appliedRows.rows.map((row: { version: string }) => row.version));
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf-8");
    const normalizedSql = stripUnsupportedMigrationStatements(sql);

    if (db.kind === "pglite") {
      if (normalizedSql.length > 0) {
        await db.exec?.(normalizedSql);
      }
      await db.query("insert into schema_migrations (version) values ($1)", [file]);
      continue;
    }

    await withTransaction(db, async (transaction) => {
      if (normalizedSql.length > 0) {
        await transaction.query(normalizedSql);
      }
      await transaction.query("insert into schema_migrations (version) values ($1)", [file]);
    });
  }

  await assertRequiredRelations(db, requiredPostMigrationRelations);
  await repairWorkspaceModelCatalogSchema(db);
  await assertWorkspaceModelCatalogSchema(db);
}

export function slugifyName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeSlugInput(value: string, fieldName: string) {
  const slug = slugifyName(value);
  if (!slug) {
    throw new DatabaseValidationError(`${fieldName} must contain at least one letter or number`);
  }

  return slug;
}

function resolveSlugInput(inputSlug: string | undefined, fallbackName: string) {
  return inputSlug !== undefined
    ? normalizeSlugInput(inputSlug, "slug")
    : normalizeSlugInput(fallbackName, "name");
}

function normalizeRecordStrings(value: unknown) {
  const normalized: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalized;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalizedKey = key.trim();
    const normalizedValue = entry.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }

    normalized[normalizedKey] = normalizedValue;
  }

  return normalized;
}

export function normalizeProviderBaseUrl(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new DatabaseValidationError("Provider base URL must not be empty");
  }

  let url: URL;
  try {
    url = new URL(trimmedValue);
  } catch {
    throw new DatabaseValidationError("Provider base URL must be a valid absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DatabaseValidationError("Provider base URL must use http or https");
  }

  url.hash = "";
  url.search = "";

  let pathname = url.pathname.replace(/\/+$/g, "");
  if (pathname === "/") {
    pathname = "";
  }

  if (pathname.toLowerCase().endsWith("/v1")) {
    pathname = pathname.slice(0, -3);
  }

  const serializedPathname = pathname.replace(/\/+$/g, "");
  return `${url.origin}${serializedPathname}`;
}

export function normalizeProviderConnectionMetadata(metadata: Record<string, string>) {
  const normalized = normalizeRecordStrings(metadata);
  const normalizedMetadata: Record<string, string> = {};

  for (const [key, value] of Object.entries(normalized)) {
    if (key === "baseUrl" || key === "apiBase") {
      normalizedMetadata.baseUrl = normalizeProviderBaseUrl(value);
      continue;
    }

    normalizedMetadata[key] = value;
  }

  return normalizedMetadata;
}

export function getCurrentBudgetPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

type BudgetAlertDedupeKind = "soft-limit" | "hard-limit" | "preflight-block" | "pricing-unavailable";

function normalizeBudgetAlertDedupeSegment(value: string) {
  return value.trim().toLowerCase();
}

export function buildBudgetAlertDedupeKey(args: {
  budgetPolicyId: string;
  kind: BudgetAlertDedupeKind;
  periodKey?: string | null;
  provider?: string | null;
  model?: string | null;
}) {
  switch (args.kind) {
    case "pricing-unavailable": {
      if (!args.provider || !args.model) {
        throw new DatabaseValidationError("pricing-unavailable budget alert dedupe key requires provider and model");
      }

      return [
        "budget",
        args.budgetPolicyId,
        args.kind,
        normalizeBudgetAlertDedupeSegment(args.provider),
        normalizeBudgetAlertDedupeSegment(args.model),
      ].join(":");
    }
    case "preflight-block": {
      if (!args.periodKey || !args.model) {
        throw new DatabaseValidationError("preflight-block budget alert dedupe key requires periodKey and model");
      }

      return [
        "budget",
        args.budgetPolicyId,
        args.kind,
        args.periodKey,
        normalizeBudgetAlertDedupeSegment(args.model),
      ].join(":");
    }
    default: {
      if (!args.periodKey) {
        throw new DatabaseValidationError("budget threshold alert dedupe key requires periodKey");
      }

      return ["budget", args.budgetPolicyId, args.kind, args.periodKey].join(":");
    }
  }
}

export function getBudgetScopeKind(policy: Pick<BudgetPolicy, "projectId" | "environmentId" | "environment">) {
  if (policy.environmentId || policy.environment) {
    return "environment" as const;
  }
  if (policy.projectId) {
    return "project" as const;
  }
  return "workspace" as const;
}

export function getBudgetSoftLimitUsd(policy: Pick<BudgetPolicy, "monthlyUsdLimit" | "softLimitPercent">) {
  return Number(((policy.monthlyUsdLimit * policy.softLimitPercent) / 100).toFixed(6));
}

export function doesBudgetPolicyApply(
  policy: Pick<BudgetPolicy, "workspaceId" | "projectId" | "environmentId" | "environment" | "status">,
  scope: {
    workspaceId: string;
    projectId: string | null;
    environmentId: string | null;
    environment: BudgetPolicy["environment"];
  },
) {
  if (policy.status !== "active") {
    return false;
  }
  if (policy.workspaceId !== scope.workspaceId) {
    return false;
  }
  if (policy.projectId && policy.projectId !== scope.projectId) {
    return false;
  }
  if (policy.environmentId && policy.environmentId !== scope.environmentId) {
    return false;
  }
  if (policy.environment && policy.environment !== scope.environment) {
    return false;
  }
  return true;
}

function mapOrganization(row: DbRow): Organization {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    customerId: row.customer_id ? String(row.customer_id) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapOrganizationSummary(row: DbRow): OrganizationSummary {
  return {
    ...mapOrganization(row),
    workspaceCount: Number(row.workspace_count ?? 0),
  };
}

function parseStoredStringArray(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean);
      }
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function mapControlPlaneOperator(row: DbRow): ControlPlaneOperator {
  return ControlPlaneOperatorSchema.parse({
    id: String(row.id),
    organizationId: String(row.organization_id),
    email: String(row.email),
    name: String(row.name),
    status: String(row.status),
    provisioningSource: String(row.provisioning_source),
    guideExitedWorkspaceIds: parseStoredStringArray(row.guide_exited_workspace_ids, []),
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : null,
    lastActiveAt: row.last_active_at ? new Date(String(row.last_active_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapIdentityProvider(row: DbRow): IdentityProvider {
  return IdentityProviderSchema.parse({
    id: String(row.id),
    organizationId: String(row.organization_id),
    providerType: String(row.provider_type),
    issuer: String(row.issuer),
    authorizationEndpoint: String(row.authorization_endpoint),
    tokenEndpoint: String(row.token_endpoint),
    userinfoEndpoint: row.userinfo_endpoint ? String(row.userinfo_endpoint) : null,
    jwksUri: String(row.jwks_uri),
    clientId: String(row.client_id),
    scopes: parseStoredStringArray(row.scopes, ["openid", "email", "profile"]),
    domainHint: row.domain_hint ? String(row.domain_hint) : null,
    status: String(row.status),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapWorkspace(row: DbRow): Workspace {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    slug: String(row.slug),
    name: String(row.name),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapWorkspaceOption(row: DbRow): WorkspaceOption {
  return {
    ...mapWorkspace(row),
    organizationName: String(row.organization_name),
  };
}

function mapProject(row: DbRow): Project {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    slug: String(row.slug),
    name: String(row.name),
    status: String(row.status) as Project["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapEnvironment(row: DbRow): Environment {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    slug: String(row.slug),
    name: String(row.name),
    runtime: String(row.runtime) as Environment["runtime"],
    status: String(row.status) as Environment["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function normalizeStoredMemberRoles(
  primaryRole: string,
  roles: readonly string[] | null | undefined,
): Member["role"][] {
  if (roles === null || roles === undefined || roles.length === 0) {
    const normalizedPrimaryRole = normalizeMemberRole(primaryRole) ?? "developer";
    return [normalizedPrimaryRole];
  }

  const normalizedRoles = roles
    .map((role) => normalizeMemberRole(String(role)))
    .filter((role): role is Member["role"] => role !== null);

  if (normalizedRoles.length > 0) {
    return [...new Set(normalizedRoles)];
  }

  return roles.includes(unassignedMemberRoleSentinel)
    ? []
    : [normalizeMemberRole(primaryRole) ?? "developer"];
}

function mapMember(row: DbRow): Member {
  const role = normalizeMemberRole(String(row.role)) ?? "developer";
  const roles = normalizeStoredMemberRoles(String(row.role), row.roles as string[] | undefined);

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    email: String(row.email),
    name: String(row.name),
    role,
    roles,
    status: String(row.status) as Member["status"],
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : null,
    lastActiveAt: row.last_active_at ? new Date(String(row.last_active_at)).toISOString() : null,
    temporaryAccessExpiresAt: row.temporary_access_expires_at
      ? new Date(String(row.temporary_access_expires_at)).toISOString()
      : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapActiveMemberIdentity(row: DbRow): ActiveMemberIdentity {
  return {
    ...mapMember(row),
    workspaceName: String(row.workspace_name),
    organizationId: String(row.organization_id),
    organizationName: String(row.organization_name),
    organizationSlug: String(row.organization_slug),
  };
}

function mapMemberProjectAssignment(row: DbRow): MemberProjectAssignment {
  return {
    memberId: String(row.member_id),
    projectId: String(row.project_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function getStoredProviderConnectionMetadata(row: DbRow) {
  const rawMetadata = normalizeRecordStrings((row.metadata as Record<string, string> | undefined) ?? {});

  try {
    return normalizeProviderConnectionMetadata(rawMetadata);
  } catch {
    return rawMetadata;
  }
}

function getStoredProviderConnectionPricingConfig(row: DbRow): ProviderPricingConfig | null {
  const rawPricingConfig =
    row.pricing_config && typeof row.pricing_config === "object" && !Array.isArray(row.pricing_config)
      ? row.pricing_config
      : null;

  if (!rawPricingConfig) {
    return null;
  }

  const parsed = ProviderPricingConfigSchema.safeParse(rawPricingConfig);
  return parsed.success ? parsed.data : null;
}

function mapProviderConnection(row: DbRow): ProviderConnection {
  const metadata = getStoredProviderConnectionMetadata(row);
  const pricingConfig = getStoredProviderConnectionPricingConfig(row);

  return {
    id: String(row.id),
    organizationId:
      row.organization_id === null || row.organization_id === undefined ? undefined : String(row.organization_id),
    workspaceId: String(row.workspace_id),
    provider: String(row.provider) as ProviderConnection["provider"],
    label: String(row.label),
    metadata,
    pricingConfig,
    baseUrl: metadata.baseUrl ?? null,
    anthropicVersion: metadata.anthropicVersion ?? null,
    status: String(row.status) as ProviderConnection["status"],
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    lastTestedAt: row.last_tested_at ? new Date(String(row.last_tested_at)).toISOString() : null,
    lastTestStatus:
      row.last_test_status ? (String(row.last_test_status) as ProviderConnection["lastTestStatus"]) : null,
    lastTestError: row.last_test_error ? String(row.last_test_error) : null,
    lastTestStatusCode:
      row.last_test_status_code === null || row.last_test_status_code === undefined
        ? null
        : Number(row.last_test_status_code),
    lastTestLatencyMs:
      row.last_test_latency_ms === null || row.last_test_latency_ms === undefined
        ? null
        : Number(row.last_test_latency_ms),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapStoredIdentityProvider(row: DbRow): StoredIdentityProvider {
  return {
    ...mapIdentityProvider(row),
    encryptedClientSecret: row.encrypted_client_secret ? String(row.encrypted_client_secret) : null,
  };
}

function mapExternalIdentity(row: DbRow): ExternalIdentityRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    identityProviderId: String(row.identity_provider_id),
    operatorId: String(row.operator_id),
    issuer: String(row.issuer),
    subject: String(row.subject),
    email: row.email ? String(row.email) : null,
    emailVerified: Boolean(row.email_verified),
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapControlPlaneSessionRecord(row: DbRow): ControlPlaneSessionRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    organizationSlug: String(row.organization_slug),
    operatorId: String(row.operator_id),
    operatorEmail: String(row.operator_email),
    operatorName: String(row.operator_name),
    operatorStatus: String(row.operator_status) as ControlPlaneSessionRecord["operatorStatus"],
    identityProviderId: String(row.identity_provider_id),
    externalIdentityId: String(row.external_identity_id),
    email: String(row.email),
    amr: parseStoredStringArray(row.amr, []),
    issuedAt: new Date(String(row.issued_at)).toISOString(),
    lastSeenAt: new Date(String(row.last_seen_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    idleExpiresAt: new Date(String(row.idle_expires_at)).toISOString(),
    activeMembershipId: row.active_membership_id ? String(row.active_membership_id) : null,
    activeRole: row.active_role ? String(row.active_role) : null,
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    userAgent: row.user_agent ? String(row.user_agent) : null,
  };
}

function mapVirtualKey(row: DbRow): VirtualKey {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    providerConnectionId: row.provider_connection_id ? String(row.provider_connection_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    environment: String(row.environment) as VirtualKey["environment"],
    label: String(row.label),
    owner: row.owner ? String(row.owner) : null,
    team: row.team ? String(row.team) : null,
    service: row.service ? String(row.service) : null,
    issuanceMode:
      row.issuance_mode && String(row.issuance_mode) === "self_serve" ? "self_serve" : "admin",
    issuedByMemberId: row.issued_by_member_id ? String(row.issued_by_member_id) : null,
    keyPrefix: String(row.key_prefix),
    status: String(row.status) as VirtualKey["status"],
    scopes: normalizeVirtualKeyScopes(Array.isArray(row.scopes) ? (row.scopes as string[]) : []),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : null,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapBudgetPolicy(row: DbRow): BudgetPolicy {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: row.project_id ? String(row.project_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    environment: row.environment ? (String(row.environment) as BudgetPolicy["environment"]) : null,
    monthlyUsdLimit: Number(row.monthly_usd_limit),
    softLimitPercent: Number(row.soft_limit_percent),
    status: String(row.status) as BudgetPolicy["status"],
    exceptionStatus: row.exception_status
      ? (String(row.exception_status) as BudgetPolicy["exceptionStatus"])
      : "none",
    exceptionReason: row.exception_reason ? String(row.exception_reason) : null,
    exceptionRequestedBy: row.exception_requested_by ? String(row.exception_requested_by) : null,
    exceptionRequestedAt: row.exception_requested_at
      ? new Date(String(row.exception_requested_at)).toISOString()
      : null,
    exceptionReviewedBy: row.exception_reviewed_by ? String(row.exception_reviewed_by) : null,
    exceptionReviewedAt: row.exception_reviewed_at
      ? new Date(String(row.exception_reviewed_at)).toISOString()
      : null,
    exceptionReviewNote: row.exception_review_note ? String(row.exception_review_note) : null,
    exceptionExpiresAt: row.exception_expires_at ? new Date(String(row.exception_expires_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  };
}

function mapUsageEvent(row: DbRow): UsageEvent {
  const promptTokens = Number(row.prompt_tokens ?? 0);
  const completionTokens = Number(row.completion_tokens ?? 0);
  return {
    id: String(row.id),
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    virtualKeyId: row.virtual_key_id ? String(row.virtual_key_id) : null,
    providerConnectionId: row.provider_connection_id ? String(row.provider_connection_id) : null,
    requestId: row.request_id ? String(row.request_id) : null,
    providerRequestId: row.provider_request_id ? String(row.provider_request_id) : null,
    provider: row.provider ? (String(row.provider) as UsageEvent["provider"]) : null,
    model: row.model ? String(row.model) : null,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: Number(row.cost_usd),
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    status: String(row.status) as UsageEvent["status"],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapModelMapping(row: DbRow): ModelMapping {
  return {
    id: String(row.id),
    provider: String(row.provider) as ModelMapping["provider"],
    providerModel: String(row.provider_model),
    canonicalModel: String(row.canonical_model),
    modelFamily: row.model_family ? String(row.model_family) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  };
}

function readRequiredCatalogModelSourceField(
  row: DbRow,
  fieldName: "source_provider_connection_id" | "source_provider_connection_label" | "source_provider",
) {
  const value = row[fieldName];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new DatabaseSchemaDriftError(
    "workspace_model_catalog",
    `catalog_models.${fieldName} is missing or null`,
  );
}

function mapCatalogModel(row: DbRow): CatalogModel {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    modelId: String(row.model_id),
    label: String(row.label),
    protocol: String(row.protocol) as CatalogModel["protocol"],
    sourceProviderConnectionId: readRequiredCatalogModelSourceField(row, "source_provider_connection_id"),
    sourceProviderConnectionLabel: readRequiredCatalogModelSourceField(row, "source_provider_connection_label"),
    sourceProvider: readRequiredCatalogModelSourceField(row, "source_provider") as CatalogModel["sourceProvider"],
    status: String(row.status) as CatalogModel["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  };
}

function mapPriceSnapshot(row: DbRow): PriceSnapshot {
  return {
    id: String(row.id),
    provider: String(row.provider) as PriceSnapshot["provider"],
    providerConnectionId: row.provider_connection_id ? String(row.provider_connection_id) : null,
    providerModel: String(row.provider_model),
    canonicalModel: String(row.canonical_model),
    inputUsdPerMillion: Number(row.input_usd_per_million),
    outputUsdPerMillion: Number(row.output_usd_per_million),
    cachedInputUsdPerMillion:
      row.cached_input_usd_per_million === null || row.cached_input_usd_per_million === undefined
        ? null
        : Number(row.cached_input_usd_per_million),
    cacheReadInputUsdPerMillion:
      row.cache_read_input_usd_per_million === null || row.cache_read_input_usd_per_million === undefined
        ? null
        : Number(row.cache_read_input_usd_per_million),
    cacheWrite5mInputUsdPerMillion:
      row.cache_write_5m_input_usd_per_million === null || row.cache_write_5m_input_usd_per_million === undefined
        ? null
        : Number(row.cache_write_5m_input_usd_per_million),
    cacheWrite1hInputUsdPerMillion:
      row.cache_write_1h_input_usd_per_million === null || row.cache_write_1h_input_usd_per_million === undefined
        ? null
        : Number(row.cache_write_1h_input_usd_per_million),
    longContextThresholdInputTokens:
      row.long_context_threshold_input_tokens === null || row.long_context_threshold_input_tokens === undefined
        ? null
        : Number(row.long_context_threshold_input_tokens),
    longContextInputUsdPerMillion:
      row.long_context_input_usd_per_million === null || row.long_context_input_usd_per_million === undefined
        ? null
        : Number(row.long_context_input_usd_per_million),
    longContextOutputUsdPerMillion:
      row.long_context_output_usd_per_million === null || row.long_context_output_usd_per_million === undefined
        ? null
        : Number(row.long_context_output_usd_per_million),
    longContextCacheReadInputUsdPerMillion:
      row.long_context_cache_read_input_usd_per_million === null ||
      row.long_context_cache_read_input_usd_per_million === undefined
        ? null
        : Number(row.long_context_cache_read_input_usd_per_million),
    longContextCacheWrite5mInputUsdPerMillion:
      row.long_context_cache_write_5m_input_usd_per_million === null ||
      row.long_context_cache_write_5m_input_usd_per_million === undefined
        ? null
        : Number(row.long_context_cache_write_5m_input_usd_per_million),
    longContextCacheWrite1hInputUsdPerMillion:
      row.long_context_cache_write_1h_input_usd_per_million === null ||
      row.long_context_cache_write_1h_input_usd_per_million === undefined
        ? null
        : Number(row.long_context_cache_write_1h_input_usd_per_million),
    pricingSource: String(row.pricing_source) as PriceSnapshot["pricingSource"],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    capturedAt: new Date(String(row.captured_at)).toISOString(),
  };
}

function formatDateOnlyParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatStableDateOnly(value: Date) {
  const isLocalMidnight =
    value.getHours() === 0 &&
    value.getMinutes() === 0 &&
    value.getSeconds() === 0 &&
    value.getMilliseconds() === 0;
  const isUtcMidnight =
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;

  if (isLocalMidnight && !isUtcMidnight) {
    return formatDateOnlyParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  return formatDateOnlyParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function normalizeDateOnlyValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : formatStableDateOnly(parsed);
  }

  if (value instanceof Date) {
    return formatStableDateOnly(value);
  }

  const serialized = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(serialized)) {
    return serialized;
  }

  const parsed = new Date(serialized);
  return Number.isNaN(parsed.getTime()) ? serialized : formatStableDateOnly(parsed);
}

function mapUsageLedgerEntry(row: DbRow): UsageLedgerEntry {
  return {
    id: String(row.id),
    usageEventId: String(row.usage_event_id),
    organizationId: row.organization_id ? String(row.organization_id) : null,
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    providerConnectionId: row.provider_connection_id ? String(row.provider_connection_id) : null,
    virtualKeyId: row.virtual_key_id ? String(row.virtual_key_id) : null,
    owner: row.owner ? String(row.owner) : null,
    provider: row.provider ? (String(row.provider) as UsageLedgerEntry["provider"]) : null,
    providerModel: row.provider_model ? String(row.provider_model) : null,
    canonicalModel: row.canonical_model ? String(row.canonical_model) : null,
    modelFamily: row.model_family ? String(row.model_family) : null,
    priceSnapshotId: row.price_snapshot_id ? String(row.price_snapshot_id) : null,
    pricingSource: String(row.pricing_source) as UsageLedgerEntry["pricingSource"],
    inputUsdPerMillion:
      row.input_usd_per_million === null || row.input_usd_per_million === undefined
        ? null
        : Number(row.input_usd_per_million),
    outputUsdPerMillion:
      row.output_usd_per_million === null || row.output_usd_per_million === undefined
        ? null
        : Number(row.output_usd_per_million),
    cachedInputUsdPerMillion:
      row.cached_input_usd_per_million === null || row.cached_input_usd_per_million === undefined
        ? null
        : Number(row.cached_input_usd_per_million),
    cacheReadInputUsdPerMillion:
      row.cache_read_input_usd_per_million === null || row.cache_read_input_usd_per_million === undefined
        ? null
        : Number(row.cache_read_input_usd_per_million),
    cacheWrite5mInputUsdPerMillion:
      row.cache_write_5m_input_usd_per_million === null || row.cache_write_5m_input_usd_per_million === undefined
        ? null
        : Number(row.cache_write_5m_input_usd_per_million),
    cacheWrite1hInputUsdPerMillion:
      row.cache_write_1h_input_usd_per_million === null || row.cache_write_1h_input_usd_per_million === undefined
        ? null
        : Number(row.cache_write_1h_input_usd_per_million),
    longContextThresholdInputTokens:
      row.long_context_threshold_input_tokens === null || row.long_context_threshold_input_tokens === undefined
        ? null
        : Number(row.long_context_threshold_input_tokens),
    longContextInputUsdPerMillion:
      row.long_context_input_usd_per_million === null || row.long_context_input_usd_per_million === undefined
        ? null
        : Number(row.long_context_input_usd_per_million),
    longContextOutputUsdPerMillion:
      row.long_context_output_usd_per_million === null || row.long_context_output_usd_per_million === undefined
        ? null
        : Number(row.long_context_output_usd_per_million),
    longContextCacheReadInputUsdPerMillion:
      row.long_context_cache_read_input_usd_per_million === null ||
      row.long_context_cache_read_input_usd_per_million === undefined
        ? null
        : Number(row.long_context_cache_read_input_usd_per_million),
    longContextCacheWrite5mInputUsdPerMillion:
      row.long_context_cache_write_5m_input_usd_per_million === null ||
      row.long_context_cache_write_5m_input_usd_per_million === undefined
        ? null
        : Number(row.long_context_cache_write_5m_input_usd_per_million),
    longContextCacheWrite1hInputUsdPerMillion:
      row.long_context_cache_write_1h_input_usd_per_million === null ||
      row.long_context_cache_write_1h_input_usd_per_million === undefined
        ? null
        : Number(row.long_context_cache_write_1h_input_usd_per_million),
    status: String(row.status) as UsageLedgerEntry["status"],
    requestId: row.request_id ? String(row.request_id) : null,
    providerRequestId: row.provider_request_id ? String(row.provider_request_id) : null,
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    eventDate: normalizeDateOnlyValue(row.event_date),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapUsageForecastDaily(row: DbRow): UsageForecastDaily {
  return {
    id: String(row.id),
    bucketDate: String(row.bucket_date),
    organizationId: row.organization_id ? String(row.organization_id) : null,
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    provider: row.provider ? (String(row.provider) as UsageForecastDaily["provider"]) : null,
    owner: row.owner ? String(row.owner) : null,
    canonicalModel: row.canonical_model ? String(row.canonical_model) : null,
    requestCount: Number(row.request_count ?? 0),
    totalPromptTokens: Number(row.total_prompt_tokens ?? 0),
    totalCompletionTokens: Number(row.total_completion_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? 0),
    firstEventAt: row.first_event_at ? new Date(String(row.first_event_at)).toISOString() : null,
    lastEventAt: row.last_event_at ? new Date(String(row.last_event_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  };
}

function mapAuditLog(row: DbRow): AuditLog {
  return {
    id: String(row.id),
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    actorType: String(row.actor_type),
    actorId: String(row.actor_id),
    action: String(row.action),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function createDefaultPromptPolicy(workspaceId: string): PromptPolicy {
  const now = new Date().toISOString();
  return PromptPolicySchema.parse({
    workspaceId,
    enabled: false,
    enforcementMode: "graded",
    evidenceMode: "redacted_snippet",
    reviewThreshold: 60,
    blockThreshold: 100,
    allowedExternalDomains: [],
    allowedKeywordOverrides: [],
    disabledRuleIds: [],
    createdAt: now,
    updatedAt: now,
  });
}

function mapPromptPolicy(row: DbRow): PromptPolicy {
  return PromptPolicySchema.parse({
    workspaceId: String(row.workspace_id),
    enabled: Boolean(row.enabled),
    enforcementMode:
      row.enforcement_mode
        ? PromptPolicyEnforcementModeSchema.parse(String(row.enforcement_mode))
        : "graded",
    evidenceMode:
      row.evidence_mode
        ? PromptPolicyEvidenceModeSchema.parse(String(row.evidence_mode))
        : "redacted_snippet",
    reviewThreshold: Number(row.review_threshold ?? 60),
    blockThreshold: Number(row.block_threshold ?? 100),
    allowedExternalDomains: Array.isArray(row.allowed_external_domains)
      ? (row.allowed_external_domains as string[])
      : [],
    allowedKeywordOverrides: Array.isArray(row.allowed_keyword_overrides)
      ? (row.allowed_keyword_overrides as string[])
      : [],
    disabledRuleIds: Array.isArray(row.disabled_rule_ids)
      ? (row.disabled_rule_ids as string[])
      : [],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  });
}

function mapPromptInspection(row: DbRow): PromptInspection {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: row.project_id ? String(row.project_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    virtualKeyId: row.virtual_key_id ? String(row.virtual_key_id) : null,
    providerConnectionId: row.provider_connection_id ? String(row.provider_connection_id) : null,
    usageEventId: row.usage_event_id ? String(row.usage_event_id) : null,
    requestId: String(row.request_id),
    provider: row.provider ? (String(row.provider) as PromptInspection["provider"]) : null,
    model: row.model ? String(row.model) : null,
    verdict: String(row.verdict) as PromptInspection["verdict"],
    score: Number(row.score ?? 0),
    topActivityLabel: String(row.top_activity_label) as PromptInspection["topActivityLabel"],
    riskCategories: Array.isArray(row.risk_categories)
      ? (row.risk_categories as PromptInspection["riskCategories"])
      : [],
    hitRuleIds: Array.isArray(row.hit_rule_ids) ? (row.hit_rule_ids as string[]) : [],
    redactedEvidence: Array.isArray(row.redacted_evidence) ? (row.redacted_evidence as string[]) : [],
    simhash: row.simhash ? String(row.simhash) : null,
    truncated: Boolean(row.truncated),
    contextCounts: (row.context_counts as Record<string, unknown>) ?? {},
    reviewStatus: PromptInspectionReviewStatusSchema.parse(String(row.review_status)),
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewNote: row.review_note ? String(row.review_note) : null,
    reviewedAt: row.reviewed_at ? new Date(String(row.reviewed_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapExportJob(row: DbRow): ExportJob {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: String(row.kind) as ExportJob["kind"],
    format: String(row.format) as ExportJob["format"],
    status: String(row.status) as ExportJob["status"],
    fileName: String(row.file_name),
    filters: normalizeExportFilters(((row.filters as Record<string, unknown>) ?? {}) as Record<string, unknown>),
    rowCount: row.row_count === null || row.row_count === undefined ? null : Number(row.row_count),
    errorMessage: row.error_message ? String(row.error_message) : null,
    downloadPath:
      String(row.status) === "completed" && row.object_key ? `/v1/export-jobs/${String(row.id)}/download` : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    startedAt: row.started_at ? new Date(String(row.started_at)).toISOString() : null,
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
    attemptCount: row.attempt_count === null || row.attempt_count === undefined ? 0 : Number(row.attempt_count),
  };
}

function mapSavedView(row: DbRow): SavedView {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    surface: String(row.surface) as SavedView["surface"],
    name: String(row.name),
    filters: (row.filters as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
    lastOpenedAt: row.last_opened_at ? new Date(String(row.last_opened_at)).toISOString() : null,
  };
}

function mapScheduledReport(row: DbRow): ScheduledReport {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: String(row.kind) as ScheduledReport["kind"],
    format: String(row.format) as ScheduledReport["format"],
    name: String(row.name),
    filters: normalizeExportFilters(((row.filters as Record<string, unknown>) ?? {}) as Record<string, unknown>),
    cadence: String(row.cadence) as ScheduledReport["cadence"],
    nextRunAt: new Date(String(row.next_run_at)).toISOString(),
    lastRunAt: row.last_run_at ? new Date(String(row.last_run_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  };
}

function mapAlert(row: DbRow): Alert {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    severity: String(row.severity) as Alert["severity"],
    code: String(row.code),
    title: String(row.title),
    body: String(row.body),
    status: String(row.status) as Alert["status"],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null,
  };
}

export function encryptSecret(secret: string, encryptionKeyBase64: string) {
  const key = Buffer.from(encryptionKeyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY_BASE64 must decode to 32 bytes");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(cipherText: string, encryptionKeyBase64: string) {
  const key = Buffer.from(encryptionKeyBase64, "base64");
  const payload = Buffer.from(cipherText, "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf-8");
}

export class ProviderConnectionCredentialDecryptionError extends Error {
  readonly providerConnectionId: string;

  constructor(providerConnectionId: string, cause?: unknown) {
    super(
      `Stored provider credential for connection ${providerConnectionId} could not be decrypted`,
      cause ? { cause } : undefined,
    );
    this.name = "ProviderConnectionCredentialDecryptionError";
    this.providerConnectionId = providerConnectionId;
  }
}

export class ProviderConnectionCredentialKeyMismatchError extends Error {
  readonly providerConnectionId: string;
  readonly storedFingerprint: string;
  readonly currentFingerprint: string;

  constructor(args: {
    providerConnectionId: string;
    storedFingerprint: string;
    currentFingerprint: string;
  }) {
    super(
      `Stored provider credential for connection ${args.providerConnectionId} was encrypted with a different runtime key`,
    );
    this.name = "ProviderConnectionCredentialKeyMismatchError";
    this.providerConnectionId = args.providerConnectionId;
    this.storedFingerprint = args.storedFingerprint;
    this.currentFingerprint = args.currentFingerprint;
  }
}

export function deriveCredentialKeyFingerprint(encryptionKeyBase64: string) {
  return createHash("sha256")
    .update(Buffer.from(encryptionKeyBase64, "base64"))
    .digest("hex");
}

export async function listOrganizations(db: Database) {
  const result = await db.query("select * from organizations order by created_at desc");
  return result.rows.map(mapOrganization);
}

export async function listOrganizationSummaries(db: Database) {
  const result = await db.query(
    `
      select
        o.*,
        count(w.id)::int as workspace_count
      from organizations o
      left join workspaces w on w.organization_id = o.id
      group by o.id, o.slug, o.name, o.created_at, o.updated_at
      order by o.created_at desc
    `,
  );

  return result.rows.map(mapOrganizationSummary);
}

export async function listOrganizationsByMemberEmail(db: Database, email: string) {
  const result = await db.query(
    `
      select distinct o.*
      from organizations o
      inner join workspaces w on w.organization_id = o.id
      inner join members m on m.workspace_id = w.id
      where lower(m.email) = lower($1)
        and m.status = 'active'
      order by o.created_at desc
    `,
    [email],
  );

  return result.rows.map(mapOrganization);
}

export async function listOrganizationSummariesByMemberEmail(db: Database, email: string) {
  const result = await db.query(
    `
      select
        o.*,
        count(distinct w.id)::int as workspace_count
      from organizations o
      inner join workspaces w on w.organization_id = o.id
      inner join members m on m.workspace_id = w.id
      where lower(m.email) = lower($1)
        and m.status = 'active'
      group by o.id, o.slug, o.name, o.created_at, o.updated_at
      order by o.created_at desc
    `,
    [email],
  );

  return result.rows.map(mapOrganizationSummary);
}

export async function findOrganizationById(db: Database, organizationId: string) {
  const result = await db.query("select * from organizations where id = $1 limit 1", [organizationId]);
  if (!result.rowCount) {
    return null;
  }

  return mapOrganization(result.rows[0]);
}

export async function findOrganizationBySlug(db: Database, organizationSlug: string) {
  const result = await db.query("select * from organizations where lower(slug) = lower($1) limit 1", [organizationSlug]);
  if (!result.rowCount) {
    return null;
  }

  return mapOrganization(result.rows[0]);
}

export async function listActiveMembersByOrganizationAndEmail(db: Database, organizationId: string, email: string) {
  const result = await db.query(
    `
      select m.*
      from members m
      inner join workspaces w on w.id = m.workspace_id
      where w.organization_id = $1
        and lower(m.email) = lower($2)
        and m.status = 'active'
      order by m.created_at desc
    `,
    [organizationId, email],
  );

  return result.rows.map(mapMember);
}

export async function listActiveMemberIdentitiesByEmail(db: Database, email: string) {
  const result = await db.query(
    `
      select
        m.*,
        w.name as workspace_name,
        o.id as organization_id,
        o.name as organization_name,
        o.slug as organization_slug
      from members m
      inner join workspaces w on w.id = m.workspace_id
      inner join organizations o on o.id = w.organization_id
      where lower(m.email) = lower($1)
        and m.status = 'active'
      order by o.created_at desc, w.created_at desc, m.created_at desc
    `,
    [email],
  );

  return result.rows.map(mapActiveMemberIdentity);
}

export async function hasOrganizationOwnerMembership(db: Database, organizationId: string, email: string) {
  const result = await db.query(
    `
      select m.id
      from members m
      inner join workspaces w on w.id = m.workspace_id
      where w.organization_id = $1
        and lower(m.email) = lower($2)
        and m.status = 'active'
        and m.role = 'organization_owner'
      limit 1
    `,
    [organizationId, email],
  );

  return result.rowCount > 0;
}

export async function findControlPlaneOperatorById(db: Database, operatorId: string) {
  const result = await db.query("select * from control_plane_operators where id = $1 limit 1", [operatorId]);
  if (!result.rowCount) {
    return null;
  }

  return mapControlPlaneOperator(result.rows[0]);
}

export async function findControlPlaneOperatorByOrganizationAndEmail(
  db: Database,
  organizationId: string,
  email: string,
) {
  const result = await db.query(
    `
      select *
      from control_plane_operators
      where organization_id = $1
        and lower(email) = lower($2)
      limit 1
    `,
    [organizationId, email],
  );
  if (!result.rowCount) {
    return null;
  }

  return mapControlPlaneOperator(result.rows[0]);
}

export async function upsertControlPlaneOperator(
  db: Database,
  input: {
    organizationId: string;
    email: string;
    name: string;
    provisioningSource: string;
  },
) {
  return withTransaction(db, async (transaction) => {
    const existing = await transaction.query(
      `
        select *
        from control_plane_operators
        where organization_id = $1
          and lower(email) = lower($2)
        limit 1
      `,
      [input.organizationId, input.email],
    );

    if (existing.rowCount) {
      const result = await transaction.query(
        `
          update control_plane_operators
          set
            name = $3,
            status = 'active',
            provisioning_source = $4,
            updated_at = now()
          where organization_id = $1
            and lower(email) = lower($2)
          returning *
        `,
        [input.organizationId, input.email, input.name, input.provisioningSource],
      );
      return mapControlPlaneOperator(result.rows[0]);
    }

    const result = await transaction.query(
      `
        insert into control_plane_operators (
          organization_id,
          email,
          name,
          provisioning_source
        )
        values ($1, lower($2), $3, $4)
        returning *
      `,
      [input.organizationId, input.email, input.name, input.provisioningSource],
    );
    return mapControlPlaneOperator(result.rows[0]);
  });
}

export async function recordControlPlaneOperatorActivity(
  db: Database,
  operatorId: string,
  options?: {
    recordedAt?: string;
    markLogin?: boolean;
  },
) {
  const recordedAt = options?.recordedAt ?? new Date().toISOString();
  const result = await db.query(
    `
      update control_plane_operators
      set
        last_active_at = $2::timestamptz,
        last_login_at = case
          when $3::boolean then $2::timestamptz
          else last_login_at
        end,
        updated_at = now()
      where id = $1
      returning *
    `,
    [operatorId, recordedAt, options?.markLogin ?? false],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapControlPlaneOperator(result.rows[0]);
}

export async function updateControlPlaneOperatorGuidePreference(
  db: Database,
  input: {
    operatorId: string;
    workspaceId: string;
    exited: boolean;
  },
) {
  return withTransaction(db, async (transaction) => {
    const existingOperator = await transaction.query(
      `
        select *
        from control_plane_operators
        where id = $1
        limit 1
      `,
      [input.operatorId],
    );

    if (!existingOperator.rowCount) {
      return null;
    }

    const operator = mapControlPlaneOperator(existingOperator.rows[0]);
    const nextGuideExitedWorkspaceIds = input.exited
      ? Array.from(new Set([...operator.guideExitedWorkspaceIds, input.workspaceId]))
      : operator.guideExitedWorkspaceIds.filter((workspaceId) => workspaceId !== input.workspaceId);

    const result = await transaction.query(
      `
        update control_plane_operators
        set
          guide_exited_workspace_ids = $2::jsonb,
          updated_at = now()
        where id = $1
        returning *
      `,
      [input.operatorId, JSON.stringify(nextGuideExitedWorkspaceIds)],
    );

    if (!result.rowCount) {
      return null;
    }

    return mapControlPlaneOperator(result.rows[0]);
  });
}

export async function getStoredIdentityProviderByOrganizationId(db: Database, organizationId: string) {
  const result = await db.query(
    `
      select *
      from identity_providers
      where organization_id = $1
      limit 1
    `,
    [organizationId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapStoredIdentityProvider(result.rows[0]);
}

export async function getIdentityProviderByOrganizationId(db: Database, organizationId: string) {
  const identityProvider = await getStoredIdentityProviderByOrganizationId(db, organizationId);
  if (!identityProvider) {
    return null;
  }

  return IdentityProviderSchema.parse(identityProvider);
}

export async function upsertIdentityProvider(
  db: Database,
  organizationId: string,
  input: UpsertIdentityProviderInput,
  encryptionKeyBase64: string,
) {
  return withTransaction(db, async (transaction) => {
    const existingResult = await transaction.query(
      "select * from identity_providers where organization_id = $1 limit 1",
      [organizationId],
    );
    const existing = existingResult.rowCount ? mapStoredIdentityProvider(existingResult.rows[0]) : null;
    const encryptedClientSecret =
      input.clientSecret === null
        ? existing?.encryptedClientSecret ?? null
        : encryptSecret(input.clientSecret, encryptionKeyBase64);

    if (existing) {
      const result = await transaction.query(
        `
          update identity_providers
          set
            provider_type = $2,
            issuer = $3,
            authorization_endpoint = $4,
            token_endpoint = $5,
            userinfo_endpoint = $6,
            jwks_uri = $7,
            client_id = $8,
            encrypted_client_secret = $9,
            scopes = $10::jsonb,
            domain_hint = $11,
            status = $12,
            updated_at = now()
          where organization_id = $1
          returning *
        `,
        [
          organizationId,
          input.providerType,
          input.issuer,
          input.authorizationEndpoint,
          input.tokenEndpoint,
          input.userinfoEndpoint,
          input.jwksUri,
          input.clientId,
          encryptedClientSecret,
          JSON.stringify(input.scopes),
          input.domainHint,
          input.status,
        ],
      );
      return mapIdentityProvider(result.rows[0]);
    }

    const result = await transaction.query(
      `
        insert into identity_providers (
          organization_id,
          provider_type,
          issuer,
          authorization_endpoint,
          token_endpoint,
          userinfo_endpoint,
          jwks_uri,
          client_id,
          encrypted_client_secret,
          scopes,
          domain_hint,
          status
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
        returning *
      `,
      [
        organizationId,
        input.providerType,
        input.issuer,
        input.authorizationEndpoint,
        input.tokenEndpoint,
        input.userinfoEndpoint,
        input.jwksUri,
        input.clientId,
        encryptedClientSecret,
        JSON.stringify(input.scopes),
        input.domainHint,
        input.status,
      ],
    );
    return mapIdentityProvider(result.rows[0]);
  });
}

export async function findExternalIdentityByProviderAndSubject(
  db: Database,
  identityProviderId: string,
  subject: string,
) {
  const result = await db.query(
    `
      select *
      from external_identities
      where identity_provider_id = $1
        and subject = $2
      limit 1
    `,
    [identityProviderId, subject],
  );
  if (!result.rowCount) {
    return null;
  }

  return mapExternalIdentity(result.rows[0]);
}

export async function upsertExternalIdentity(
  db: Database,
  input: {
    organizationId: string;
    identityProviderId: string;
    operatorId: string;
    issuer: string;
    subject: string;
    email: string | null;
    emailVerified: boolean;
    lastLoginAt: string;
  },
) {
  return withTransaction(db, async (transaction) => {
    const existing = await transaction.query(
      `
        select *
        from external_identities
        where identity_provider_id = $1
          and subject = $2
        limit 1
      `,
      [input.identityProviderId, input.subject],
    );

    if (existing.rowCount) {
      const result = await transaction.query(
        `
          update external_identities
          set
            operator_id = $3,
            email = $4,
            email_verified = $5,
            last_login_at = $6::timestamptz,
            updated_at = now()
          where identity_provider_id = $1
            and subject = $2
          returning *
        `,
        [
          input.identityProviderId,
          input.subject,
          input.operatorId,
          input.email,
          input.emailVerified,
          input.lastLoginAt,
        ],
      );
      return mapExternalIdentity(result.rows[0]);
    }

    const result = await transaction.query(
      `
        insert into external_identities (
          organization_id,
          identity_provider_id,
          operator_id,
          issuer,
          subject,
          email,
          email_verified,
          last_login_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
        returning *
      `,
      [
        input.organizationId,
        input.identityProviderId,
        input.operatorId,
        input.issuer,
        input.subject,
        input.email,
        input.emailVerified,
        input.lastLoginAt,
      ],
    );
    return mapExternalIdentity(result.rows[0]);
  });
}

export async function createControlPlaneSession(
  db: Database,
  input: {
    sessionHandleHash: string;
    organizationId: string;
    operatorId: string;
    identityProviderId: string;
    externalIdentityId: string;
    email: string;
    amr: string[];
    issuedAt: string;
    lastSeenAt: string;
    expiresAt: string;
    idleExpiresAt: string;
    activeMembershipId?: string | null;
    activeRole?: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    impersonatedByOperatorId?: string | null;
  },
) {
  const result = await db.query(
    `
      insert into control_plane_sessions (
        session_handle_hash,
        organization_id,
        operator_id,
        identity_provider_id,
        external_identity_id,
        email,
        amr,
        issued_at,
        last_seen_at,
        expires_at,
        idle_expires_at,
        active_membership_id,
        active_role,
        ip_address,
        user_agent,
        impersonated_by_operator_id
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        lower($6),
        $7::jsonb,
        $8::timestamptz,
        $9::timestamptz,
        $10::timestamptz,
        $11::timestamptz,
        $12::uuid,
        $13,
        $14,
        $15,
        $16
      )
      returning *
    `,
    [
      input.sessionHandleHash,
      input.organizationId,
      input.operatorId,
      input.identityProviderId,
      input.externalIdentityId,
      input.email,
      JSON.stringify(input.amr),
      input.issuedAt,
      input.lastSeenAt,
      input.expiresAt,
      input.idleExpiresAt,
      input.activeMembershipId ?? null,
      input.activeRole ?? null,
      input.ipAddress,
      input.userAgent,
      input.impersonatedByOperatorId ?? null,
    ],
  );

  return result.rows[0];
}

export async function findControlPlaneSessionByHandleHash(db: Database, sessionHandleHash: string) {
  const result = await db.query(
    `
      select
        s.*,
        o.slug as organization_slug,
        op.email as operator_email,
        op.name as operator_name,
        op.status as operator_status
      from control_plane_sessions s
      inner join organizations o on o.id = s.organization_id
      inner join control_plane_operators op on op.id = s.operator_id
      where s.session_handle_hash = $1
      limit 1
    `,
    [sessionHandleHash],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapControlPlaneSessionRecord(result.rows[0]);
}

export async function touchControlPlaneSession(
  db: Database,
  sessionId: string,
  input: {
    seenAt: string;
    idleExpiresAt: string;
  },
) {
  const result = await db.query(
    `
      update control_plane_sessions
      set
        last_seen_at = $2::timestamptz,
        idle_expires_at = $3::timestamptz
      where id = $1
        and revoked_at is null
      returning *
    `,
    [sessionId, input.seenAt, input.idleExpiresAt],
  );

  if (!result.rowCount) {
    return null;
  }

  return result.rows[0];
}

export async function updateControlPlaneSessionActiveIdentity(
  db: Database,
  input: {
    sessionId: string;
    activeMembershipId: string | null;
    activeRole: string | null;
  },
) {
  const result = await db.query(
    `
      update control_plane_sessions
      set
        active_membership_id = $2::uuid,
        active_role = $3
      where id = $1
        and revoked_at is null
      returning *
    `,
    [input.sessionId, input.activeMembershipId, input.activeRole],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapControlPlaneSessionRecord(result.rows[0]);
}

export async function revokeControlPlaneSession(
  db: Database,
  input: {
    sessionId: string;
    revokedAt: string;
    reason: string;
    actorType: string;
    actorId: string;
  },
) {
  return withTransaction(db, async (transaction) => {
    const updateResult = await transaction.query(
      `
        update control_plane_sessions
        set revoked_at = $2::timestamptz
        where id = $1
          and revoked_at is null
        returning *
      `,
      [input.sessionId, input.revokedAt],
    );

    if (!updateResult.rowCount) {
      return null;
    }

    await transaction.query(
      `
        insert into session_revocations (
          session_id,
          reason,
          revoked_at,
          actor_type,
          actor_id
        )
        values ($1, $2, $3::timestamptz, $4, $5)
      `,
      [input.sessionId, input.reason, input.revokedAt, input.actorType, input.actorId],
    );

    return String(updateResult.rows[0]?.id ?? input.sessionId);
  });
}

export async function revokeControlPlaneSessionsForOperator(
  db: Database,
  input: {
    organizationId: string;
    operatorId: string;
    revokedAt: string;
    reason: string;
    actorType: string;
    actorId: string;
  },
) {
  return withTransaction(db, async (transaction) => {
    const updateResult = await transaction.query(
      `
        update control_plane_sessions
        set revoked_at = $3::timestamptz
        where organization_id = $1
          and operator_id = $2
          and revoked_at is null
        returning id
      `,
      [input.organizationId, input.operatorId, input.revokedAt],
    );

    for (const row of updateResult.rows) {
      await transaction.query(
        `
          insert into session_revocations (
            session_id,
            reason,
            revoked_at,
            actor_type,
            actor_id
          )
          values ($1, $2, $3::timestamptz, $4, $5)
        `,
        [row.id, input.reason, input.revokedAt, input.actorType, input.actorId],
      );
    }

    return updateResult.rows.map((row) => String(row.id));
  });
}

export async function createOrganization(db: Database, input: CreateOrganizationInput) {
  const slug = resolveSlugInput(input.slug, input.name);
  const result = await db.query(
    `
      insert into organizations (name, slug)
      values ($1, $2)
      returning *
    `,
    [input.name, slug],
  );
  return mapOrganization(result.rows[0]);
}

export async function updateOrganization(db: Database, organizationId: string, input: UpdateOrganizationInput) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }
  if (input.slug !== undefined) {
    values.push(normalizeSlugInput(input.slug, "slug"));
    assignments.push(`slug = $${values.length}`);
  }

  if (!assignments.length) {
    return null;
  }

  values.push(organizationId);

  const result = await db.query(
    `
      update organizations
      set ${assignments.join(", ")}, updated_at = now()
      where id = $${values.length}
      returning *
    `,
    values,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapOrganization(result.rows[0]);
}

export async function deleteOrganization(db: Database, organizationId: string) {
  const result = await db.query(
    `
      delete from organizations
      where id = $1
      returning *
    `,
    [organizationId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapOrganization(result.rows[0]);
}

export async function listWorkspaces(db: Database, organizationId: string) {
  const result = await db.query(
    "select * from workspaces where organization_id = $1 order by created_at desc",
    [organizationId],
  );
  return result.rows.map(mapWorkspace);
}

export async function listWorkspaceOptions(db: Database) {
  const result = await db.query(
    `
      select
        w.*,
        o.name as organization_name
      from workspaces w
      inner join organizations o on o.id = w.organization_id
      order by o.created_at desc, w.created_at desc
    `,
  );

  return result.rows.map(mapWorkspaceOption);
}

export async function listWorkspacesByOrganizationAndMemberEmail(
  db: Database,
  organizationId: string,
  email: string,
) {
  const result = await db.query(
    `
      select w.*
      from workspaces w
      inner join members m on m.workspace_id = w.id
      where w.organization_id = $1
        and lower(m.email) = lower($2)
        and m.status = 'active'
      order by w.created_at desc
    `,
    [organizationId, email],
  );

  return result.rows.map(mapWorkspace);
}

export async function listWorkspaceOptionsByMemberEmail(db: Database, email: string) {
  const result = await db.query(
    `
      select distinct
        w.*,
        o.name as organization_name
      from workspaces w
      inner join organizations o on o.id = w.organization_id
      inner join members m on m.workspace_id = w.id
      where lower(m.email) = lower($1)
        and m.status = 'active'
      order by o.created_at desc, w.created_at desc
    `,
    [email],
  );

  return result.rows.map(mapWorkspaceOption);
}

export async function findWorkspaceById(db: Database, workspaceId: string) {
  const result = await db.query("select * from workspaces where id = $1 limit 1", [workspaceId]);
  if (!result.rowCount) {
    return null;
  }

  return mapWorkspace(result.rows[0]);
}

export async function createWorkspace(db: Database, input: CreateWorkspaceInput) {
  const slug = resolveSlugInput(input.slug, input.name);
  const result = await db.query(
    `
      insert into workspaces (organization_id, name, slug)
      values ($1, $2, $3)
      returning *
    `,
    [input.organizationId, input.name, slug],
  );
  return mapWorkspace(result.rows[0]);
}

export async function updateWorkspace(db: Database, workspaceId: string, input: UpdateWorkspaceInput) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }
  if (input.slug !== undefined) {
    values.push(normalizeSlugInput(input.slug, "slug"));
    assignments.push(`slug = $${values.length}`);
  }

  if (!assignments.length) {
    return null;
  }

  values.push(workspaceId);

  const result = await db.query(
    `
      update workspaces
      set ${assignments.join(", ")}, updated_at = now()
      where id = $${values.length}
      returning *
    `,
    values,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapWorkspace(result.rows[0]);
}

export async function deleteWorkspace(db: Database, workspaceId: string) {
  const result = await db.query(
    `
      delete from workspaces
      where id = $1
      returning *
    `,
    [workspaceId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapWorkspace(result.rows[0]);
}

export async function findProjectById(db: Database, projectId: string) {
  const result = await db.query("select * from projects where id = $1 limit 1", [projectId]);
  if (!result.rowCount) {
    return null;
  }

  return mapProject(result.rows[0]);
}

export async function listProjects(db: Database, workspaceId: string) {
  const result = await db.query(
    "select * from projects where workspace_id = $1 order by created_at desc",
    [workspaceId],
  );
  return result.rows.map(mapProject);
}

export async function createProject(db: Database, input: CreateProjectInput) {
  const slug = resolveSlugInput(input.slug, input.name);
  const result = await db.query(
    `
      insert into projects (workspace_id, name, slug, status)
      values ($1, $2, $3, 'active')
      returning *
    `,
    [input.workspaceId, input.name, slug],
  );
  return mapProject(result.rows[0]);
}

export async function updateProject(db: Database, projectId: string, input: UpdateProjectInput) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }
  if (input.slug !== undefined) {
    values.push(normalizeSlugInput(input.slug, "slug"));
    assignments.push(`slug = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }

  if (!assignments.length) {
    return null;
  }

  values.push(projectId);

  const result = await db.query(
    `
      update projects
      set ${assignments.join(", ")}, updated_at = now()
      where id = $${values.length}
      returning *
    `,
    values,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapProject(result.rows[0]);
}

export async function findEnvironmentById(db: Database, environmentId: string) {
  const result = await db.query("select * from environments where id = $1 limit 1", [environmentId]);
  if (!result.rowCount) {
    return null;
  }

  return mapEnvironment(result.rows[0]);
}

export async function listEnvironmentsByWorkspace(db: Database, workspaceId: string) {
  const result = await db.query(
    "select * from environments where workspace_id = $1 order by created_at desc",
    [workspaceId],
  );
  return result.rows.map(mapEnvironment);
}

export async function listEnvironments(db: Database, projectId: string) {
  const result = await db.query(
    "select * from environments where project_id = $1 order by created_at desc",
    [projectId],
  );
  return result.rows.map(mapEnvironment);
}

export async function createEnvironment(db: Database, input: CreateEnvironmentInput) {
  const slug = resolveSlugInput(input.slug, input.name);
  const result = await db.query(
    `
      insert into environments (workspace_id, project_id, name, slug, runtime, status)
      values ($1, $2, $3, $4, $5, 'active')
      returning *
    `,
    [input.workspaceId, input.projectId, input.name, slug, input.runtime],
  );
  return mapEnvironment(result.rows[0]);
}

export async function updateEnvironment(db: Database, environmentId: string, input: UpdateEnvironmentInput) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.projectId !== undefined) {
    values.push(input.projectId);
    assignments.push(`project_id = $${values.length}`);
  }
  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }
  if (input.slug !== undefined) {
    values.push(normalizeSlugInput(input.slug, "slug"));
    assignments.push(`slug = $${values.length}`);
  }
  if (input.runtime !== undefined) {
    values.push(input.runtime);
    assignments.push(`runtime = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }

  if (!assignments.length) {
    return null;
  }

  values.push(environmentId);

  const result = await db.query(
    `
      update environments
      set ${assignments.join(", ")}, updated_at = now()
      where id = $${values.length}
      returning *
    `,
    values,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapEnvironment(result.rows[0]);
}

export async function findMemberById(db: Database, memberId: string) {
  const result = await db.query("select * from members where id = $1 limit 1", [memberId]);
  if (!result.rowCount) {
    return null;
  }

  return mapMember(result.rows[0]);
}

export async function findMemberByWorkspaceAndEmail(db: Database, workspaceId: string, email: string) {
  const result = await db.query(
    `
      select *
      from members
      where workspace_id = $1
        and lower(email) = lower($2)
      limit 1
    `,
    [workspaceId, email],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapMember(result.rows[0]);
}

export async function listMembers(db: Database, workspaceId: string) {
  const result = await db.query(
    "select * from members where workspace_id = $1 order by created_at desc",
    [workspaceId],
  );
  return result.rows.map(mapMember);
}

export async function createMember(db: Database, input: CreateMemberInput) {
  const roles = input.roles.length ? input.roles : [input.role];
  const primaryRole = roles[0] ?? input.role;
  const result = await db.query(
    `
      insert into members (workspace_id, email, name, role, roles, status, temporary_access_expires_at)
      values ($1, $2, $3, $4, $5::text[], 'invited', $6::timestamptz)
      returning *
    `,
    [input.workspaceId, input.email.toLowerCase(), input.name, primaryRole, roles, input.temporaryAccessExpiresAt],
  );
  return mapMember(result.rows[0]);
}

export async function updateMember(db: Database, memberId: string, input: UpdateMemberInput) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }
  if (input.roles !== undefined) {
    values.push(input.roles.length ? input.roles : [unassignedMemberRoleSentinel]);
    assignments.push(`roles = $${values.length}::text[]`);
  }
  if (input.role !== undefined) {
    values.push(input.role);
    assignments.push(`role = $${values.length}`);
  } else if (input.roles !== undefined && input.roles.length) {
    values.push(input.roles[0]);
    assignments.push(`role = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }
  if (input.temporaryAccessExpiresAt !== undefined) {
    values.push(input.temporaryAccessExpiresAt);
    assignments.push(`temporary_access_expires_at = $${values.length}::timestamptz`);
  }

  if (!assignments.length) {
    return null;
  }

  values.push(memberId);

  const result = await db.query(
    `
      update members
      set ${assignments.join(", ")}, updated_at = now()
      where id = $${values.length}
      returning *
    `,
    values,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapMember(result.rows[0]);
}

export async function recordMemberActivity(
  db: Database,
  memberId: string,
  options?: {
    recordedAt?: string;
    markLogin?: boolean;
  },
) {
  const recordedAt = options?.recordedAt ?? new Date().toISOString();
  const result = await db.query(
    `
      update members
      set
        last_active_at = $2::timestamptz,
        last_login_at = case
          when $3::boolean or last_login_at is null then $2::timestamptz
          else last_login_at
        end
      where id = $1
      returning *
    `,
    [memberId, recordedAt, options?.markLogin ?? false],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapMember(result.rows[0]);
}

export async function deleteMember(db: Database, memberId: string) {
  const result = await db.query(
    `
      delete from members
      where id = $1
      returning *
    `,
    [memberId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapMember(result.rows[0]);
}

export async function listMemberProjectAssignments(db: Database, workspaceId: string) {
  const result = await db.query(
    `
      select mpa.*
      from member_project_assignments mpa
      inner join members m on m.id = mpa.member_id
      where m.workspace_id = $1
      order by mpa.created_at desc
    `,
    [workspaceId],
  );

  return result.rows.map(mapMemberProjectAssignment);
}

export async function listAssignedProjectIdsForMember(db: Database, memberId: string) {
  const result = await db.query<{ project_id: string }>(
    `
      select project_id
      from member_project_assignments
      where member_id = $1
      order by created_at desc
    `,
    [memberId],
  );

  return result.rows.map((row) => String(row.project_id));
}

export async function replaceMemberProjectAssignments(
  db: Database,
  memberId: string,
  input: ReplaceMemberProjectAssignmentsInput,
) {
  const projectIds = [...new Set(input.projectIds)];

  await withTransaction(db, async (transaction) => {
    await transaction.query("delete from member_project_assignments where member_id = $1", [memberId]);

    for (const projectId of projectIds) {
      await transaction.query(
        `
          insert into member_project_assignments (member_id, project_id)
          values ($1, $2)
        `,
        [memberId, projectId],
      );
    }
  });

  return listAssignedProjectIdsForMember(db, memberId);
}

// Placeholder lineage/fingerprint exports preserved for callers while the full
// traceability data layer is restored.
export async function appendEvidenceChainRecord(..._args: unknown[]) {
  return null;
}

export async function getEvidenceBundleById(
  _db: Database,
  _evidenceBundleId: string,
): Promise<EvidenceBundle | null> {
  return null;
}

export async function getLineageBuildDescriptor(
  _db: Database,
  _fingerprintId: string,
): Promise<LineageBuildDescriptor | null> {
  return null;
}

export async function getFingerprintById(_db: Database, _fingerprintId: string): Promise<FingerprintIssuance | null> {
  return null;
}

export async function issueFingerprint(
  _db: Database,
  organizationId: string | null,
  input: IssueFingerprintInput,
  _options: {
    issuedByType: string;
    issuedById: string;
    encryptionKeyBase64?: string | null;
  },
): Promise<FingerprintIssuance> {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    organizationId,
    customerId: "customerId" in input && typeof input.customerId === "string" ? input.customerId : "default-customer",
    deploymentId: input.deploymentId ?? "default-deployment",
    releaseId: input.releaseId ?? "default-release",
    manifestHash:
      "manifestHash" in input && typeof input.manifestHash === "string"
        ? input.manifestHash
        : "default-manifest-hash",
    fingerprintId: "fp_placeholder",
    fingerprintToken: "fp_token_placeholder",
    status: "active",
    issuedByType: "system",
    issuedById: "database-placeholder",
    issuedAt: now,
    hmacKeyId: "hmac-placeholder",
    signingKeyId: "signing-placeholder",
    evidenceBundleId: "evidence-placeholder",
    evidenceRootHash: "evidence-root-placeholder",
    revokedAt: null,
    revokedByType: null,
    revokedById: null,
    revokeReason: null,
    deployment: null,
    release: null,
    artifacts: [],
    metadata: input.metadata ?? {},
  };
}

export async function listEvidenceBundlesForFingerprint(
  _db: Database,
  _fingerprintId: string,
): Promise<EvidenceBundle[]> {
  return [];
}

export async function listFingerprintKeyVersions(
  _db: Database,
  _query?: FingerprintKeyVersionListQuery,
): Promise<FingerprintKeyVersion[]> {
  return [];
}

export async function lookupFingerprintIssuances(
  _db: Database,
  _query: FingerprintLookupQuery,
): Promise<{ items: FingerprintIssuance[]; total: number }> {
  return {
    items: [],
    total: 0,
  };
}

export async function revokeFingerprint(
  _db: Database,
  _fingerprintId: string,
  _input: {
    revokedByType: string;
    revokedById: string;
    reason: string;
  },
): Promise<FingerprintIssuance | null> {
  return null;
}

export async function rotateFingerprintKeyVersion(
  _db: Database,
  input: RotateFingerprintKeyVersionInput & {
    createdByType?: string;
    createdById?: string;
    encryptionKeyBase64?: string | null;
  },
): Promise<FingerprintKeyVersion> {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000002",
    keyId: "fingerprint-key-placeholder",
    purpose: input.purpose,
    algorithm: "HMAC-SHA256",
    status: "active",
    wrappingKeyRef: "placeholder",
    publicKeyMaterial: null,
    createdByType: input.createdByType ?? "system",
    createdById: input.createdById ?? "database-placeholder",
    createdAt: now,
    activatedAt: now,
    retiredAt: null,
    destroyAfter: null,
    metadata: {},
  };
}

export async function verifyLineageArtifacts(
  _db: Database,
  fingerprintId: string,
  extractor: VerifyLineageArtifactsInput["extractor"],
): Promise<VerifyLineageArtifactsResponse | null> {
  return {
    lineageId: fingerprintId,
    matchStatus: extractor.matchStatus,
    artifacts: [],
    recoveredLocator: extractor.recoveredLocator,
    locatorCandidates: extractor.locatorCandidates,
    codewordDigest: extractor.codewordDigest,
    digestCandidates: extractor.digestCandidates,
    familyHitSummary: extractor.familyHitSummary,
    verifiedAt: new Date().toISOString(),
  };
}

export async function listProviderConnections(db: Database, workspaceId: string) {
  const result = await db.query(
    `
      select pc.*
      from provider_connections pc
      left join workspaces provider_workspace on provider_workspace.id = pc.workspace_id
      inner join workspaces w on w.id = $1
      where pc.organization_id = w.organization_id
         or (
           pc.organization_id is null
           and provider_workspace.organization_id = w.organization_id
         )
      order by pc.created_at desc
    `,
    [workspaceId],
  );
  return result.rows.map(mapProviderConnection);
}

export async function findProviderConnectionById(db: Database, providerConnectionId: string) {
  const result = await db.query(
    `
      select *
      from provider_connections
      where id = $1
      limit 1
    `,
    [providerConnectionId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapProviderConnection(result.rows[0]);
}

function getProviderRoutingProtocolForProvider(provider: ProviderConnection["provider"]) {
  return provider === "anthropic" ? "anthropic" : "openai-compatible";
}

export async function listCatalogModelsForOrganization(db: Database, organizationId: string) {
  const result = await db.query(
    `
      select *
      from catalog_models
      where organization_id = $1
      order by protocol asc, label asc, created_at asc
    `,
    [organizationId],
  );

  return result.rows.map(mapCatalogModel);
}

export async function listCatalogModelsForWorkspace(
  db: Database,
  workspaceId: string,
): Promise<Array<CatalogModel & { assigned: boolean }>> {
  const result = await db.query(
    `
      select
        cm.*,
        case when cm.status = 'active' then true else false end as assigned
      from workspaces w
      inner join catalog_models cm on cm.organization_id = w.organization_id
      where w.id = $1
      order by cm.protocol asc, cm.label asc, cm.created_at asc
    `,
    [workspaceId],
  );

  return result.rows.map((row) => ({
    ...mapCatalogModel(row),
    assigned: Boolean(row.assigned),
  }));
}

export async function listAssignedCatalogModelsForWorkspace(
  db: Database,
  workspaceId: string,
  protocol?: CatalogModel["protocol"],
) {
  const values: unknown[] = [workspaceId];
  let protocolClause = "";
  if (protocol) {
    values.push(protocol);
    protocolClause = ` and cm.protocol = $${values.length}`;
  }

  const result = await db.query(
    `
      select cm.*
      from workspaces w
      inner join catalog_models cm on cm.organization_id = w.organization_id
      where w.id = $1
        and cm.status = 'active'
        ${protocolClause}
      order by cm.label asc, cm.created_at asc
    `,
    values,
  );

  return result.rows.map(mapCatalogModel);
}

export async function upsertCatalogModel(
  db: Database | Queryable,
  organizationId: string,
  input: UpsertCatalogModelInput & {
    protocol: CatalogModel["protocol"];
    sourceProviderConnectionLabel: string;
    sourceProvider: CatalogModel["sourceProvider"];
  },
) {
  const modelId = input.modelId.trim().toLowerCase();
  const label = input.label.trim();
  const result = await db.query(
    `
      insert into catalog_models (
        organization_id,
        model_id,
        label,
        protocol,
        source_provider_connection_id,
        source_provider_connection_label,
        source_provider,
        status
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (organization_id, protocol, model_id, source_provider_connection_id) do update
      set
        label = excluded.label,
        source_provider_connection_label = excluded.source_provider_connection_label,
        source_provider = excluded.source_provider,
        status = excluded.status,
        updated_at = now()
      returning *
    `,
    [
      organizationId,
      modelId,
      label,
      input.protocol,
      input.sourceProviderConnectionId,
      input.sourceProviderConnectionLabel,
      input.sourceProvider,
      input.status,
    ],
  );

  return mapCatalogModel(result.rows[0]);
}

export async function syncWorkspaceModelAssignments(
  db: Database,
  workspaceId: string,
  input: SyncWorkspaceModelAssignmentsInput,
) {
  return withTransaction(db, async (transaction) => {
    const normalizedIds = [...new Set(input.modelIds)];

    await transaction.query(
      `
        delete from workspace_model_assignments
        where workspace_id = $1
          and (
            array_length($2::uuid[], 1) is null
            or catalog_model_id <> all($2::uuid[])
          )
      `,
      [workspaceId, normalizedIds],
    );

    if (normalizedIds.length > 0) {
      await transaction.query(
        `
          insert into workspace_model_assignments (workspace_id, catalog_model_id)
          select $1, entry.catalog_model_id
          from unnest($2::uuid[]) as entry(catalog_model_id)
          on conflict do nothing
        `,
        [workspaceId, normalizedIds],
      );
    }
  });
}

export async function syncCatalogModelsFromProviderConnection(
  db: Database,
  connection: ProviderConnection,
) {
  const configuredModels = getProviderConfiguredModelCatalogItems(
    connection.metadata,
    connection.pricingConfig,
  );
  const protocol = getProviderRoutingProtocolForProvider(connection.provider);
  const organizationId =
    connection.organizationId ??
    (
      await db.query(
        `
          select organization_id
          from workspaces
          where id = $1
          limit 1
        `,
        [connection.workspaceId],
      )
    ).rows[0]?.organization_id;

  if (!organizationId) {
    throw new DatabaseValidationError("Provider connection organization could not be resolved");
  }

  return withTransaction(db, async (transaction) => {
    await transaction.query(
      `
        delete from provider_connection_catalog_models
        where provider_connection_id = $1
      `,
      [connection.id],
    );

    for (const item of configuredModels) {
      const catalogModel = await upsertCatalogModel(transaction, String(organizationId), {
        modelId: item.id,
        label: item.label,
        protocol,
        sourceProviderConnectionId: connection.id,
        sourceProviderConnectionLabel: connection.label,
        sourceProvider: connection.provider,
        status: "active",
      });

      await transaction.query(
        `
          insert into provider_connection_catalog_models (
            provider_connection_id,
            catalog_model_id
          )
          values ($1, $2)
          on conflict do nothing
        `,
        [connection.id, catalogModel.id],
      );

      await transaction.query(
        `
          insert into workspace_model_assignments (
            workspace_id,
            catalog_model_id
          )
          values ($1, $2)
          on conflict do nothing
        `,
        [connection.workspaceId, catalogModel.id],
      );
    }
  });
}

export async function createProviderConnection(
  db: Database,
  input: CreateProviderConnectionInput,
  encryptionKeyBase64: string,
) {
  const label = input.label.trim();
  const apiKey = input.apiKey.trim();
  const metadata = normalizeProviderConnectionMetadata(input.metadata);

  if (label.length < 2) {
    throw new DatabaseValidationError("Provider connection label must be at least 2 characters");
  }

  if (apiKey.length < 8) {
    throw new DatabaseValidationError("Provider API key must be at least 8 characters");
  }

  if (input.provider === "openai-compatible" && !metadata.baseUrl) {
    throw new DatabaseValidationError("OpenAI-compatible provider connections require metadata.baseUrl");
  }

  const pricingConfig =
    input.pricingConfig === null || input.pricingConfig === undefined
      ? null
      : ProviderPricingConfigSchema.parse(input.pricingConfig);

  const encryptedApiKey = encryptSecret(apiKey, encryptionKeyBase64);
  const credentialKeyFingerprint = deriveCredentialKeyFingerprint(encryptionKeyBase64);
  const result = await db.query(
    `
      insert into provider_connections (
        organization_id,
        workspace_id,
        provider,
        label,
        encrypted_api_key,
        credential_key_fingerprint,
        metadata,
        pricing_config
      )
      select
        w.organization_id,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7::jsonb
      from workspaces w
      where w.id = $1
      returning *
    `,
    [
      input.workspaceId,
      input.provider,
      label,
      encryptedApiKey,
      credentialKeyFingerprint,
      JSON.stringify(metadata),
      pricingConfig ? JSON.stringify(pricingConfig) : null,
    ],
  );
  return mapProviderConnection(result.rows[0]);
}

export async function updateProviderConnection(
  db: Database,
  providerConnectionId: string,
  input: UpdateProviderConnectionInput,
  encryptionKeyBase64: string,
) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (label.length < 2) {
      throw new DatabaseValidationError("Provider connection label must be at least 2 characters");
    }

    values.push(label);
    assignments.push(`label = $${values.length}`);
  }

  if (input.apiKey !== undefined) {
    const apiKey = input.apiKey.trim();
    if (apiKey.length < 8) {
      throw new DatabaseValidationError("Provider API key must be at least 8 characters");
    }

    values.push(encryptSecret(apiKey, encryptionKeyBase64));
    assignments.push(`encrypted_api_key = $${values.length}`);
    values.push(deriveCredentialKeyFingerprint(encryptionKeyBase64));
    assignments.push(`credential_key_fingerprint = $${values.length}`);
  }

  if (input.metadata !== undefined) {
    const metadata = normalizeProviderConnectionMetadata(input.metadata);
    values.push(JSON.stringify(metadata));
    assignments.push(`metadata = $${values.length}::jsonb`);
  }

  if (input.pricingConfig !== undefined) {
    const pricingConfig =
      input.pricingConfig === null
        ? null
        : ProviderPricingConfigSchema.parse(input.pricingConfig);
    values.push(pricingConfig ? JSON.stringify(pricingConfig) : null);
    assignments.push(`pricing_config = $${values.length}::jsonb`);
  }

  if (!assignments.length) {
    return null;
  }

  values.push(providerConnectionId);

  const result = await db.query(
    `
      update provider_connections
      set ${assignments.join(", ")}, updated_at = now()
      where id = $${values.length}
      returning *
    `,
    values,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapProviderConnection(result.rows[0]);
}

export async function revokeProviderConnection(db: Database, providerConnectionId: string) {
  const result = await db.query(
    `
      update provider_connections
      set status = 'revoked',
          revoked_at = coalesce(revoked_at, now()),
          updated_at = now()
      where id = $1
      returning *
    `,
    [providerConnectionId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapProviderConnection(result.rows[0]);
}

export async function recordProviderConnectionTestResult(
  db: Database,
  providerConnectionId: string,
  input: {
    testedAt: string;
    status: "passed" | "failed";
    error: string | null;
    statusCode: number | null;
    latencyMs: number | null;
  },
) {
  const result = await db.query(
    `
      update provider_connections
      set last_tested_at = $2::timestamptz,
          last_test_status = $3,
          last_test_error = $4,
          last_test_status_code = $5,
          last_test_latency_ms = $6,
          updated_at = now()
      where id = $1
      returning *
    `,
    [providerConnectionId, input.testedAt, input.status, input.error, input.statusCode, input.latencyMs],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapProviderConnection(result.rows[0]);
}

export async function findDefaultProviderConnectionByWorkspace(db: Database, workspaceId: string) {
  const result = await db.query(
    `
      select pc.*
      from provider_connections pc
      left join workspaces provider_workspace on provider_workspace.id = pc.workspace_id
      inner join workspaces w on w.id = $1
      where (
          pc.organization_id = w.organization_id
          or (
            pc.organization_id is null
            and provider_workspace.organization_id = w.organization_id
          )
        )
        and pc.status = 'active'
      order by pc.created_at asc
      limit 1
    `,
    [workspaceId],
  );

  if (!result.rowCount) {
    return null;
  }

  return result.rows[0];
}

export async function resolveProviderCredentialsForWorkspace(
  db: Database,
  workspaceId: string,
  encryptionKeyBase64: string,
) {
  const row = await findDefaultProviderConnectionByWorkspace(db, workspaceId);
  if (!row) {
    return null;
  }

  const candidate = mapProviderConnectionCandidate(row);
  return {
    connection: candidate.connection,
    apiKey: decryptSecret(candidate.encryptedApiKey, encryptionKeyBase64),
    metadata: candidate.metadata,
  };
}

function mapProviderConnectionCandidate(row: DbRow): ProviderConnectionCandidate {
  return {
    connection: mapProviderConnection(row),
    metadata: getStoredProviderConnectionMetadata(row),
    encryptedApiKey: String(row.encrypted_api_key),
    credentialKeyFingerprint:
      row.credential_key_fingerprint === null || row.credential_key_fingerprint === undefined
        ? null
        : String(row.credential_key_fingerprint),
  };
}

export async function listProviderConnectionCandidatesForWorkspace(db: Database, workspaceId: string) {
  const result = await db.query(
    `
      select pc.*
      from provider_connections pc
      left join workspaces provider_workspace on provider_workspace.id = pc.workspace_id
      inner join workspaces w on w.id = $1
      where (
          pc.organization_id = w.organization_id
          or (
            pc.organization_id is null
            and provider_workspace.organization_id = w.organization_id
          )
        )
        and pc.status = 'active'
      order by pc.created_at asc
    `,
    [workspaceId],
  );

  return result.rows.map(mapProviderConnectionCandidate);
}

export async function findProviderConnectionCandidateById(db: Database, providerConnectionId: string) {
  const result = await db.query(
    `
      select *
      from provider_connections
      where id = $1 and status = 'active'
      limit 1
    `,
    [providerConnectionId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapProviderConnectionCandidate(result.rows[0]);
}

export function decryptProviderConnectionCandidate(
  candidate: ProviderConnectionCandidate,
  encryptionKeyBase64: string,
) {
  const currentFingerprint = deriveCredentialKeyFingerprint(encryptionKeyBase64);
  if (
    candidate.credentialKeyFingerprint &&
    candidate.credentialKeyFingerprint !== currentFingerprint
  ) {
    throw new ProviderConnectionCredentialKeyMismatchError({
      providerConnectionId: candidate.connection.id,
      storedFingerprint: candidate.credentialKeyFingerprint,
      currentFingerprint,
    });
  }

  try {
    return {
      connection: candidate.connection,
      apiKey: decryptSecret(candidate.encryptedApiKey, encryptionKeyBase64),
      metadata: candidate.metadata,
    };
  } catch (error) {
    throw new ProviderConnectionCredentialDecryptionError(candidate.connection.id, error);
  }
}

export async function resolveProviderCredentialsByConnectionId(
  db: Database,
  providerConnectionId: string,
  encryptionKeyBase64: string,
) {
  const result = await db.query(
    `
      select *
      from provider_connections
      where id = $1 and status = 'active'
      limit 1
    `,
    [providerConnectionId],
  );

  if (!result.rowCount) {
    return null;
  }

  return decryptProviderConnectionCandidate(mapProviderConnectionCandidate(result.rows[0]), encryptionKeyBase64);
}

export async function listProviderCredentialsForWorkspace(
  db: Database,
  workspaceId: string,
  encryptionKeyBase64: string,
) {
  const candidates = await listProviderConnectionCandidatesForWorkspace(db, workspaceId);

  return candidates.map((candidate) => decryptProviderConnectionCandidate(candidate, encryptionKeyBase64));
}

export function hashVirtualKey(rawKey: string) {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateVirtualKeyMaterial() {
  const token = `teamops_vk_${randomBytes(24).toString("base64url")}`;
  return {
    token,
    keyPrefix: token.slice(0, 18),
    keyHash: hashVirtualKey(token),
  };
}

type SelfServeVirtualKeyLookupArgs = {
  virtualKeyId: string;
  memberId: string;
};

type IssueSelfServeVirtualKeyArgs = {
  workspaceId: string;
  memberId: string;
  memberEmail: string;
  providerConnectionId: string | null;
  projectId: string;
  label: string;
  expiresAt: string;
};

const selfServeGatewayScopes = normalizeVirtualKeyScopes([
  "gateway:models",
  "gateway:messages",
  "gateway:chat-completions",
  "gateway:responses",
]);

type VirtualKeyListFilters = {
  workspaceId: string;
  projectIds?: string[];
  owner?: string;
  issuedByMemberId?: string;
  limit: number;
  offset: number;
};

function buildVirtualKeyFilterQuery(
  filters: Pick<VirtualKeyListFilters, "workspaceId" | "projectIds" | "owner" | "issuedByMemberId">,
) {
  const clauses = ["workspace_id = $1"];
  const values: unknown[] = [filters.workspaceId];

  if (filters.projectIds?.length) {
    values.push(filters.projectIds);
    clauses.push(`project_id = any($${values.length}::uuid[])`);
  }

  if (filters.owner && filters.issuedByMemberId) {
    values.push(filters.owner);
    const ownerIndex = values.length;
    values.push(filters.issuedByMemberId);
    const issuedByMemberIdIndex = values.length;
    clauses.push(`(owner = $${ownerIndex} or issued_by_member_id = $${issuedByMemberIdIndex})`);
  } else if (filters.owner) {
    values.push(filters.owner);
    clauses.push(`owner = $${values.length}`);
  } else if (filters.issuedByMemberId) {
    values.push(filters.issuedByMemberId);
    clauses.push(`issued_by_member_id = $${values.length}`);
  }

  return {
    clauses,
    values,
  };
}

function createEmptyVirtualKeyInventorySummary(): VirtualKeyInventorySummary {
  return {
    total: 0,
    active: 0,
    revoked: 0,
    expired: 0,
    neverUsed: 0,
    environmentBound: 0,
  };
}

export async function listVirtualKeys(db: Database, filters: VirtualKeyListFilters) {
  const { clauses, values } = buildVirtualKeyFilterQuery(filters);

  const summaryResult = await db.query<{
    total: string | number | null;
    active_count: string | number | null;
    revoked_count: string | number | null;
    expired_count: string | number | null;
    never_used_count: string | number | null;
    environment_bound_count: string | number | null;
  }>(
    `
      select
        count(*)::text as total,
        count(*) filter (
          where status = 'active' and (expires_at is null or expires_at > now())
        )::text as active_count,
        count(*) filter (where status = 'revoked')::text as revoked_count,
        count(*) filter (where expires_at is not null and expires_at <= now())::text as expired_count,
        count(*) filter (where last_used_at is null)::text as never_used_count,
        count(*) filter (where environment_id is not null)::text as environment_bound_count
      from virtual_keys
      where ${clauses.join(" and ")}
    `,
    values,
  );

  const summaryRow = summaryResult.rows[0];
  const summary: VirtualKeyInventorySummary = summaryRow
    ? {
        total: Number(summaryRow.total ?? 0),
        active: Number(summaryRow.active_count ?? 0),
        revoked: Number(summaryRow.revoked_count ?? 0),
        expired: Number(summaryRow.expired_count ?? 0),
        neverUsed: Number(summaryRow.never_used_count ?? 0),
        environmentBound: Number(summaryRow.environment_bound_count ?? 0),
      }
    : createEmptyVirtualKeyInventorySummary();

  const queryValues = [...values, filters.limit, filters.offset];
  const result = await db.query(
    `
      select *
      from virtual_keys
      where ${clauses.join(" and ")}
      order by
        case
          when status = 'active' and (expires_at is null or expires_at > now()) then 0
          when status = 'active' then 1
          else 2
        end asc,
        coalesce(last_used_at, created_at) desc,
        label asc
      limit $${queryValues.length - 1}
      offset $${queryValues.length}
    `,
    queryValues,
  );

  return {
    items: result.rows.map(mapVirtualKey),
    total: summary.total,
    summary,
  };
}

export async function findVirtualKeyById(db: Database, virtualKeyId: string) {
  const result = await db.query(
    `
      select *
      from virtual_keys
      where id = $1
      limit 1
    `,
    [virtualKeyId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapVirtualKey(result.rows[0]);
}

export async function createVirtualKey(db: Database, input: CreateVirtualKeyInput) {
  const material = generateVirtualKeyMaterial();
  const normalizedScopes = normalizeVirtualKeyScopes(input.scopes);
  const result = await db.query(
    `
      insert into virtual_keys (
        workspace_id,
        provider_connection_id,
        project_id,
        environment_id,
        label,
        owner,
        team,
        service,
        environment,
        key_prefix,
        key_hash,
        scopes,
        expires_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::timestamptz)
      returning *
    `,
    [
      input.workspaceId,
      input.providerConnectionId,
      input.projectId,
      input.environmentId,
      input.label,
      input.owner,
      input.team,
      input.service,
      input.environment,
      material.keyPrefix,
      material.keyHash,
      JSON.stringify(normalizedScopes),
      input.expiresAt,
    ],
  );

  return {
    record: mapVirtualKey(result.rows[0]),
    token: material.token,
  };
}

export async function listActiveSelfServeVirtualKeysForMember(
  db: Database,
  args: {
    workspaceId: string;
    memberId: string;
  },
) {
  const result = await db.query(
    `
      select *
      from virtual_keys
      where workspace_id = $1
        and issued_by_member_id = $2
        and issuance_mode = 'self_serve'
        and status = 'active'
        and (expires_at is null or expires_at > now())
      order by created_at desc
    `,
    [args.workspaceId, args.memberId],
  );

  return result.rows.map(mapVirtualKey);
}

export async function issueSelfServeVirtualKey(db: Database, input: IssueSelfServeVirtualKeyArgs) {
  const material = generateVirtualKeyMaterial();
  const result = await db.query(
    `
      insert into virtual_keys (
        workspace_id,
        provider_connection_id,
        project_id,
        environment_id,
        label,
        owner,
        team,
        service,
        environment,
        key_prefix,
        key_hash,
        scopes,
        expires_at,
        issuance_mode,
        issued_by_member_id
      )
      values ($1, $2, $3, null, $4, $5, null, 'self-serve', 'development', $6, $7, $8::jsonb, $9::timestamptz, 'self_serve', $10)
      returning *
    `,
    [
      input.workspaceId,
      input.providerConnectionId,
      input.projectId,
      input.label,
      input.memberEmail,
      material.keyPrefix,
      material.keyHash,
      JSON.stringify(selfServeGatewayScopes),
      input.expiresAt,
      input.memberId,
    ],
  );

  return {
    record: mapVirtualKey(result.rows[0]),
    token: material.token,
  };
}

export async function resolveVirtualKey(db: Database, rawKey: string) {
  const result = await db.query(
    `
      select *
      from virtual_keys
      where key_hash = $1
      limit 1
    `,
    [hashVirtualKey(rawKey)],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapVirtualKey(result.rows[0]);
}

export async function touchVirtualKeyUsage(db: Database, virtualKeyId: string) {
  await db.query("update virtual_keys set last_used_at = now() where id = $1", [virtualKeyId]);
}

export async function revokeVirtualKey(db: Database, virtualKeyId: string) {
  const result = await db.query(
    `
      update virtual_keys
      set status = 'revoked'
      where id = $1
      returning *
    `,
    [virtualKeyId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapVirtualKey(result.rows[0]);
}

export async function revokeSelfServeVirtualKey(db: Database, args: SelfServeVirtualKeyLookupArgs) {
  const result = await db.query(
    `
      update virtual_keys
      set status = 'revoked'
      where id = $1
        and issued_by_member_id = $2
        and issuance_mode = 'self_serve'
        and status = 'active'
      returning *
    `,
    [args.virtualKeyId, args.memberId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapVirtualKey(result.rows[0]);
}

export async function rotateVirtualKey(db: Database, virtualKeyId: string) {
  return withTransaction(db, async (transaction) => {
    const existingResult = await transaction.query(
      `
        select *
        from virtual_keys
        where id = $1
        limit 1
        for update
      `,
      [virtualKeyId],
    );

    if (!existingResult.rowCount) {
      return null;
    }

    const existingRow = existingResult.rows[0];
    if (String(existingRow.status) !== "active") {
      return null;
    }

    const material = generateVirtualKeyMaterial();
    const normalizedScopes = normalizeVirtualKeyScopes(
      Array.isArray(existingRow.scopes) ? (existingRow.scopes as string[]) : [],
    );
    const insertedResult = await transaction.query(
      `
        insert into virtual_keys (
          workspace_id,
          provider_connection_id,
          project_id,
          environment_id,
          label,
          owner,
          team,
          service,
          environment,
          key_prefix,
          key_hash,
          scopes,
          expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::timestamptz)
      returning *
    `,
      [
        existingRow.workspace_id,
        existingRow.provider_connection_id,
        existingRow.project_id,
        existingRow.environment_id,
        existingRow.label,
        existingRow.owner ?? null,
        existingRow.team ?? null,
        existingRow.service ?? null,
        existingRow.environment,
        material.keyPrefix,
        material.keyHash,
        JSON.stringify(normalizedScopes),
        existingRow.expires_at ?? null,
      ],
    );

    await transaction.query(
      `
        update virtual_keys
        set status = 'revoked'
        where id = $1 and status = 'active'
      `,
      [virtualKeyId],
    );

    return {
      record: mapVirtualKey(insertedResult.rows[0]),
      token: material.token,
    };
  });
}

export async function rotateSelfServeVirtualKey(
  db: Database,
  args: SelfServeVirtualKeyLookupArgs & { expiresAt: string },
) {
  return withTransaction(db, async (transaction) => {
    const existingResult = await transaction.query(
      `
        select *
        from virtual_keys
        where id = $1
          and issued_by_member_id = $2
          and issuance_mode = 'self_serve'
        limit 1
        for update
      `,
      [args.virtualKeyId, args.memberId],
    );

    if (!existingResult.rowCount) {
      return null;
    }

    const existingRow = existingResult.rows[0];
    if (String(existingRow.status) !== "active") {
      return null;
    }

    const material = generateVirtualKeyMaterial();
    const insertedResult = await transaction.query(
      `
        insert into virtual_keys (
          workspace_id,
          provider_connection_id,
          project_id,
          environment_id,
          label,
          owner,
          team,
          service,
          environment,
          key_prefix,
          key_hash,
          scopes,
          expires_at,
          issuance_mode,
          issued_by_member_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::timestamptz, 'self_serve', $14)
        returning *
      `,
      [
        existingRow.workspace_id,
        existingRow.provider_connection_id,
        existingRow.project_id,
        existingRow.environment_id,
        existingRow.label,
        existingRow.owner ?? null,
        existingRow.team ?? null,
        existingRow.service ?? null,
        existingRow.environment,
        material.keyPrefix,
        material.keyHash,
        JSON.stringify(selfServeGatewayScopes),
        args.expiresAt,
        existingRow.issued_by_member_id,
      ],
    );

    await transaction.query(
      `
        update virtual_keys
        set status = 'revoked'
        where id = $1 and status = 'active'
      `,
      [args.virtualKeyId],
    );

    return {
      record: mapVirtualKey(insertedResult.rows[0]),
      token: material.token,
    };
  });
}

export async function listBudgetPolicies(db: Database, workspaceId: string) {
  const result = await db.query(
    "select * from budget_policies where workspace_id = $1 order by created_at desc",
    [workspaceId],
  );
  return result.rows.map(mapBudgetPolicy);
}

export async function findBudgetPolicyById(db: Database, budgetPolicyId: string) {
  const result = await db.query(
    `
      select *
      from budget_policies
      where id = $1
      limit 1
    `,
    [budgetPolicyId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapBudgetPolicy(result.rows[0]);
}

export async function findActiveBudgetPolicyConflict(
  db: Database,
  scope: {
    workspaceId: string;
    projectId: string | null;
    environmentId: string | null;
    environment: BudgetPolicy["environment"];
  },
  excludeBudgetPolicyId?: string | null,
) {
  const result = await db.query(
    `
      select *
      from budget_policies
      where workspace_id = $1
        and status = 'active'
        and project_id is not distinct from $2::uuid
        and environment_id is not distinct from $3::uuid
        and environment is not distinct from $4::text
        and ($5::uuid is null or id <> $5::uuid)
      limit 1
    `,
    [
      scope.workspaceId,
      scope.projectId,
      scope.environmentId,
      scope.environment,
      excludeBudgetPolicyId ?? null,
    ],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapBudgetPolicy(result.rows[0]);
}

export async function createBudgetPolicy(db: Database, input: CreateBudgetPolicyInput) {
  const result = await db.query(
    `
      insert into budget_policies (workspace_id, project_id, environment_id, environment, monthly_usd_limit, soft_limit_percent)
      values ($1, $2, $3, $4, $5, $6)
      returning *
    `,
    [
      input.workspaceId,
      input.projectId,
      input.environmentId,
      input.environment,
      input.monthlyUsdLimit,
      input.softLimitPercent,
    ],
  );
  return mapBudgetPolicy(result.rows[0]);
}

type UpdateBudgetPolicyRecordInput = UpdateBudgetPolicyInput & {
  exceptionRequestedBy?: string | null;
  exceptionRequestedAt?: string | null;
  exceptionReviewedBy?: string | null;
  exceptionReviewedAt?: string | null;
};

export async function updateBudgetPolicy(
  db: Database,
  budgetPolicyId: string,
  input: UpdateBudgetPolicyRecordInput,
) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.projectId !== undefined) {
    values.push(input.projectId);
    assignments.push(`project_id = $${values.length}`);
  }
  if (input.environmentId !== undefined) {
    values.push(input.environmentId);
    assignments.push(`environment_id = $${values.length}`);
  }
  if (input.environment !== undefined) {
    values.push(input.environment);
    assignments.push(`environment = $${values.length}`);
  }
  if (input.monthlyUsdLimit !== undefined) {
    values.push(input.monthlyUsdLimit);
    assignments.push(`monthly_usd_limit = $${values.length}`);
  }
  if (input.softLimitPercent !== undefined) {
    values.push(input.softLimitPercent);
    assignments.push(`soft_limit_percent = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }
  if (input.exceptionStatus !== undefined) {
    values.push(input.exceptionStatus);
    assignments.push(`exception_status = $${values.length}`);
  }
  if (input.exceptionReason !== undefined) {
    values.push(input.exceptionReason);
    assignments.push(`exception_reason = $${values.length}`);
  }
  if (input.exceptionRequestedBy !== undefined) {
    values.push(input.exceptionRequestedBy);
    assignments.push(`exception_requested_by = $${values.length}`);
  }
  if (input.exceptionRequestedAt !== undefined) {
    values.push(input.exceptionRequestedAt);
    assignments.push(`exception_requested_at = $${values.length}`);
  }
  if (input.exceptionReviewedBy !== undefined) {
    values.push(input.exceptionReviewedBy);
    assignments.push(`exception_reviewed_by = $${values.length}`);
  }
  if (input.exceptionReviewedAt !== undefined) {
    values.push(input.exceptionReviewedAt);
    assignments.push(`exception_reviewed_at = $${values.length}`);
  }
  if (input.exceptionReviewNote !== undefined) {
    values.push(input.exceptionReviewNote);
    assignments.push(`exception_review_note = $${values.length}`);
  }
  if (input.exceptionExpiresAt !== undefined) {
    values.push(input.exceptionExpiresAt);
    assignments.push(`exception_expires_at = $${values.length}`);
  }

  if (!assignments.length) {
    return null;
  }

  values.push(budgetPolicyId);

  const result = await db.query(
    `
      update budget_policies
      set ${assignments.join(", ")}, updated_at = now()
      where id = $${values.length}
      returning *
    `,
    values,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapBudgetPolicy(result.rows[0]);
}

export async function deleteBudgetPolicy(db: Database, budgetPolicyId: string) {
  const result = await db.query(
    `
      delete from budget_policies
      where id = $1
      returning *
    `,
    [budgetPolicyId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapBudgetPolicy(result.rows[0]);
}

async function sumBudgetPolicyUsageForPeriod(
  db: Database,
  policy: BudgetPolicy,
  period = getCurrentBudgetPeriod(),
) {
  const clauses = [
    "ue.workspace_id = $1",
    "ue.created_at >= $2",
    "ue.created_at < $3",
  ];
  const values: unknown[] = [policy.workspaceId, period.startsAt, period.endsAt];
  const joins = new Set<string>();

  if (policy.projectId) {
    values.push(policy.projectId);
    clauses.push(`ue.project_id = $${values.length}`);
  }

  if (policy.environmentId) {
    values.push(policy.environmentId);
    clauses.push(`ue.environment_id = $${values.length}`);
  }

  if (policy.environment) {
    joins.add("left join environments env on env.id = ue.environment_id");
    joins.add("left join virtual_keys vk on vk.id = ue.virtual_key_id");
    values.push(policy.environment);
    clauses.push(`coalesce(env.runtime, vk.environment) = $${values.length}`);
  }

  const result = await db.query<{ total: string | number | null }>(
    `
      select coalesce(sum(ue.cost_usd), 0) as total
      from usage_events ue
      ${Array.from(joins).join("\n")}
      where ${clauses.join(" and ")}
    `,
    values,
  );

  return Number(result.rows[0]?.total ?? 0);
}

type BudgetPolicyPreventedUsageSummary = {
  preventedRequestsCount: number;
  preventedEstimatedCostUsd: number;
  preventedUnestimatedRequestsCount: number;
};

function createEmptyBudgetPolicyPreventedUsageSummary(): BudgetPolicyPreventedUsageSummary {
  return {
    preventedRequestsCount: 0,
    preventedEstimatedCostUsd: 0,
    preventedUnestimatedRequestsCount: 0,
  };
}

async function sumBudgetPolicyPreventedUsageForPeriod(
  db: Database,
  policy: BudgetPolicy,
  period = getCurrentBudgetPeriod(),
): Promise<BudgetPolicyPreventedUsageSummary> {
  const result = await db.query<{
    blocked_events: string | number | null;
    estimated_events: string | number | null;
    estimated_cost_usd: string | number | null;
  }>(
    `
      select
        count(*)::text as blocked_events,
        count(*) filter (where jsonb_typeof(ue.metadata -> 'estimatedRequestCostUsd') = 'number')::text as estimated_events,
        coalesce(
          sum(
            case
              when jsonb_typeof(ue.metadata -> 'estimatedRequestCostUsd') = 'number'
                then (ue.metadata ->> 'estimatedRequestCostUsd')::numeric
              else 0
            end
          ),
          0
        )::text as estimated_cost_usd
      from usage_events ue
      where ue.workspace_id = $1
        and ue.created_at >= $2
        and ue.created_at < $3
        and ue.status = 'blocked'
        and ue.metadata ->> 'reason' in (
          'budget_preflight_estimate_exceeds_remaining_headroom',
          'budget_hard_limit_exceeded',
          'pricing_not_configured_for_budget_enforcement'
        )
        and (
          ue.metadata ->> 'budgetPolicyId' = $4
          or exists (
            select 1
            from jsonb_array_elements_text(coalesce(ue.metadata -> 'blockedBudgetPolicyIds', '[]'::jsonb)) as blocked_budget(value)
            where blocked_budget.value = $4
          )
          or exists (
            select 1
            from jsonb_array_elements_text(coalesce(ue.metadata -> 'exhaustedBudgetPolicyIds', '[]'::jsonb)) as exhausted_budget(value)
            where exhausted_budget.value = $4
          )
        )
    `,
    [policy.workspaceId, period.startsAt, period.endsAt, policy.id],
  );

  const blockedEvents = Number(result.rows[0]?.blocked_events ?? 0);
  const estimatedEvents = Number(result.rows[0]?.estimated_events ?? 0);

  return {
    preventedRequestsCount: blockedEvents,
    preventedEstimatedCostUsd: Number(Number(result.rows[0]?.estimated_cost_usd ?? 0).toFixed(6)),
    preventedUnestimatedRequestsCount: Math.max(blockedEvents - estimatedEvents, 0),
  };
}

function createBudgetPolicySummary(
  policy: BudgetPolicy,
  currentMonthSpendUsd: number,
  preventedUsage: BudgetPolicyPreventedUsageSummary,
): BudgetPolicySummary {
  const softLimitUsd = getBudgetSoftLimitUsd(policy);
  const remainingUsd = Number(Math.max(policy.monthlyUsdLimit - currentMonthSpendUsd, 0).toFixed(6));

  return {
    ...policy,
    scopeKind: getBudgetScopeKind(policy),
    currentMonthSpendUsd,
    remainingUsd,
    softLimitUsd,
    softLimitReached: currentMonthSpendUsd >= softLimitUsd,
    hardLimitReached: currentMonthSpendUsd >= policy.monthlyUsdLimit,
    preventedRequestsCount: preventedUsage.preventedRequestsCount,
    preventedEstimatedCostUsd: preventedUsage.preventedEstimatedCostUsd,
    preventedUnestimatedRequestsCount: preventedUsage.preventedUnestimatedRequestsCount,
  };
}

export async function getBudgetPolicySummaryById(db: Database, budgetPolicyId: string, now = new Date()) {
  const policy = await findBudgetPolicyById(db, budgetPolicyId);
  if (!policy) {
    return null;
  }

  const period = getCurrentBudgetPeriod(now);
  const [spend, preventedUsage] = await Promise.all([
    sumBudgetPolicyUsageForPeriod(db, policy, period),
    sumBudgetPolicyPreventedUsageForPeriod(db, policy, period),
  ]);
  return createBudgetPolicySummary(policy, spend, preventedUsage);
}

export async function listBudgetPolicySummaries(db: Database, workspaceId: string, now = new Date()) {
  const period = getCurrentBudgetPeriod(now);
  const policies = await listBudgetPolicies(db, workspaceId);
  const metricsByPolicy = await Promise.all(
    policies.map(async (policy) => {
      const [spend, preventedUsage] = await Promise.all([
        sumBudgetPolicyUsageForPeriod(db, policy, period),
        sumBudgetPolicyPreventedUsageForPeriod(db, policy, period),
      ]);

      return {
        policy,
        spend,
        preventedUsage,
      };
    }),
  );

  return metricsByPolicy.map(({ policy, spend, preventedUsage }) =>
    createBudgetPolicySummary(policy, spend, preventedUsage),
  );
}

export async function evaluateApplicableBudgetPolicies(
  db: Database,
  scope: {
    workspaceId: string;
    projectId: string | null;
    environmentId: string | null;
    environment: BudgetPolicy["environment"];
  },
  now = new Date(),
) {
  const period = getCurrentBudgetPeriod(now);
  const policies = await listBudgetPolicies(db, scope.workspaceId);
  const applicablePolicies = policies.filter((policy) => doesBudgetPolicyApply(policy, scope));
  const metricsByPolicy = await Promise.all(
    applicablePolicies.map(async (policy) => {
      const [spend, preventedUsage] = await Promise.all([
        sumBudgetPolicyUsageForPeriod(db, policy, period),
        sumBudgetPolicyPreventedUsageForPeriod(db, policy, period),
      ]);

      return {
        policy,
        spend,
        preventedUsage,
      };
    }),
  );

  return metricsByPolicy.map(({ policy, spend, preventedUsage }) =>
    createBudgetPolicySummary(policy, spend, preventedUsage),
  );
}

type UsageEventFilterInput = {
  workspaceId?: string;
  projectId?: string;
  projectIds?: string[];
  environmentId?: string;
  virtualKeyId?: string;
  providerConnectionId?: string;
  budgetPolicyId?: string;
  provider?: string;
  model?: string;
  requestId?: string;
  providerRequestId?: string;
  status?: string;
  statusGroup?: "attention";
  surface?: "metadata" | "streamed" | "interrupted";
  minLatencyMs?: number;
  virtualKeyOwner?: string;
  issuedByMemberId?: string;
  sortBy?: "newest" | "oldest" | "latency_desc" | "cost_desc" | "tokens_desc";
  from?: Date;
  to?: Date;
};

type UsageLedgerFilterInput = UsageEventFilterInput & {
  organizationId?: string;
  owner?: string;
  canonicalModel?: string;
  modelFamily?: string;
};

type AuditLogFilterInput = {
  workspaceId?: string;
  projectId?: string;
  projectIds?: string[];
  environmentId?: string;
  actorType?: string;
  actorId?: string;
  action?: string;
  subjectType?: string;
  subjectId?: string;
  from?: Date;
  to?: Date;
};

type PromptInspectionFilterInput = {
  workspaceId?: string;
  projectId?: string;
  projectIds?: string[];
  environmentId?: string;
  virtualKeyId?: string;
  providerConnectionId?: string;
  usageEventId?: string;
  requestId?: string;
  provider?: string;
  model?: string;
  verdict?: PromptInspection["verdict"];
  reviewStatus?: PromptInspection["reviewStatus"];
  riskCategory?: string;
  activityLabel?: PromptInspection["topActivityLabel"];
  escalatedOnly?: boolean;
  sortBy?: PromptInspectionSort;
  from?: Date;
  to?: Date;
};

function buildUsageEventFilterQuery(filters: UsageEventFilterInput) {
  const clauses = ["1 = 1"];
  const values: unknown[] = [];

  if (filters.workspaceId) {
    values.push(filters.workspaceId);
    clauses.push(`workspace_id = $${values.length}`);
  }
  if (filters.projectId) {
    values.push(filters.projectId);
    clauses.push(`project_id = $${values.length}`);
  } else if (filters.projectIds?.length) {
    values.push(filters.projectIds);
    clauses.push(`project_id = any($${values.length}::uuid[])`);
  }
  if (filters.environmentId) {
    values.push(filters.environmentId);
    clauses.push(`environment_id = $${values.length}`);
  }
  if (filters.virtualKeyId) {
    values.push(filters.virtualKeyId);
    clauses.push(`virtual_key_id = $${values.length}`);
  }
  if (filters.providerConnectionId) {
    values.push(filters.providerConnectionId);
    clauses.push(`provider_connection_id = $${values.length}`);
  }
  if (filters.budgetPolicyId) {
    values.push(filters.budgetPolicyId);
    clauses.push(
      `(
        metadata ->> 'budgetPolicyId' = $${values.length}
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(metadata -> 'blockedBudgetPolicyIds', '[]'::jsonb)) as blocked_budget(value)
          where blocked_budget.value = $${values.length}
        )
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(metadata -> 'exhaustedBudgetPolicyIds', '[]'::jsonb)) as exhausted_budget(value)
          where exhausted_budget.value = $${values.length}
        )
      )`,
    );
  }
  if (filters.provider) {
    values.push(filters.provider);
    clauses.push(`provider = $${values.length}`);
  }
  if (filters.model) {
    values.push(filters.model);
    clauses.push(`model = $${values.length}`);
  }
  if (filters.requestId) {
    values.push(filters.requestId);
    clauses.push(`request_id = $${values.length}`);
  }
  if (filters.providerRequestId) {
    values.push(filters.providerRequestId);
    clauses.push(`provider_request_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }
  if (filters.statusGroup === "attention") {
    clauses.push(`status <> 'success'`);
  }
  if (filters.surface === "metadata") {
    clauses.push(`(metadata ->> 'path' = '/v1/models' or metadata ->> 'path' like '/v1/models/%')`);
  }
  if (filters.surface === "streamed") {
    clauses.push(`coalesce(metadata ->> 'streamed', 'false') = 'true'`);
  }
  if (filters.surface === "interrupted") {
    clauses.push(
      `(coalesce(metadata ->> 'streamInterrupted', 'false') = 'true' or nullif(metadata ->> 'streamError', '') is not null)`,
    );
  }
  if (filters.minLatencyMs !== undefined) {
    values.push(filters.minLatencyMs);
    clauses.push(`latency_ms >= $${values.length}`);
  }
  if (filters.virtualKeyOwner && filters.issuedByMemberId) {
    values.push(filters.virtualKeyOwner);
    const ownerIndex = values.length;
    values.push(filters.issuedByMemberId);
    const issuedByMemberIdIndex = values.length;
    clauses.push(
      `exists (
        select 1
        from virtual_keys scoped_virtual_keys
        where scoped_virtual_keys.id = usage_events.virtual_key_id
          and (
            scoped_virtual_keys.owner = $${ownerIndex}
            or scoped_virtual_keys.issued_by_member_id = $${issuedByMemberIdIndex}
          )
      )`,
    );
  } else if (filters.virtualKeyOwner) {
    values.push(filters.virtualKeyOwner);
    clauses.push(
      `exists (
        select 1
        from virtual_keys scoped_virtual_keys
        where scoped_virtual_keys.id = usage_events.virtual_key_id
          and scoped_virtual_keys.owner = $${values.length}
      )`,
    );
  } else if (filters.issuedByMemberId) {
    values.push(filters.issuedByMemberId);
    clauses.push(
      `exists (
        select 1
        from virtual_keys scoped_virtual_keys
        where scoped_virtual_keys.id = usage_events.virtual_key_id
          and scoped_virtual_keys.issued_by_member_id = $${values.length}
      )`,
    );
  }
  if (filters.from) {
    values.push(filters.from);
    clauses.push(`created_at >= $${values.length}`);
  }
  if (filters.to) {
    values.push(filters.to);
    clauses.push(`created_at <= $${values.length}`);
  }

  return {
    clauses,
    values,
  };
}

function buildUsageLedgerFilterQuery(filters: UsageLedgerFilterInput) {
  const clauses = ["1 = 1"];
  const values: unknown[] = [];

  if (filters.organizationId) {
    values.push(filters.organizationId);
    clauses.push(`organization_id = $${values.length}`);
  }
  if (filters.workspaceId) {
    values.push(filters.workspaceId);
    clauses.push(`workspace_id = $${values.length}`);
  }
  if (filters.projectId) {
    values.push(filters.projectId);
    clauses.push(`project_id = $${values.length}`);
  } else if (filters.projectIds?.length) {
    values.push(filters.projectIds);
    clauses.push(`project_id = any($${values.length}::uuid[])`);
  }
  if (filters.environmentId) {
    values.push(filters.environmentId);
    clauses.push(`environment_id = $${values.length}`);
  }
  if (filters.virtualKeyId) {
    values.push(filters.virtualKeyId);
    clauses.push(`virtual_key_id = $${values.length}`);
  }
  if (filters.providerConnectionId) {
    values.push(filters.providerConnectionId);
    clauses.push(`provider_connection_id = $${values.length}`);
  }
  if (filters.provider) {
    values.push(filters.provider);
    clauses.push(`provider = $${values.length}`);
  }
  if (filters.model) {
    values.push(filters.model.trim().toLowerCase());
    clauses.push(`provider_model = $${values.length}`);
  }
  if (filters.canonicalModel) {
    values.push(filters.canonicalModel.trim().toLowerCase());
    clauses.push(`canonical_model = $${values.length}`);
  }
  if (filters.modelFamily) {
    values.push(filters.modelFamily);
    clauses.push(`model_family = $${values.length}`);
  }
  if (filters.owner) {
    values.push(filters.owner);
    clauses.push(`owner = $${values.length}`);
  }
  if (filters.requestId) {
    values.push(filters.requestId);
    clauses.push(`request_id = $${values.length}`);
  }
  if (filters.providerRequestId) {
    values.push(filters.providerRequestId);
    clauses.push(`provider_request_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }
  if (filters.statusGroup === "attention") {
    clauses.push(`status <> 'success'`);
  }
  if (filters.from) {
    values.push(filters.from);
    clauses.push(`created_at >= $${values.length}`);
  }
  if (filters.to) {
    values.push(filters.to);
    clauses.push(`created_at <= $${values.length}`);
  }

  return {
    clauses,
    values,
  };
}

function getUsageEventOrderByClause(sortBy: UsageEventFilterInput["sortBy"]) {
  switch (sortBy) {
    case "oldest":
      return "created_at asc";
    case "latency_desc":
      return "latency_ms desc nulls last, created_at desc";
    case "cost_desc":
      return "cost_usd desc, created_at desc";
    case "tokens_desc":
      return "(prompt_tokens + completion_tokens) desc, created_at desc";
    case "newest":
    default:
      return "created_at desc";
  }
}

function buildAuditLogFilterQuery(filters: AuditLogFilterInput) {
  const clauses = ["1 = 1"];
  const values: unknown[] = [];

  if (filters.workspaceId) {
    values.push(filters.workspaceId);
    clauses.push(`workspace_id = $${values.length}`);
  }
  if (filters.projectId) {
    values.push(filters.projectId);
    clauses.push(`project_id = $${values.length}`);
  } else if (filters.projectIds?.length) {
    values.push(filters.projectIds);
    clauses.push(`project_id = any($${values.length}::uuid[])`);
  }
  if (filters.environmentId) {
    values.push(filters.environmentId);
    clauses.push(`environment_id = $${values.length}`);
  }
  if (filters.actorType) {
    values.push(filters.actorType);
    clauses.push(`actor_type = $${values.length}`);
  }
  if (filters.actorId) {
    values.push(filters.actorId);
    clauses.push(`actor_id = $${values.length}`);
  }
  if (filters.action) {
    values.push(filters.action);
    clauses.push(`action = $${values.length}`);
  }
  if (filters.subjectType) {
    values.push(filters.subjectType);
    clauses.push(`subject_type = $${values.length}`);
  }
  if (filters.subjectId) {
    values.push(filters.subjectId);
    clauses.push(`subject_id = $${values.length}`);
  }
  if (filters.from) {
    values.push(filters.from);
    clauses.push(`created_at >= $${values.length}`);
  }
  if (filters.to) {
    values.push(filters.to);
    clauses.push(`created_at <= $${values.length}`);
  }

  return {
    clauses,
    values,
  };
}

function buildPromptInspectionFilterQuery(filters: PromptInspectionFilterInput) {
  const clauses = ["1 = 1"];
  const values: unknown[] = [];

  if (filters.workspaceId) {
    values.push(filters.workspaceId);
    clauses.push(`workspace_id = $${values.length}`);
  }
  if (filters.projectId) {
    values.push(filters.projectId);
    clauses.push(`project_id = $${values.length}`);
  } else if (filters.projectIds?.length) {
    values.push(filters.projectIds);
    clauses.push(`project_id = any($${values.length}::uuid[])`);
  }
  if (filters.environmentId) {
    values.push(filters.environmentId);
    clauses.push(`environment_id = $${values.length}`);
  }
  if (filters.virtualKeyId) {
    values.push(filters.virtualKeyId);
    clauses.push(`virtual_key_id = $${values.length}`);
  }
  if (filters.providerConnectionId) {
    values.push(filters.providerConnectionId);
    clauses.push(`provider_connection_id = $${values.length}`);
  }
  if (filters.usageEventId) {
    values.push(filters.usageEventId);
    clauses.push(`usage_event_id = $${values.length}`);
  }
  if (filters.requestId) {
    values.push(filters.requestId);
    clauses.push(`request_id = $${values.length}`);
  }
  if (filters.provider) {
    values.push(filters.provider);
    clauses.push(`provider = $${values.length}`);
  }
  if (filters.model) {
    values.push(filters.model);
    clauses.push(`model = $${values.length}`);
  }
  if (filters.verdict) {
    values.push(filters.verdict);
    clauses.push(`verdict = $${values.length}`);
  }
  if (filters.reviewStatus) {
    values.push(filters.reviewStatus);
    clauses.push(`review_status = $${values.length}`);
  }
  if (filters.riskCategory) {
    values.push(filters.riskCategory);
    clauses.push(`$${values.length} = any(risk_categories)`);
  }
  if (filters.activityLabel) {
    values.push(filters.activityLabel);
    clauses.push(`top_activity_label = $${values.length}`);
  }
  if (filters.escalatedOnly) {
    clauses.push(`coalesce(context_counts ->> 'escalated', 'false') = 'true'`);
  }
  if (filters.from) {
    values.push(filters.from);
    clauses.push(`created_at >= $${values.length}`);
  }
  if (filters.to) {
    values.push(filters.to);
    clauses.push(`created_at <= $${values.length}`);
  }

  return {
    clauses,
    values,
  };
}

function getPromptInspectionOrderByClause(sortBy: PromptInspectionFilterInput["sortBy"]) {
  switch (sortBy) {
    case "oldest":
      return "created_at asc, id asc";
    case "score_desc":
      return "score desc, created_at desc, id desc";
    case "score_asc":
      return "score asc, created_at desc, id desc";
    case "verdict_priority":
      return `
        case verdict
          when 'block' then 0
          when 'review' then 1
          when 'allow_with_record' then 2
          else 3
        end asc,
        created_at desc,
        id desc
      `;
    case "review_status_priority":
      return `
        case review_status
          when 'pending' then 0
          when 'needs_followup' then 1
          when 'confirmed_violation' then 2
          when 'confirmed_benign' then 3
          else 4
        end asc,
        created_at desc,
        id desc
      `;
    case "provider_asc":
      return "provider asc nulls last, created_at desc, id desc";
    case "model_asc":
      return "model asc nulls last, created_at desc, id desc";
    case "newest":
    default:
      return "created_at desc, id desc";
  }
}

export async function appendUsageEvent(db: Database, input: RecordUsageEventInput) {
  const normalizedMetadata = normalizeUsageEventBudgetMetadata(input.metadata);
  const result = await db.query(
    `
      with inserted_event as (
        insert into usage_events (
          workspace_id,
          project_id,
          environment_id,
          virtual_key_id,
          provider_connection_id,
          request_id,
          provider_request_id,
          provider,
          model,
          prompt_tokens,
          completion_tokens,
          cost_usd,
          latency_ms,
          status,
          metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
        returning *
      ),
      mapping_input as (
        select
          ie.*,
          nullif(lower(btrim(ie.model)), '') as provider_model_key,
          coalesce(
            nullif(lower(btrim(ie.metadata ->> 'canonicalModel')), ''),
            nullif(lower(btrim(ie.model)), '')
          ) as canonical_model_key,
          nullif(btrim(ie.metadata ->> 'modelFamily'), '') as model_family_value,
          coalesce(nullif(btrim(ie.metadata ->> 'modelMappingSource'), ''), 'gateway-runtime') as mapping_source_value
        from inserted_event ie
      ),
      upserted_mapping as (
        insert into model_mappings (
          mapping_key,
          provider,
          provider_model,
          canonical_model,
          model_family,
          metadata
        )
        select
          concat_ws(':', mi.provider, mi.provider_model_key),
          mi.provider,
          mi.provider_model_key,
          mi.canonical_model_key,
          mi.model_family_value,
          jsonb_build_object(
            'mappingSource', mi.mapping_source_value,
            'lastUsageEventId', mi.id,
            'lastObservedAt', timezone('utc', mi.created_at)
          )
        from mapping_input mi
        where mi.provider is not null
          and mi.provider_model_key is not null
        on conflict (mapping_key) do update
        set canonical_model = excluded.canonical_model,
            model_family = coalesce(excluded.model_family, model_mappings.model_family),
            metadata = model_mappings.metadata || excluded.metadata,
            updated_at = now()
        returning *
      ),
      snapshot_input as (
        select
          mi.*,
          coalesce(nullif(btrim(mi.metadata ->> 'pricingSource'), ''), 'unknown') as pricing_source_value,
          nullif(btrim(mi.metadata ->> 'pricingInputUsdPerMillion'), '')::numeric(14, 6) as pricing_input_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingOutputUsdPerMillion'), '')::numeric(14, 6) as pricing_output_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingCachedInputUsdPerMillion'), '')::numeric(14, 6) as pricing_cached_input_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingCacheReadInputUsdPerMillion'), '')::numeric(14, 6) as pricing_cache_read_input_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingCacheWrite5mInputUsdPerMillion'), '')::numeric(14, 6) as pricing_cache_write_5m_input_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingCacheWrite1hInputUsdPerMillion'), '')::numeric(14, 6) as pricing_cache_write_1h_input_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingLongContextThresholdInputTokens'), '')::integer as pricing_long_context_threshold_input_tokens,
          nullif(btrim(mi.metadata ->> 'pricingLongContextInputUsdPerMillion'), '')::numeric(14, 6) as pricing_long_context_input_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingLongContextOutputUsdPerMillion'), '')::numeric(14, 6) as pricing_long_context_output_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingLongContextCacheReadInputUsdPerMillion'), '')::numeric(14, 6) as pricing_long_context_cache_read_input_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingLongContextCacheWrite5mInputUsdPerMillion'), '')::numeric(14, 6) as pricing_long_context_cache_write_5m_input_usd_per_million,
          nullif(btrim(mi.metadata ->> 'pricingLongContextCacheWrite1hInputUsdPerMillion'), '')::numeric(14, 6) as pricing_long_context_cache_write_1h_input_usd_per_million
        from mapping_input mi
      ),
      upserted_snapshot as (
        insert into price_snapshots (
          snapshot_key,
          provider,
          provider_connection_id,
          provider_model,
          canonical_model,
          input_usd_per_million,
          output_usd_per_million,
          cached_input_usd_per_million,
          cache_read_input_usd_per_million,
          cache_write_5m_input_usd_per_million,
          cache_write_1h_input_usd_per_million,
          long_context_threshold_input_tokens,
          long_context_input_usd_per_million,
          long_context_output_usd_per_million,
          long_context_cache_read_input_usd_per_million,
          long_context_cache_write_5m_input_usd_per_million,
          long_context_cache_write_1h_input_usd_per_million,
          pricing_source,
          metadata
        )
        select
          concat_ws(
            ':',
            si.provider,
            coalesce(si.provider_connection_id::text, 'workspace-default'),
            si.provider_model_key,
            coalesce(si.canonical_model_key, si.provider_model_key),
            si.pricing_source_value,
            si.pricing_input_usd_per_million::text,
            si.pricing_output_usd_per_million::text,
            si.pricing_cached_input_usd_per_million::text,
            si.pricing_cache_read_input_usd_per_million::text,
            si.pricing_cache_write_5m_input_usd_per_million::text,
            si.pricing_cache_write_1h_input_usd_per_million::text,
            si.pricing_long_context_threshold_input_tokens::text,
            si.pricing_long_context_input_usd_per_million::text,
            si.pricing_long_context_output_usd_per_million::text,
            si.pricing_long_context_cache_read_input_usd_per_million::text,
            si.pricing_long_context_cache_write_5m_input_usd_per_million::text,
            si.pricing_long_context_cache_write_1h_input_usd_per_million::text
          ),
          si.provider,
          si.provider_connection_id,
          si.provider_model_key,
          coalesce(si.canonical_model_key, si.provider_model_key),
          si.pricing_input_usd_per_million,
          si.pricing_output_usd_per_million,
          si.pricing_cached_input_usd_per_million,
          si.pricing_cache_read_input_usd_per_million,
          si.pricing_cache_write_5m_input_usd_per_million,
          si.pricing_cache_write_1h_input_usd_per_million,
          si.pricing_long_context_threshold_input_tokens,
          si.pricing_long_context_input_usd_per_million,
          si.pricing_long_context_output_usd_per_million,
          si.pricing_long_context_cache_read_input_usd_per_million,
          si.pricing_long_context_cache_write_5m_input_usd_per_million,
          si.pricing_long_context_cache_write_1h_input_usd_per_million,
          si.pricing_source_value,
          jsonb_build_object(
            'usageEventId', si.id,
            'capturedFrom', 'usage-event'
          )
        from snapshot_input si
        where si.provider is not null
          and si.provider_model_key is not null
          and si.pricing_input_usd_per_million is not null
          and si.pricing_output_usd_per_million is not null
        on conflict (snapshot_key) do update
        set metadata = price_snapshots.metadata || excluded.metadata,
            captured_at = now()
        returning *
      ),
      ledger_upsert as (
        insert into usage_ledger_entries (
          usage_event_id,
          organization_id,
          workspace_id,
          project_id,
          environment_id,
          provider_connection_id,
          virtual_key_id,
          owner,
          provider,
          provider_model,
          canonical_model,
          model_family,
          price_snapshot_id,
          pricing_source,
          input_usd_per_million,
          output_usd_per_million,
          cached_input_usd_per_million,
          cache_read_input_usd_per_million,
          cache_write_5m_input_usd_per_million,
          cache_write_1h_input_usd_per_million,
          long_context_threshold_input_tokens,
          long_context_input_usd_per_million,
          long_context_output_usd_per_million,
          long_context_cache_read_input_usd_per_million,
          long_context_cache_write_5m_input_usd_per_million,
          long_context_cache_write_1h_input_usd_per_million,
          status,
          request_id,
          provider_request_id,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          cost_usd,
          event_date,
          metadata,
          created_at
        )
        select
          ie.id,
          w.organization_id,
          ie.workspace_id,
          ie.project_id,
          ie.environment_id,
          ie.provider_connection_id,
          ie.virtual_key_id,
          nullif(btrim(vk.owner), ''),
          ie.provider,
          mi.provider_model_key,
          coalesce(um.canonical_model, mi.canonical_model_key),
          coalesce(um.model_family, mi.model_family_value),
          us.id,
          coalesce(us.pricing_source, si.pricing_source_value, 'unknown'),
          us.input_usd_per_million,
          us.output_usd_per_million,
          us.cached_input_usd_per_million,
          us.cache_read_input_usd_per_million,
          us.cache_write_5m_input_usd_per_million,
          us.cache_write_1h_input_usd_per_million,
          us.long_context_threshold_input_tokens,
          us.long_context_input_usd_per_million,
          us.long_context_output_usd_per_million,
          us.long_context_cache_read_input_usd_per_million,
          us.long_context_cache_write_5m_input_usd_per_million,
          us.long_context_cache_write_1h_input_usd_per_million,
          ie.status,
          ie.request_id,
          ie.provider_request_id,
          coalesce(ie.prompt_tokens, 0),
          coalesce(ie.completion_tokens, 0),
          coalesce(ie.prompt_tokens, 0) + coalesce(ie.completion_tokens, 0),
          coalesce(ie.cost_usd, 0),
          timezone('utc', ie.created_at)::date,
          ie.metadata,
          ie.created_at
        from inserted_event ie
        left join workspaces w on w.id = ie.workspace_id
        left join virtual_keys vk on vk.id = ie.virtual_key_id
        left join mapping_input mi on true
        left join snapshot_input si on true
        left join upserted_mapping um on true
        left join upserted_snapshot us on true
        on conflict (usage_event_id) do update
        set organization_id = excluded.organization_id,
            workspace_id = excluded.workspace_id,
            project_id = excluded.project_id,
            environment_id = excluded.environment_id,
            provider_connection_id = excluded.provider_connection_id,
            virtual_key_id = excluded.virtual_key_id,
            owner = excluded.owner,
            provider = excluded.provider,
            provider_model = excluded.provider_model,
            canonical_model = excluded.canonical_model,
            model_family = excluded.model_family,
            price_snapshot_id = excluded.price_snapshot_id,
            pricing_source = excluded.pricing_source,
            input_usd_per_million = excluded.input_usd_per_million,
            output_usd_per_million = excluded.output_usd_per_million,
            cached_input_usd_per_million = excluded.cached_input_usd_per_million,
            cache_read_input_usd_per_million = excluded.cache_read_input_usd_per_million,
            cache_write_5m_input_usd_per_million = excluded.cache_write_5m_input_usd_per_million,
            cache_write_1h_input_usd_per_million = excluded.cache_write_1h_input_usd_per_million,
            long_context_threshold_input_tokens = excluded.long_context_threshold_input_tokens,
            long_context_input_usd_per_million = excluded.long_context_input_usd_per_million,
            long_context_output_usd_per_million = excluded.long_context_output_usd_per_million,
            long_context_cache_read_input_usd_per_million = excluded.long_context_cache_read_input_usd_per_million,
            long_context_cache_write_5m_input_usd_per_million = excluded.long_context_cache_write_5m_input_usd_per_million,
            long_context_cache_write_1h_input_usd_per_million = excluded.long_context_cache_write_1h_input_usd_per_million,
            status = excluded.status,
            request_id = excluded.request_id,
            provider_request_id = excluded.provider_request_id,
            prompt_tokens = excluded.prompt_tokens,
            completion_tokens = excluded.completion_tokens,
            total_tokens = excluded.total_tokens,
            cost_usd = excluded.cost_usd,
            event_date = excluded.event_date,
            metadata = excluded.metadata,
            created_at = excluded.created_at
        returning *
      ),
      forecast_upsert as (
        insert into usage_forecast_daily (
          dimension_key,
          bucket_date,
          organization_id,
          workspace_id,
          project_id,
          environment_id,
          provider,
          owner,
          canonical_model,
          request_count,
          total_prompt_tokens,
          total_completion_tokens,
          total_tokens,
          total_cost_usd,
          first_event_at,
          last_event_at
        )
        select
          concat_ws(
            ':',
            to_char(lu.event_date, 'YYYY-MM-DD'),
            coalesce(lu.organization_id::text, 'null'),
            coalesce(lu.workspace_id::text, 'null'),
            coalesce(lu.project_id::text, 'null'),
            coalesce(lu.environment_id::text, 'null'),
            coalesce(lu.provider, 'null'),
            coalesce(lu.owner, 'null'),
            coalesce(lu.canonical_model, 'null')
          ),
          lu.event_date,
          lu.organization_id,
          lu.workspace_id,
          lu.project_id,
          lu.environment_id,
          lu.provider,
          lu.owner,
          lu.canonical_model,
          1,
          lu.prompt_tokens,
          lu.completion_tokens,
          lu.total_tokens,
          lu.cost_usd,
          lu.created_at,
          lu.created_at
        from ledger_upsert lu
        where lu.workspace_id is not null
        on conflict (dimension_key) do update
        set request_count = usage_forecast_daily.request_count + excluded.request_count,
            total_prompt_tokens = usage_forecast_daily.total_prompt_tokens + excluded.total_prompt_tokens,
            total_completion_tokens = usage_forecast_daily.total_completion_tokens + excluded.total_completion_tokens,
            total_tokens = usage_forecast_daily.total_tokens + excluded.total_tokens,
            total_cost_usd = usage_forecast_daily.total_cost_usd + excluded.total_cost_usd,
            first_event_at = least(usage_forecast_daily.first_event_at, excluded.first_event_at),
            last_event_at = greatest(usage_forecast_daily.last_event_at, excluded.last_event_at),
            updated_at = now()
        returning id
      )
      select *
      from inserted_event
    `,
    [
      input.workspaceId,
      input.projectId,
      input.environmentId,
      input.virtualKeyId,
      input.providerConnectionId,
      input.requestId,
      input.providerRequestId,
      input.provider,
      input.model,
      input.promptTokens,
      input.completionTokens,
      input.costUsd,
      input.latencyMs,
      input.status,
      JSON.stringify(normalizedMetadata),
    ],
  );
  return mapUsageEvent(result.rows[0]);
}

export async function listUsageEvents(
  db: Database,
  filters: {
    workspaceId?: string;
    projectId?: string;
    projectIds?: string[];
    environmentId?: string;
    virtualKeyId?: string;
    providerConnectionId?: string;
    provider?: string;
    model?: string;
    requestId?: string;
    providerRequestId?: string;
    status?: string;
    statusGroup?: "attention";
    surface?: "metadata" | "streamed" | "interrupted";
    minLatencyMs?: number;
    virtualKeyOwner?: string;
    issuedByMemberId?: string;
    sortBy?: "newest" | "oldest" | "latency_desc" | "cost_desc" | "tokens_desc";
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  },
) {
  const { clauses, values } = buildUsageEventFilterQuery(filters);
  const orderByClause = getUsageEventOrderByClause(filters.sortBy);

  const countResult = await db.query<{ count: string }>(
    `
      select count(*)::text as count
      from usage_events
      where ${clauses.join(" and ")}
    `,
    values,
  );

  values.push(filters.limit);
  values.push(filters.offset);

  const result = await db.query(
    `
      select *
      from usage_events
      where ${clauses.join(" and ")}
      order by ${orderByClause}
      limit $${values.length - 1}
      offset $${values.length}
    `,
    values,
  );

  return {
    items: result.rows.map(mapUsageEvent),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function getUsageEventById(db: Database, usageEventId: string) {
  const result = await db.query(
    `
      select *
      from usage_events
      where id = $1
      limit 1
    `,
    [usageEventId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapUsageEvent(result.rows[0]);
}

export async function getUsageEventSummary(db: Database, filters: UsageEventFilterInput) {
  const { clauses, values } = buildUsageEventFilterQuery(filters);
  const result = await db.query<{
    total_events: string | number | null;
    total_prompt_tokens: string | number | null;
    total_completion_tokens: string | number | null;
    total_cost_usd: string | number | null;
    average_latency_ms: string | number | null;
  }>(
    `
      select
        count(*)::text as total_events,
        coalesce(sum(prompt_tokens), 0)::text as total_prompt_tokens,
        coalesce(sum(completion_tokens), 0)::text as total_completion_tokens,
        coalesce(sum(cost_usd), 0)::text as total_cost_usd,
        avg(latency_ms)::text as average_latency_ms
      from usage_events
      where ${clauses.join(" and ")}
    `,
    values,
  );

  const [statusBreakdownResult, providerBreakdownResult, modelBreakdownResult] = await Promise.all([
    db.query<{
      status: "success" | "error" | "blocked";
      event_count: string | number | null;
      total_tokens: string | number | null;
      total_cost_usd: string | number | null;
    }>(
      `
        select
          status,
          count(*)::text as event_count,
          coalesce(sum(prompt_tokens + completion_tokens), 0)::text as total_tokens,
          coalesce(sum(cost_usd), 0)::text as total_cost_usd
        from usage_events
        where ${clauses.join(" and ")}
        group by status
        order by count(*) desc, status asc
      `,
      values,
    ),
    db.query<{
      provider: string | null;
      event_count: string | number | null;
      total_tokens: string | number | null;
      total_cost_usd: string | number | null;
    }>(
      `
        select
          provider,
          count(*)::text as event_count,
          coalesce(sum(prompt_tokens + completion_tokens), 0)::text as total_tokens,
          coalesce(sum(cost_usd), 0)::text as total_cost_usd
        from usage_events
        where ${clauses.join(" and ")}
        group by provider
        order by coalesce(sum(cost_usd), 0) desc, coalesce(sum(prompt_tokens + completion_tokens), 0) desc, count(*) desc
      `,
      values,
    ),
    db.query<{
      model: string | null;
      event_count: string | number | null;
      total_tokens: string | number | null;
      total_cost_usd: string | number | null;
    }>(
      `
        select
          model,
          count(*)::text as event_count,
          coalesce(sum(prompt_tokens + completion_tokens), 0)::text as total_tokens,
          coalesce(sum(cost_usd), 0)::text as total_cost_usd
        from usage_events
        where ${clauses.join(" and ")}
        group by model
        order by coalesce(sum(cost_usd), 0) desc, coalesce(sum(prompt_tokens + completion_tokens), 0) desc, count(*) desc
      `,
      values,
    ),
  ]);

  const row = result.rows[0];
  const totalPromptTokens = Number(row?.total_prompt_tokens ?? 0);
  const totalCompletionTokens = Number(row?.total_completion_tokens ?? 0);
  const totalEvents = Number(row?.total_events ?? 0);
  const averageLatencyMsRaw = row?.average_latency_ms;
  const statusBreakdown = statusBreakdownResult.rows.map((breakdown) => ({
    status: breakdown.status,
    eventCount: Number(breakdown.event_count ?? 0),
    totalTokens: Number(breakdown.total_tokens ?? 0),
    totalCostUsd: Number(breakdown.total_cost_usd ?? 0),
  }));
  const providerBreakdown = providerBreakdownResult.rows.map((breakdown) => ({
    provider: breakdown.provider ? (breakdown.provider as "anthropic" | "openai" | "bedrock" | "vertex" | "openai-compatible") : null,
    eventCount: Number(breakdown.event_count ?? 0),
    totalTokens: Number(breakdown.total_tokens ?? 0),
    totalCostUsd: Number(breakdown.total_cost_usd ?? 0),
  }));
  const modelBreakdown = modelBreakdownResult.rows.map((breakdown) => ({
    model: breakdown.model,
    eventCount: Number(breakdown.event_count ?? 0),
    totalTokens: Number(breakdown.total_tokens ?? 0),
    totalCostUsd: Number(breakdown.total_cost_usd ?? 0),
  }));
  const successCount = statusBreakdown.find((breakdown) => breakdown.status === "success")?.eventCount ?? 0;

  return {
    totalEvents,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    totalCostUsd: Number(row?.total_cost_usd ?? 0),
    averageLatencyMs:
      averageLatencyMsRaw === null || averageLatencyMsRaw === undefined ? null : Number(Number(averageLatencyMsRaw).toFixed(1)),
    successRate: totalEvents > 0 ? Number((successCount / totalEvents).toFixed(4)) : null,
    statusBreakdown,
    providerBreakdown,
    modelBreakdown,
  };
}

export async function listUsageForecastDaily(db: Database, filters: {
  window: number;
  workspaceId?: string;
  projectId?: string;
  projectIds?: string[];
  environmentId?: string;
}) {
  const windowDays = Math.min(Math.max(Math.trunc(filters.window ?? 30), 1), 30);
  const now = new Date();
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  fromDate.setUTCDate(fromDate.getUTCDate() - (windowDays - 1));

  const clauses = ["1 = 1"];
  const values: unknown[] = [];

  if (filters.workspaceId) {
    values.push(filters.workspaceId);
    clauses.push(`workspace_id = $${values.length}`);
  }

  if (filters.projectId) {
    values.push(filters.projectId);
    clauses.push(`project_id = $${values.length}`);
  } else if (filters.projectIds && filters.projectIds.length) {
    values.push(filters.projectIds);
    clauses.push(`project_id = any($${values.length}::uuid[])`);
  }

  if (filters.environmentId) {
    values.push(filters.environmentId);
    clauses.push(`environment_id = $${values.length}`);
  }

  values.push(fromDate);
  clauses.push(`bucket_date >= $${values.length}`);

  const result = await db.query(
    `
      select *
      from usage_forecast_daily
      where ${clauses.join(" and ")}
      order by bucket_date asc
    `,
    values,
  );

  return {
    window: windowDays,
    items: result.rows.map(mapUsageForecastDaily),
  };
}

export async function getUsageEventDailySeries(
  db: Database,
  filters: UsageEventFilterInput,
): Promise<UsageEventDailyPoint[]> {
  const { clauses, values } = buildUsageEventFilterQuery(filters);
  const result = await db.query<{
    bucket_date: string | null;
    request_count: string | number | null;
    total_tokens: string | number | null;
    total_cost_usd: string | number | null;
    blocked_count: string | number | null;
    error_count: string | number | null;
  }>(
    `
      select
        to_char(date_trunc('day', created_at at time zone 'utc'), 'YYYY-MM-DD') as bucket_date,
        count(*)::text as request_count,
        coalesce(sum(prompt_tokens + completion_tokens), 0)::text as total_tokens,
        coalesce(sum(cost_usd), 0)::text as total_cost_usd,
        count(*) filter (where status = 'blocked')::text as blocked_count,
        count(*) filter (where status = 'error')::text as error_count
      from usage_events
      where ${clauses.join(" and ")}
      group by 1
      order by 1 asc
    `,
    values,
  );

  return result.rows.map((row) => ({
    bucketDate: String(row.bucket_date ?? ""),
    requestCount: Number(row.request_count ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? 0),
    blockedCount: Number(row.blocked_count ?? 0),
    errorCount: Number(row.error_count ?? 0),
  }));
}

export async function listUsageEventsForExport(db: Database, filters: UsageEventFilterInput) {
  const { clauses, values } = buildUsageEventFilterQuery(filters);
  const orderByClause = getUsageEventOrderByClause(filters.sortBy);
  const result = await db.query(
    `
      select *
      from usage_events
      where ${clauses.join(" and ")}
      order by ${orderByClause}
    `,
    values,
  );

  return result.rows.map(mapUsageEvent);
}

export async function listUsageLedgerEntriesForExport(db: Database, filters: UsageLedgerFilterInput) {
  const { clauses, values } = buildUsageLedgerFilterQuery(filters);
  const orderByClause = getUsageEventOrderByClause(filters.sortBy);
  const result = await db.query(
    `
      select *
      from usage_ledger_entries
      where ${clauses.join(" and ")}
      order by ${orderByClause}
    `,
    values,
  );

  return result.rows.map(mapUsageLedgerEntry);
}

export async function appendAuditLog(
  db: Database,
  input: {
    workspaceId: string | null;
    projectId?: string | null;
    environmentId?: string | null;
    actorType: string;
    actorId: string;
    action: string;
    subjectType: string;
    subjectId: string;
    payload: Record<string, unknown>;
  },
) {
  const result = await db.query(
    `
      insert into audit_logs (
        workspace_id,
        project_id,
        environment_id,
        actor_type,
        actor_id,
        action,
        subject_type,
        subject_id,
        payload
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      returning *
    `,
    [
      input.workspaceId,
      input.projectId ?? null,
      input.environmentId ?? null,
      input.actorType,
      input.actorId,
      input.action,
      input.subjectType,
      input.subjectId,
      JSON.stringify(input.payload),
    ],
  );

  return mapAuditLog(result.rows[0]);
}

export async function listAuditLogs(
  db: Database,
  filters: {
    workspaceId?: string;
    projectId?: string;
    projectIds?: string[];
    environmentId?: string;
    actorType?: string;
    actorId?: string;
    action?: string;
    subjectType?: string;
    subjectId?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  },
) {
  const { clauses, values } = buildAuditLogFilterQuery(filters);

  const countResult = await db.query<{ count: string }>(
    `
      select count(*)::text as count
      from audit_logs
      where ${clauses.join(" and ")}
    `,
    values,
  );

  values.push(filters.limit);
  values.push(filters.offset);

  const result = await db.query(
    `
      select *
      from audit_logs
      where ${clauses.join(" and ")}
      order by created_at desc
      limit $${values.length - 1}
      offset $${values.length}
    `,
    values,
  );

  return {
    items: result.rows.map(mapAuditLog),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function listAuditLogsForExport(db: Database, filters: AuditLogFilterInput) {
  const { clauses, values } = buildAuditLogFilterQuery(filters);
  const result = await db.query(
    `
      select *
      from audit_logs
      where ${clauses.join(" and ")}
      order by created_at desc
    `,
    values,
  );

  return result.rows.map(mapAuditLog);
}

export async function getPromptPolicyByWorkspaceId(db: Database, workspaceId: string) {
  const result = await db.query(
    `
      select *
      from prompt_policies
      where workspace_id = $1
      limit 1
    `,
    [workspaceId],
  );

  if (!result.rowCount) {
    return createDefaultPromptPolicy(workspaceId);
  }

  return mapPromptPolicy(result.rows[0]);
}

export async function notifyPromptPolicyChanged(
  db: Database,
  input: {
    workspaceId: string;
    updatedAt: string;
  },
) {
  if (db.kind !== "pg") {
    return false;
  }

  await db.query("select pg_notify($1, $2)", [
    PROMPT_POLICY_CHANGED_CHANNEL,
    JSON.stringify(input),
  ]);
  return true;
}

export async function upsertPromptPolicy(
  db: Database,
  workspaceId: string,
  input: UpdatePromptPolicyInput,
) {
  const existing = await getPromptPolicyByWorkspaceId(db, workspaceId);
  const nextPolicy = PromptPolicySchema.parse({
    ...existing,
    ...input,
    workspaceId,
    updatedAt: new Date().toISOString(),
  });

  const result = await db.query(
    `
      insert into prompt_policies (
        workspace_id,
        enabled,
        enforcement_mode,
        evidence_mode,
        review_threshold,
        block_threshold,
        allowed_external_domains,
        allowed_keyword_overrides,
        disabled_rule_ids
      )
      values ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[])
      on conflict (workspace_id) do update
      set enabled = excluded.enabled,
          enforcement_mode = excluded.enforcement_mode,
          evidence_mode = excluded.evidence_mode,
          review_threshold = excluded.review_threshold,
          block_threshold = excluded.block_threshold,
          allowed_external_domains = excluded.allowed_external_domains,
          allowed_keyword_overrides = excluded.allowed_keyword_overrides,
          disabled_rule_ids = excluded.disabled_rule_ids,
          updated_at = now()
      returning *
    `,
    [
      workspaceId,
      nextPolicy.enabled,
      nextPolicy.enforcementMode,
      nextPolicy.evidenceMode,
      nextPolicy.reviewThreshold,
      nextPolicy.blockThreshold,
      nextPolicy.allowedExternalDomains,
      nextPolicy.allowedKeywordOverrides,
      nextPolicy.disabledRuleIds,
    ],
  );

  const policy = mapPromptPolicy(result.rows[0]);
  await notifyPromptPolicyChanged(db, {
    workspaceId: policy.workspaceId,
    updatedAt: policy.updatedAt,
  });
  return policy;
}

export async function appendPromptInspection(
  db: Database,
  input: {
    workspaceId: string;
    projectId?: string | null;
    environmentId?: string | null;
    virtualKeyId?: string | null;
    providerConnectionId?: string | null;
    usageEventId?: string | null;
    requestId: string;
    provider?: PromptInspection["provider"];
    model?: string | null;
    verdict: PromptInspection["verdict"];
    score: number;
    topActivityLabel: PromptInspection["topActivityLabel"];
    riskCategories: PromptInspection["riskCategories"];
    hitRuleIds: string[];
    redactedEvidence: string[];
    simhash?: string | null;
    truncated?: boolean;
    contextCounts?: Record<string, unknown>;
    reviewStatus?: PromptInspection["reviewStatus"];
    reviewedBy?: string | null;
    reviewNote?: string | null;
    reviewedAt?: string | null;
  },
) {
  const result = await db.query(
    `
      insert into prompt_inspections (
        workspace_id,
        project_id,
        environment_id,
        virtual_key_id,
        provider_connection_id,
        request_id,
        usage_event_id,
        provider,
        model,
        verdict,
        score,
        top_activity_label,
        risk_categories,
        hit_rule_ids,
        redacted_evidence,
        simhash,
        truncated,
        context_counts,
        review_status,
        reviewed_by,
        review_note,
        reviewed_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13::text[], $14::text[], $15::text[], $16, $17,
        $18::jsonb, $19, $20, $21, $22
      )
      returning *
    `,
    [
      input.workspaceId,
      input.projectId ?? null,
      input.environmentId ?? null,
      input.virtualKeyId ?? null,
      input.providerConnectionId ?? null,
      input.requestId,
      input.usageEventId ?? null,
      input.provider ?? null,
      input.model ?? null,
      input.verdict,
      input.score,
      input.topActivityLabel,
      input.riskCategories,
      input.hitRuleIds,
      input.redactedEvidence,
      input.simhash ?? null,
      input.truncated ?? false,
      JSON.stringify(input.contextCounts ?? {}),
      input.reviewStatus ?? "pending",
      input.reviewedBy ?? null,
      input.reviewNote ?? null,
      input.reviewedAt ? new Date(input.reviewedAt) : null,
    ],
  );

  return mapPromptInspection(result.rows[0]);
}

export async function mergeUsageEventMetadataById(
  db: Database,
  usageEventId: string,
  metadataPatch: Record<string, unknown>,
) {
  const result = await db.query(
    `
      update usage_events
      set metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb
      where id = $1
      returning *
    `,
    [usageEventId, JSON.stringify(metadataPatch)],
  );

  return result.rowCount ? mapUsageEvent(result.rows[0]) : null;
}

export async function getPromptInspectionById(db: Database, promptInspectionId: string) {
  const result = await db.query(
    `
      select *
      from prompt_inspections
      where id = $1
      limit 1
    `,
    [promptInspectionId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapPromptInspection(result.rows[0]);
}

export async function listPromptInspectionsByIds(db: Database, promptInspectionIds: string[]) {
  if (!promptInspectionIds.length) {
    return [];
  }

  const result = await db.query(
    `
      select *
      from prompt_inspections
      where id = any($1::uuid[])
    `,
    [promptInspectionIds],
  );

  return result.rows.map(mapPromptInspection);
}

export async function listPromptInspections(
  db: Database,
  filters: PromptInspectionFilterInput & {
    limit: number;
    offset: number;
  },
) {
  const { clauses, values } = buildPromptInspectionFilterQuery(filters);
  const orderByClause = getPromptInspectionOrderByClause(filters.sortBy);
  const countResult = await db.query<{ count: string }>(
    `
      select count(*)::text as count
      from prompt_inspections
      where ${clauses.join(" and ")}
    `,
    values,
  );

  values.push(filters.limit);
  values.push(filters.offset);

  const result = await db.query(
    `
      select *
      from prompt_inspections
      where ${clauses.join(" and ")}
      order by ${orderByClause}
      limit $${values.length - 1}
      offset $${values.length}
    `,
    values,
  );

  return {
    items: result.rows.map(mapPromptInspection),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function listPromptInspectionsForExport(
  db: Database,
  filters: PromptInspectionFilterInput,
) {
  const { clauses, values } = buildPromptInspectionFilterQuery(filters);
  const orderByClause = getPromptInspectionOrderByClause(filters.sortBy);
  const result = await db.query(
    `
      select *
      from prompt_inspections
      where ${clauses.join(" and ")}
      order by ${orderByClause}
    `,
    values,
  );

  return result.rows.map(mapPromptInspection);
}

export async function getPromptInspectionSummary(
  db: Database,
  filters: PromptInspectionFilterInput,
): Promise<PromptInspectionSummary> {
  const { clauses, values } = buildPromptInspectionFilterQuery(filters);
  const [totalResult, verdictResult, reviewResult, riskResult, activityResult] = await Promise.all([
    db.query<{ count: string | number | null; escalated_count: string | number | null }>(
      `
        select
          count(*)::text as count,
          count(*) filter (where coalesce(context_counts ->> 'escalated', 'false') = 'true')::text as escalated_count
        from prompt_inspections
        where ${clauses.join(" and ")}
      `,
      values,
    ),
    db.query<{ verdict: string; count: string | number | null }>(
      `
        select verdict, count(*)::text as count
        from prompt_inspections
        where ${clauses.join(" and ")}
        group by verdict
        order by count(*) desc, verdict asc
      `,
      values,
    ),
    db.query<{ review_status: string; count: string | number | null }>(
      `
        select review_status, count(*)::text as count
        from prompt_inspections
        where ${clauses.join(" and ")}
        group by review_status
        order by count(*) desc, review_status asc
      `,
      values,
    ),
    db.query<{ risk_category: string; count: string | number | null }>(
      `
        select risk_category, count(*)::text as count
        from (
          select unnest(risk_categories) as risk_category
          from prompt_inspections
          where ${clauses.join(" and ")}
        ) expanded
        group by risk_category
        order by count(*) desc, risk_category asc
      `,
      values,
    ),
    db.query<{ top_activity_label: string; count: string | number | null }>(
      `
        select top_activity_label, count(*)::text as count
        from prompt_inspections
        where ${clauses.join(" and ")}
        group by top_activity_label
        order by count(*) desc, top_activity_label asc
      `,
      values,
    ),
  ]);

  return {
    total: Number(totalResult.rows[0]?.count ?? 0),
    escalatedCount: Number(totalResult.rows[0]?.escalated_count ?? 0),
    verdictBreakdown: verdictResult.rows.map((row) => ({
      verdict: row.verdict as PromptInspectionSummary["verdictBreakdown"][number]["verdict"],
      count: Number(row.count ?? 0),
    })),
    reviewStatusBreakdown: reviewResult.rows.map((row) => ({
      reviewStatus: PromptInspectionReviewStatusSchema.parse(row.review_status),
      count: Number(row.count ?? 0),
    })),
    riskCategoryBreakdown: riskResult.rows.map((row) => ({
      riskCategory: row.risk_category as PromptInspectionSummary["riskCategoryBreakdown"][number]["riskCategory"],
      count: Number(row.count ?? 0),
    })),
    activityBreakdown: activityResult.rows.map((row) => ({
      activityLabel: row.top_activity_label as PromptInspectionSummary["activityBreakdown"][number]["activityLabel"],
      count: Number(row.count ?? 0),
    })),
  };
}

export async function updatePromptInspectionReview(
  db: Database,
  promptInspectionId: string,
  input: PromptReviewInput & {
    reviewedBy: string | null;
  },
) {
  const result = await db.query(
    `
      update prompt_inspections
      set review_status = $2,
          reviewed_by = $3,
          review_note = $4,
          reviewed_at = now()
      where id = $1
      returning *
    `,
    [
      promptInspectionId,
      input.reviewStatus,
      input.reviewedBy,
      input.reviewNote,
    ],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapPromptInspection(result.rows[0]);
}

export async function batchUpdatePromptInspectionReview(
  db: Database,
  input: PromptBatchReviewInput & {
    reviewedBy: string | null;
  },
) {
  return withTransaction(db, async (client) => {
    const result = await client.query(
      `
        update prompt_inspections
        set review_status = $2,
            reviewed_by = $3,
            review_note = $4,
            reviewed_at = now()
        where id = any($1::uuid[])
          and workspace_id = $5
        returning *
      `,
      [
        input.inspectionIds,
        input.reviewStatus,
        input.reviewedBy,
        input.reviewNote,
        input.workspaceId,
      ],
    );

    return result.rows.map(mapPromptInspection);
  });
}

export async function listSavedViews(
  db: Database,
  filters: {
    workspaceId: string;
    surface: SavedView["surface"];
  },
) {
  const result = await db.query(
    `
      select *
      from saved_views
      where workspace_id = $1
        and surface = $2
      order by updated_at desc, id desc
    `,
    [filters.workspaceId, filters.surface],
  );

  return result.rows.map(mapSavedView);
}

export async function createSavedView(db: Database, input: CreateSavedViewInput) {
  const result = await db.query(
    `
      insert into saved_views (workspace_id, surface, name, filters, updated_at)
      values ($1, $2, $3, $4::jsonb, now())
      returning *
    `,
    [input.workspaceId, input.surface, input.name, JSON.stringify(input.filters ?? {})],
  );

  return mapSavedView(result.rows[0]);
}

export async function getSavedViewById(db: Database, savedViewId: string) {
  const result = await db.query(
    `
      select *
      from saved_views
      where id = $1
      limit 1
    `,
    [savedViewId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapSavedView(result.rows[0]);
}

export async function deleteSavedView(db: Database, savedViewId: string) {
  const result = await db.query(
    `
      delete from saved_views
      where id = $1
      returning *
    `,
    [savedViewId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapSavedView(result.rows[0]);
}

export async function updateSavedView(db: Database, savedViewId: string, input: UpdateSavedViewInput) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }

  if (input.filters !== undefined) {
    values.push(JSON.stringify(input.filters));
    assignments.push(`filters = $${values.length}::jsonb`);
  }

  if (!assignments.length) {
    return null;
  }

  assignments.push("updated_at = now()");
  values.push(savedViewId);

  const result = await db.query(
    `
      update saved_views
      set ${assignments.join(", ")}
      where id = $${values.length}
      returning *
    `,
    values,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapSavedView(result.rows[0]);
}

export async function markSavedViewOpened(db: Database, savedViewId: string) {
  const result = await db.query(
    `
      update saved_views
      set last_opened_at = now()
      where id = $1
      returning *
    `,
    [savedViewId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapSavedView(result.rows[0]);
}

function getNextScheduledReportRun(cadence: ScheduledReport["cadence"], now = new Date()) {
  const nextRunAt = new Date(now);

  if (cadence === "daily") {
    nextRunAt.setUTCDate(nextRunAt.getUTCDate() + 1);
    return nextRunAt;
  }

  if (cadence === "weekly") {
    nextRunAt.setUTCDate(nextRunAt.getUTCDate() + 7);
    return nextRunAt;
  }

  nextRunAt.setUTCMonth(nextRunAt.getUTCMonth() + 1);
  return nextRunAt;
}

function buildScheduledReportFileName(
  scheduledReport: Pick<ScheduledReport, "name" | "kind" | "format">,
  now = new Date(),
) {
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const fileStem = slugifyName(scheduledReport.name) || scheduledReport.kind;
  return `${fileStem}-${timestamp}.${scheduledReport.format}`;
}

function getRecordValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function getRecordStringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function getRecordStringArrayValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
}

function normalizeUsageEventBudgetMetadata(value: unknown) {
  const metadata = getRecordValue(value);
  const normalized: Record<string, unknown> = {
    ...metadata,
  };
  const orderedBudgetPolicyIds: string[] = [];
  const seenBudgetPolicyIds = new Set<string>();

  const pushBudgetPolicyId = (budgetPolicyId: string | null) => {
    if (!budgetPolicyId || seenBudgetPolicyIds.has(budgetPolicyId)) {
      return;
    }

    seenBudgetPolicyIds.add(budgetPolicyId);
    orderedBudgetPolicyIds.push(budgetPolicyId);
  };

  const explicitBudgetPolicyId = getRecordStringValue(metadata, "budgetPolicyId");
  const explicitBudgetPolicyIds = getRecordStringArrayValue(metadata, "budgetPolicyIds");
  const blockedBudgetPolicyIds = getRecordStringArrayValue(metadata, "blockedBudgetPolicyIds");
  const exhaustedBudgetPolicyIds = getRecordStringArrayValue(metadata, "exhaustedBudgetPolicyIds");

  pushBudgetPolicyId(explicitBudgetPolicyId);
  explicitBudgetPolicyIds.forEach((budgetPolicyId) => pushBudgetPolicyId(budgetPolicyId));
  blockedBudgetPolicyIds.forEach((budgetPolicyId) => pushBudgetPolicyId(budgetPolicyId));
  exhaustedBudgetPolicyIds.forEach((budgetPolicyId) => pushBudgetPolicyId(budgetPolicyId));

  if (orderedBudgetPolicyIds.length > 0) {
    normalized.budgetPolicyIds = orderedBudgetPolicyIds;
    normalized.budgetPolicyId = explicitBudgetPolicyId ?? orderedBudgetPolicyIds[0];
  }

  if (blockedBudgetPolicyIds.length > 0) {
    normalized.blockedBudgetPolicyIds = blockedBudgetPolicyIds;
  }

  if (exhaustedBudgetPolicyIds.length > 0) {
    normalized.exhaustedBudgetPolicyIds = exhaustedBudgetPolicyIds;
  }

  return normalized;
}

function getRecordNullableUuidFilter(record: Record<string, unknown>, key: string) {
  const value = getRecordStringValue(record, key);
  return value ?? null;
}

function normalizeFilterScalarValue(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }

  return value;
}

function normalizeStringArrayFilter(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalizedValues: string[] = [];
  const seenValues = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmedEntry = entry.trim();
    if (!trimmedEntry || seenValues.has(trimmedEntry)) {
      continue;
    }

    seenValues.add(trimmedEntry);
    normalizedValues.push(trimmedEntry);
  }

  return normalizedValues.length ? normalizedValues : null;
}

function normalizeReportDistribution(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    return ReportDistributionSchema.parse(value);
  } catch {
    return null;
  }
}

function normalizeReportWorkflow(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    return ReportWorkflowSchema.parse(value);
  } catch {
    return null;
  }
}

function normalizeReportGovernance(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    const governance = ReportGovernanceSchema.parse(value);
    if (governance.approvalMode === "required") {
      return {
        ...governance,
        approvalStatus: governance.approvalStatus === "approved" ? "approved" : "pending",
        approverLabel: governance.approvalStatus === "approved" ? governance.approverLabel : null,
        approvedAt: governance.approvalStatus === "approved" ? governance.approvedAt : null,
      } satisfies ReportGovernance;
    }

    return {
      ...governance,
      approvalStatus: "not_required",
      approverLabel: null,
      approvedAt: null,
    } satisfies ReportGovernance;
  } catch {
    return null;
  }
}

function normalizeEventTriggerConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    const config = EventDrivenTriggerSchema.parse(value);
    return config.enabled && config.events.length > 0 ? config : null;
  } catch {
    return null;
  }
}

export function normalizeExportFilters(filters: Record<string, unknown>) {
  const normalizedFilters: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(getRecordValue(filters))) {
    if (key === "distribution") {
      const distribution = normalizeReportDistribution(rawValue);
      if (distribution) {
        normalizedFilters.distribution = distribution;
      }
      continue;
    }

    if (key === "workflow") {
      const workflow = normalizeReportWorkflow(rawValue);
      if (workflow) {
        normalizedFilters.workflow = workflow;
      }
      continue;
    }

    if (key === "governance") {
      const governance = normalizeReportGovernance(rawValue);
      if (governance) {
        normalizedFilters.governance = governance;
      }
      continue;
    }

    if (key === "eventTrigger") {
      const eventTrigger = normalizeEventTriggerConfig(rawValue);
      if (eventTrigger) {
        normalizedFilters.eventTrigger = eventTrigger;
      }
      continue;
    }

    if (key === "projectIds") {
      const projectIds = normalizeStringArrayFilter(rawValue);
      if (projectIds) {
        normalizedFilters.projectIds = projectIds;
      }
      continue;
    }

    if (Array.isArray(rawValue)) {
      const normalizedValues = rawValue.flatMap((entry) => {
        const normalizedValue = normalizeFilterScalarValue(entry);
        return normalizedValue === undefined ? [] : [normalizedValue];
      });

      if (normalizedValues.length) {
        normalizedFilters[key] = normalizedValues;
      }
      continue;
    }

    const normalizedValue = normalizeFilterScalarValue(rawValue);
    if (normalizedValue !== undefined) {
      normalizedFilters[key] = normalizedValue;
    }
  }

  return normalizedFilters;
}

function buildScheduledReportExportFilters(
  scheduledReport: Pick<ScheduledReport, "id" | "name" | "cadence" | "filters">,
  extra: Record<string, unknown>,
) {
  const reportFilters = normalizeExportFilters((scheduledReport.filters ?? {}) as Record<string, unknown>);

  return normalizeExportFilters({
    ...reportFilters,
    scheduledReportId: scheduledReport.id,
    scheduledReportName: scheduledReport.name,
    scheduledReportCadence: scheduledReport.cadence,
    ...extra,
  });
}

function eventMatchesScheduledReportScope(
  scheduledReport: Pick<ScheduledReport, "filters">,
  scope: {
    projectId?: string | null;
    environmentId?: string | null;
    budgetPolicyId?: string | null;
  },
) {
  const filters = getRecordValue(scheduledReport.filters);
  const projectId = getRecordNullableUuidFilter(filters, "projectId");
  const environmentId = getRecordNullableUuidFilter(filters, "environmentId");
  const budgetPolicyId = getRecordStringValue(filters, "budgetPolicyId");

  if (projectId && projectId !== (scope.projectId ?? null)) {
    return false;
  }

  if (environmentId && environmentId !== (scope.environmentId ?? null)) {
    return false;
  }

  if (budgetPolicyId && budgetPolicyId !== (scope.budgetPolicyId ?? null)) {
    return false;
  }

  return true;
}

async function hasRecentEventDrivenExportJob(
  db: Database,
  args: {
    scheduledReportId: string;
    eventType: EventDrivenTriggerEvent;
    createdAfter: Date;
  },
) {
  const result = await db.query(
    `
      select 1
      from export_jobs
      where filters ->> 'scheduledReportId' = $1
        and filters ->> 'scheduledReportTriggerSource' = 'event'
        and filters ->> 'scheduledReportTriggerEvent' = $2
        and created_at >= $3
      limit 1
    `,
    [args.scheduledReportId, args.eventType, args.createdAfter.toISOString()],
  );

  return (result.rowCount ?? 0) > 0;
}

const scheduledReportManualTriggerDedupWindowMs = 15_000;

async function findReusableScheduledReportExportJob(
  db: Queryable,
  args: {
    scheduledReportId: string;
    createdAfter: Date;
  },
) {
  const result = await db.query(
    `
      select *
      from export_jobs
      where filters ->> 'scheduledReportId' = $1
        and (
          status in ('pending', 'running')
          or created_at >= $2
        )
      order by
        case when status in ('pending', 'running') then 0 else 1 end asc,
        created_at desc,
        id desc
      limit 1
    `,
    [args.scheduledReportId, args.createdAfter.toISOString()],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapExportJob(result.rows[0]);
}

export async function listScheduledReports(db: Database, workspaceId: string) {
  const result = await db.query(
    `
      select *
      from scheduled_reports
      where workspace_id = $1
      order by created_at desc, id desc
    `,
    [workspaceId],
  );

  return result.rows.map(mapScheduledReport);
}

export async function createScheduledReport(db: Database, input: CreateScheduledReportInput) {
  const now = new Date();
  const result = await db.query(
    `
      insert into scheduled_reports (workspace_id, kind, format, name, filters, cadence, next_run_at)
      values ($1, $2, $3, $4, $5::jsonb, $6, $7)
      returning *
    `,
    [
      input.workspaceId,
      input.kind,
      input.format,
      input.name,
      JSON.stringify(normalizeExportFilters((input.filters ?? {}) as Record<string, unknown>)),
      input.cadence,
      now.toISOString(),
    ],
  );

  return mapScheduledReport(result.rows[0]);
}

export async function getScheduledReportById(db: Database, scheduledReportId: string) {
  const result = await db.query(
    `
      select *
      from scheduled_reports
      where id = $1
      limit 1
    `,
    [scheduledReportId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapScheduledReport(result.rows[0]);
}

export async function deleteScheduledReport(db: Database, scheduledReportId: string) {
  const result = await db.query(
    `
      delete from scheduled_reports
      where id = $1
      returning *
    `,
    [scheduledReportId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapScheduledReport(result.rows[0]);
}

export async function updateScheduledReport(
  db: Database,
  scheduledReportId: string,
  input: UpdateScheduledReportInput,
) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.kind !== undefined) {
    values.push(input.kind);
    assignments.push(`kind = $${values.length}`);
  }
  if (input.format !== undefined) {
    values.push(input.format);
    assignments.push(`format = $${values.length}`);
  }
  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }
  if (input.filters !== undefined) {
    values.push(JSON.stringify(normalizeExportFilters(input.filters as Record<string, unknown>)));
    assignments.push(`filters = $${values.length}::jsonb`);
  }
  if (input.cadence !== undefined) {
    values.push(input.cadence);
    assignments.push(`cadence = $${values.length}`);
    values.push(getNextScheduledReportRun(input.cadence).toISOString());
    assignments.push(`next_run_at = $${values.length}`);
  }

  if (!assignments.length) {
    return null;
  }

  values.push(scheduledReportId);

  const result = await db.query(
    `
      update scheduled_reports
      set ${assignments.join(", ")},
          updated_at = now()
      where id = $${values.length}
      returning *
    `,
    values,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapScheduledReport(result.rows[0]);
}

export async function claimNextDueScheduledReport(db: Database, dueBefore: Date) {
  return withTransaction(db, async (transaction) => {
    const dueResult = await transaction.query(
      `
        select *
        from scheduled_reports
        where next_run_at <= $1
        order by next_run_at asc, created_at asc
        for update skip locked
        limit 1
      `,
      [dueBefore.toISOString()],
    );

    if (!dueResult.rowCount) {
      return null;
    }

    const scheduledReport = mapScheduledReport(dueResult.rows[0]);
    const nextRunAt = getNextScheduledReportRun(scheduledReport.cadence, dueBefore);
    const updateResult = await transaction.query(
      `
        update scheduled_reports
        set last_run_at = $2,
            next_run_at = $3,
            updated_at = now()
        where id = $1
        returning *
      `,
      [scheduledReport.id, dueBefore.toISOString(), nextRunAt.toISOString()],
    );

    const nextScheduledReport = mapScheduledReport(updateResult.rows[0]);
    const exportJobResult = await transaction.query(
      `
        insert into export_jobs (workspace_id, kind, format, status, file_name, filters)
        values ($1, $2, $3, 'pending', $4, $5::jsonb)
        returning *
      `,
      [
        nextScheduledReport.workspaceId,
        nextScheduledReport.kind,
        nextScheduledReport.format,
        buildScheduledReportFileName(nextScheduledReport, dueBefore),
        JSON.stringify(
          buildScheduledReportExportFilters(nextScheduledReport, {
            scheduledReportTriggerSource: "scheduled",
          }),
        ),
      ],
    );

    return {
      scheduledReport: nextScheduledReport,
      exportJob: mapExportJob(exportJobResult.rows[0]),
    };
  });
}

export async function triggerScheduledReport(db: Database, scheduledReportId: string, triggeredAt = new Date()) {
  return withTransaction(db, async (transaction) => {
    const reportResult = await transaction.query(
      `
        select *
        from scheduled_reports
        where id = $1
        for update
      `,
      [scheduledReportId],
    );

    if (!reportResult.rowCount) {
      return null;
    }

    const scheduledReport = mapScheduledReport(reportResult.rows[0]);
    const lastRunAtMs = scheduledReport.lastRunAt ? Date.parse(scheduledReport.lastRunAt) : Number.NaN;
    const shouldCheckRecentTrigger =
      Number.isFinite(lastRunAtMs) && triggeredAt.getTime() - lastRunAtMs <= scheduledReportManualTriggerDedupWindowMs;

    if (shouldCheckRecentTrigger) {
      const reusableExportJob = await findReusableScheduledReportExportJob(transaction, {
        scheduledReportId: scheduledReport.id,
        createdAfter: new Date(triggeredAt.getTime() - scheduledReportManualTriggerDedupWindowMs),
      });
      if (reusableExportJob) {
        return {
          scheduledReport,
          exportJob: reusableExportJob,
          advancedSchedule: false,
          deduplicated: true,
        };
      }
    }

    const shouldAdvanceSchedule = Date.parse(scheduledReport.nextRunAt) <= triggeredAt.getTime();
    const assignments = ["last_run_at = $2", "updated_at = now()"];
    const values: unknown[] = [scheduledReport.id, triggeredAt.toISOString()];

    if (shouldAdvanceSchedule) {
      values.push(getNextScheduledReportRun(scheduledReport.cadence, triggeredAt).toISOString());
      assignments.push(`next_run_at = $${values.length}`);
    }

    const updateResult = await transaction.query(
      `
        update scheduled_reports
        set ${assignments.join(", ")}
        where id = $1
        returning *
      `,
      values,
    );

    const nextScheduledReport = mapScheduledReport(updateResult.rows[0]);
    const exportJobResult = await transaction.query(
      `
        insert into export_jobs (workspace_id, kind, format, status, file_name, filters)
        values ($1, $2, $3, 'pending', $4, $5::jsonb)
        returning *
      `,
      [
        nextScheduledReport.workspaceId,
        nextScheduledReport.kind,
        nextScheduledReport.format,
        buildScheduledReportFileName(nextScheduledReport, triggeredAt),
        JSON.stringify(
          buildScheduledReportExportFilters(nextScheduledReport, {
            scheduledReportTriggerSource: "manual",
          }),
        ),
      ],
    );

    return {
      scheduledReport: nextScheduledReport,
      exportJob: mapExportJob(exportJobResult.rows[0]),
      advancedSchedule: shouldAdvanceSchedule,
      deduplicated: false,
    };
  });
}

export async function createExportJob(db: Database, input: CreateExportJobInput) {
  const result = await db.query(
    `
      insert into export_jobs (workspace_id, kind, format, status, file_name, filters)
      values ($1, $2, $3, 'pending', $4, $5::jsonb)
      returning *
    `,
    [
      input.workspaceId,
      input.kind,
      input.format,
      input.fileName ?? "export",
      JSON.stringify(normalizeExportFilters((input.filters ?? {}) as Record<string, unknown>)),
    ],
  );
  return mapExportJob(result.rows[0]);
}

export async function updateExportJob(db: Database, exportJobId: string, input: UpdateExportJobInput) {
  const exportJob = await getExportJobById(db, exportJobId);
  if (!exportJob) {
    return null;
  }

  const nextFilters = {
    ...getRecordValue(exportJob.filters),
  };

  if (input.filtersPatch?.workflow) {
    nextFilters.workflow = {
      ...getRecordValue(nextFilters.workflow),
      ...input.filtersPatch.workflow,
    };
  }

  if (input.filtersPatch?.governance) {
    nextFilters.governance = normalizeReportGovernance({
      ...getRecordValue(nextFilters.governance),
      ...input.filtersPatch.governance,
    });
  }

  const result = await db.query(
    `
      update export_jobs
      set filters = $2::jsonb
      where id = $1
      returning *
    `,
    [exportJobId, JSON.stringify(normalizeExportFilters(nextFilters))],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapExportJob(result.rows[0]);
}

export async function triggerEventDrivenScheduledReports(
  db: Database,
  args: {
    workspaceId: string;
    eventType: EventDrivenTriggerEvent;
    eventEntityId: string;
    scope?: {
      projectId?: string | null;
      environmentId?: string | null;
      budgetPolicyId?: string | null;
    };
    payload?: Record<string, unknown>;
    triggeredAt?: Date;
  },
) {
  const triggeredAt = args.triggeredAt ?? new Date();
  const scheduledReports = await listScheduledReports(db, args.workspaceId);
  const matches: ScheduledReport[] = [];

  for (const report of scheduledReports) {
    const filters = getRecordValue(report.filters);
    const eventTrigger = normalizeEventTriggerConfig(filters.eventTrigger);
    if (!eventTrigger || !eventTrigger.events.includes(args.eventType)) {
      continue;
    }

    if (
      eventTrigger.scope === "report-scope" &&
      !eventMatchesScheduledReportScope(report, {
        projectId: args.scope?.projectId ?? null,
        environmentId: args.scope?.environmentId ?? null,
        budgetPolicyId: args.scope?.budgetPolicyId ?? null,
      })
    ) {
      continue;
    }

    if (eventTrigger.cooldownMinutes > 0) {
      const cooldownStart = new Date(triggeredAt.getTime() - eventTrigger.cooldownMinutes * 60_000);
      if (
        await hasRecentEventDrivenExportJob(db, {
          scheduledReportId: report.id,
          eventType: args.eventType,
          createdAfter: cooldownStart,
        })
      ) {
        continue;
      }
    }

    matches.push(report);
  }

  const results: Array<{
    scheduledReport: ScheduledReport;
    exportJob: ExportJob;
  }> = [];

  for (const report of matches) {
    const triggeredReport = await withTransaction(db, async (transaction) => {
      const reportResult = await transaction.query(
        `
          select *
          from scheduled_reports
          where id = $1
          for update
        `,
        [report.id],
      );

      if (!reportResult.rowCount) {
        return null;
      }

      const lockedReport = mapScheduledReport(reportResult.rows[0]);
      const updateResult = await transaction.query(
        `
          update scheduled_reports
          set last_run_at = $2,
              updated_at = now()
          where id = $1
          returning *
        `,
        [lockedReport.id, triggeredAt.toISOString()],
      );

      const nextScheduledReport = mapScheduledReport(updateResult.rows[0]);
      const exportJobResult = await transaction.query(
        `
          insert into export_jobs (workspace_id, kind, format, status, file_name, filters)
          values ($1, $2, $3, 'pending', $4, $5::jsonb)
          returning *
        `,
        [
          nextScheduledReport.workspaceId,
          nextScheduledReport.kind,
          nextScheduledReport.format,
          buildScheduledReportFileName(nextScheduledReport, triggeredAt),
          JSON.stringify(
            buildScheduledReportExportFilters(nextScheduledReport, {
              scheduledReportTriggerSource: "event",
              scheduledReportTriggerEvent: args.eventType,
              scheduledReportTriggerEntityId: args.eventEntityId,
              scheduledReportTriggerPayload: args.payload ?? {},
            }),
          ),
        ],
      );

      return {
        scheduledReport: nextScheduledReport,
        exportJob: mapExportJob(exportJobResult.rows[0]),
      };
    });

    if (triggeredReport) {
      results.push(triggeredReport);
    }
  }

  return results;
}

export async function getExportJobById(db: Database, exportJobId: string) {
  const result = await db.query(
    `
      select *
      from export_jobs
      where id = $1
      limit 1
    `,
    [exportJobId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapExportJob(result.rows[0]);
}

export async function listExportJobs(db: Database, workspaceId: string) {
  const result = await db.query(
    "select * from export_jobs where workspace_id = $1 order by created_at desc",
    [workspaceId],
  );
  return result.rows.map(mapExportJob);
}

export async function retryExportJob(db: Database, exportJobId: string) {
  const result = await db.query(
    `
      update export_jobs
      set status = 'pending',
          object_key = null,
          row_count = null,
          error_message = null,
          started_at = null,
          completed_at = null
      where id = $1
        and status = 'failed'
      returning *
    `,
    [exportJobId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapExportJob(result.rows[0]);
}

export async function listReferencedExportObjectKeys(db: Database) {
  const result = await db.query<{ object_key: string }>(
    `
      select distinct object_key
      from export_jobs
      where object_key is not null
    `,
  );

  return result.rows
    .map((row) => row.object_key)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export async function recoverStaleExportJobs(db: Database, staleBefore: Date) {
  const result = await db.query(
    `
      update export_jobs
      set status = 'pending',
          started_at = null,
          completed_at = null
      where status = 'running'
        and coalesce(started_at, created_at) < $1
      returning *
    `,
    [staleBefore.toISOString()],
  );

  return result.rows.map(mapExportJob);
}

export async function claimNextPendingExportJob(db: Database) {
  const result = await db.query(
    `
      with next_job as (
        select id
        from export_jobs
        where status = 'pending'
        order by created_at asc
        for update skip locked
        limit 1
      )
      update export_jobs ej
      set status = 'running',
          error_message = null,
          completed_at = null,
          started_at = now(),
          attempt_count = coalesce(ej.attempt_count, 0) + 1
      from next_job
      where ej.id = next_job.id
      returning ej.*
    `,
  );

  if (!result.rowCount) {
    return null;
  }

  return mapExportJob(result.rows[0]);
}

export async function markExportJobRunning(db: Database, exportJobId: string) {
  const result = await db.query(
    `
      update export_jobs
      set status = 'running',
          error_message = null,
          completed_at = null,
          started_at = now(),
          attempt_count = coalesce(attempt_count, 0) + 1
      where id = $1
      returning *
    `,
    [exportJobId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapExportJob(result.rows[0]);
}

export async function completeExportJob(
  db: Database,
  exportJobId: string,
  input: {
    objectKey: string;
    rowCount: number;
  },
) {
  const result = await db.query(
    `
      update export_jobs
      set status = 'completed',
          object_key = $2,
          row_count = $3,
          error_message = null,
          completed_at = now()
      where id = $1
      returning *
    `,
    [exportJobId, input.objectKey, input.rowCount],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapExportJob(result.rows[0]);
}

export async function failExportJob(db: Database, exportJobId: string, errorMessage: string) {
  const result = await db.query(
    `
      update export_jobs
      set status = 'failed',
          error_message = $2,
          completed_at = now()
      where id = $1
      returning *
    `,
    [exportJobId, errorMessage],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapExportJob(result.rows[0]);
}

export async function getExportJobDownloadDescriptor(db: Database, exportJobId: string) {
  const result = await db.query(
    `
      select id, workspace_id, kind, file_name, object_key, status, filters
      from export_jobs
      where id = $1
      limit 1
    `,
    [exportJobId],
  );

  if (!result.rowCount) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: String(row.kind) as ExportJob["kind"],
    fileName: String(row.file_name),
    objectKey: row.object_key ? String(row.object_key) : null,
    status: String(row.status) as ExportJob["status"],
    filters: (row.filters as Record<string, unknown>) ?? {},
  };
}

export async function upsertAlert(
  db: Database,
  input: {
    workspaceId: string;
    severity: Alert["severity"];
    code: string;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
    dedupeKey?: string | null;
  },
) {
  const metadataRecord = input.metadata ?? {};
  const enrichedMetadataRecord = {
    ...metadataRecord,
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
  };
  const metadataJson = JSON.stringify(enrichedMetadataRecord);

  const row = await withTransaction(db, async (transaction) => {
    const budgetPolicyId = getRecordStringValue(enrichedMetadataRecord, "budgetPolicyId");
    const periodKey = getRecordStringValue(enrichedMetadataRecord, "periodKey");
    const legacySeedDedupeKey =
      input.code === "budget.soft-limit" && budgetPolicyId && periodKey
        ? `seed:${budgetPolicyId}:soft:${periodKey}`
        : input.code === "budget.hard-limit" && budgetPolicyId && periodKey
          ? `seed:${budgetPolicyId}:hard:${periodKey}`
          : null;

    if (input.dedupeKey && legacySeedDedupeKey) {
      const canonicalAlertResult = await transaction.query<{ id: string }>(
        `
          select id
          from alerts
          where dedupe_key = $1
          limit 1
        `,
        [input.dedupeKey],
      );

      if (canonicalAlertResult.rowCount) {
        await transaction.query(
          `
            update alerts
            set status = 'resolved',
                resolved_at = coalesce(resolved_at, now()),
                metadata =
                  coalesce(metadata, '{}'::jsonb)
                  || jsonb_build_object(
                    'supersededByDedupeKey',
                    $1::text,
                    'supersededAt',
                    timezone('utc', now())
                  )
            where dedupe_key = $2
          `,
          [input.dedupeKey, legacySeedDedupeKey],
        );
      } else {
        const canonicalizedLegacyResult = await transaction.query(
          `
            update alerts
            set dedupe_key = $1,
                severity = $2,
                code = $3,
                title = $4,
                body = $5,
                status = 'open',
                resolved_at = null,
                metadata = coalesce(alerts.metadata, '{}'::jsonb) || $6::jsonb
            where dedupe_key = $7
            returning *
          `,
          [
            input.dedupeKey,
            input.severity,
            input.code,
            input.title,
            input.body,
            metadataJson,
            legacySeedDedupeKey,
          ],
        );

        if (canonicalizedLegacyResult.rowCount) {
          return canonicalizedLegacyResult.rows[0];
        }
      }
    }

    const result = await transaction.query(
      `
        insert into alerts (workspace_id, severity, code, title, body, status, metadata, dedupe_key)
        values ($1, $2, $3, $4, $5, 'open', $6::jsonb, $7)
        on conflict (dedupe_key)
        do update set
          severity = excluded.severity,
          code = excluded.code,
          title = excluded.title,
          body = excluded.body,
          status = 'open',
          resolved_at = null,
          metadata = coalesce(alerts.metadata, '{}'::jsonb) || excluded.metadata
        returning *
      `,
      [
        input.workspaceId,
        input.severity,
        input.code,
        input.title,
        input.body,
        metadataJson,
        input.dedupeKey ?? null,
      ],
    );

    return result.rows[0];
  });

  return mapAlert(row);
}

export async function findAlertById(db: Database, alertId: string) {
  const result = await db.query(
    `
      select *
      from alerts
      where id = $1
      limit 1
    `,
    [alertId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapAlert(result.rows[0]);
}

export async function updateAlert(db: Database, alertId: string, input: UpdateAlertInput) {
  const metadataPatch =
    input.metadataPatch && Object.keys(input.metadataPatch).length > 0 ? JSON.stringify(input.metadataPatch) : null;
  const result = await db.query(
    `
      update alerts
      set status = coalesce($2, status),
          resolved_at =
            case
              when $2 is null then resolved_at
              when $2 = 'resolved' then coalesce(resolved_at, now())
              else null
            end,
          metadata =
            case
              when $3::jsonb is null then metadata
              else coalesce(metadata, '{}'::jsonb) || $3::jsonb
            end
      where id = $1
      returning *
    `,
    [alertId, input.status ?? null, metadataPatch],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapAlert(result.rows[0]);
}

function getAlertMetadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function getAlertMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function getAlertMetadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "number" ? value : null;
}

function shouldResolveBudgetAlert(alert: Alert, summary: BudgetPolicySummary, currentPeriodKey: string) {
  const metadata = getAlertMetadataRecord(alert.metadata);
  const periodKey = getAlertMetadataString(metadata, "periodKey");

  if (periodKey && periodKey !== currentPeriodKey) {
    return true;
  }

  if (alert.code === "budget.soft-limit") {
    return !summary.softLimitReached;
  }

  if (alert.code === "budget.hard-limit") {
    return !summary.hardLimitReached;
  }

  if (alert.code === "budget.preflight-block") {
    const estimatedCostUsd = getAlertMetadataNumber(metadata, "estimatedCostUsd");
    if (summary.hardLimitReached || summary.remainingUsd <= 0) {
      return true;
    }

    return estimatedCostUsd === null ? false : estimatedCostUsd <= summary.remainingUsd;
  }

  return false;
}

export async function syncBudgetPolicyAlerts(
  db: Database,
  args: {
    budgetPolicyId: string;
    summary: BudgetPolicySummary | null;
    now?: Date;
  },
) {
  const openAlerts = await listAlerts(db, {
    workspaceId: args.summary?.workspaceId,
    status: "open",
    budgetPolicyId: args.budgetPolicyId,
  });

  if (!openAlerts.length) {
    return 0;
  }

  const currentPeriodKey = getCurrentBudgetPeriod(args.now).key;
  let resolvedCount = 0;

  for (const alert of openAlerts) {
    const shouldResolve =
      !args.summary || args.summary.status !== "active"
        ? true
        : shouldResolveBudgetAlert(alert, args.summary, currentPeriodKey);

    if (!shouldResolve) {
      continue;
    }

    await updateAlert(db, alert.id, {
      status: "resolved",
    });
    resolvedCount += 1;
  }

  return resolvedCount;
}

export async function resolveBudgetPricingUnavailableAlerts(
  db: Database,
  args: {
    budgetPolicyId: string;
    provider: string;
    model: string;
  },
) {
  const result = await db.query(
    `
      update alerts
      set status = 'resolved',
          resolved_at = now()
      where status = 'open'
        and code = 'budget.pricing-unavailable'
        and metadata ->> 'budgetPolicyId' = $1
        and metadata ->> 'provider' = $2
        and lower(metadata ->> 'model') = lower($3)
      returning id
    `,
    [args.budgetPolicyId, args.provider, args.model],
  );

  return result.rowCount;
}

export async function listAlerts(db: Database, filters: AlertQuery) {
  const clauses = ["1 = 1"];
  const values: unknown[] = [];

  if (filters.workspaceId) {
    values.push(filters.workspaceId);
    clauses.push(`workspace_id = $${values.length}`);
  }

  if (filters.projectId) {
    values.push(filters.projectId);
    clauses.push(`(
      metadata ->> 'projectId' = $${values.length}
      or exists (
        select 1
        from environments
        where environments.id::text = alerts.metadata ->> 'environmentId'
          and environments.project_id::text = $${values.length}
      )
    )`);
  }

  if (filters.environmentId) {
    values.push(filters.environmentId);
    clauses.push(`metadata ->> 'environmentId' = $${values.length}`);
  }

  if (filters.status) {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }

  if (filters.severity) {
    values.push(filters.severity);
    clauses.push(`severity = $${values.length}`);
  }

  if (filters.code) {
    values.push(filters.code);
    clauses.push(`code = $${values.length}`);
  }

  if (filters.budgetPolicyId) {
    values.push(filters.budgetPolicyId);
    clauses.push(`metadata ->> 'budgetPolicyId' = $${values.length}`);
  }

  const result = await db.query(
    `
      select *
      from alerts
      where ${clauses.join(" and ")}
      order by
        case when status = 'open' then 0 else 1 end asc,
        created_at desc
    `,
    values,
  );

  return result.rows.map(mapAlert);
}
