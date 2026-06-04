import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CreateExportJobInputSchema,
  ReportDistributionSchema,
  ReportGovernanceSchema,
  type AuditLog,
  type CreateExportJobInput,
  type ExportJob,
  type UsageEvent,
  type UsageLedgerEntry,
  StableUsageLedgerExportSchemaVersion,
} from "@teamops/contracts";
import {
  appendAuditLog,
  claimNextDueScheduledReport,
  claimNextPendingExportJob,
  completeExportJob,
  failExportJob,
  getExportJobDownloadDescriptor,
  listAuditLogsForExport,
  listUsageLedgerEntriesForExport,
  listReferencedExportObjectKeys,
  listUsageEventsForExport,
  normalizeExportFilters,
  recoverStaleExportJobs,
  triggerEventDrivenScheduledReports,
  type Database,
} from "@teamops/database";
import ExcelJS from "exceljs";

const configuredExportsDir = process.env.EXPORT_JOBS_DIR?.trim();
const exportsDir = configuredExportsDir || path.join(os.tmpdir(), "teamops-control-api", "exports");
const defaultExportJobStaleAfterMs = 15 * 60 * 1000;
const defaultExportFileCleanupIntervalMs = 10 * 60 * 1000;

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const exportJobStaleAfterMs = parsePositiveInteger(
  process.env.EXPORT_JOB_STALE_AFTER_MS?.trim(),
  defaultExportJobStaleAfterMs,
);
const exportFileCleanupIntervalMs = parsePositiveInteger(
  process.env.EXPORT_JOB_CLEANUP_INTERVAL_MS?.trim(),
  defaultExportFileCleanupIntervalMs,
);
const webAdminBaseUrl = (process.env.WEB_ADMIN_BASE_URL?.trim() || "http://127.0.0.1:3001").replace(/\/$/, "");

type UsageExportRow = {
  created_at: string;
  workspace_id: string | null;
  project_id: string | null;
  environment_id: string | null;
  virtual_key_id: string | null;
  provider_connection_id: string | null;
  provider: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  status: string;
  request_id: string | null;
  provider_request_id: string | null;
  metadata_json: string;
};

type UsageLedgerExportRow = {
  schema_version: typeof StableUsageLedgerExportSchemaVersion;
  ledger_entry_id: string;
  usage_event_id: string;
  event_date: string;
  created_at: string;
  organization_id: string | null;
  workspace_id: string | null;
  project_id: string | null;
  environment_id: string | null;
  provider_connection_id: string | null;
  virtual_key_id: string | null;
  owner: string | null;
  provider: string | null;
  provider_model: string | null;
  canonical_model: string | null;
  model_family: string | null;
  price_snapshot_id: string | null;
  pricing_source: string;
  input_usd_per_million: number | null;
  output_usd_per_million: number | null;
  status: string;
  request_id: string | null;
  provider_request_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  metadata_json: string;
};

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

function getExportJobScope(filters: Record<string, unknown>) {
  return {
    projectId: getRecordStringValue(filters, "projectId"),
    environmentId: getRecordStringValue(filters, "environmentId"),
    budgetPolicyId: getRecordStringValue(filters, "budgetPolicyId"),
  };
}

function getExportDistribution(filters: Record<string, unknown>) {
  try {
    const distribution = ReportDistributionSchema.parse(getRecordValue(filters.distribution));
    return distribution.enabled && distribution.targets.length > 0 ? distribution : null;
  } catch {
    return null;
  }
}

function getExportGovernance(filters: Record<string, unknown>) {
  try {
    return ReportGovernanceSchema.parse(getRecordValue(filters.governance));
  } catch {
    return ReportGovernanceSchema.parse({});
  }
}

function buildExportDeliveryPayload(job: ExportJob) {
  const filters = getRecordValue(job.filters);
  const governance = getExportGovernance(filters);
  const distribution = getExportDistribution(filters);
  const downloadReady = governance.approvalMode !== "required" || governance.approvalStatus === "approved";
  const downloadUrl =
    distribution?.includeDownloadLink && downloadReady ? `${webAdminBaseUrl}/exports/${job.id}/download` : null;
  const summaryText = downloadUrl
    ? `Report ${job.fileName} is ready (${job.kind}, ${job.format}, ${job.rowCount ?? 0} rows). Download: ${downloadUrl}`
    : `Report ${job.fileName} is ready (${job.kind}, ${job.format}, ${job.rowCount ?? 0} rows). Approval is still required before download is shared.`;

  return {
    downloadUrl,
    summaryText,
    payload: {
      exportJobId: job.id,
      fileName: job.fileName,
      kind: job.kind,
      format: job.format,
      rowCount: job.rowCount,
      completedAt: job.completedAt,
      attemptCount: job.attemptCount,
      approvalMode: governance.approvalMode,
      approvalStatus: governance.approvalStatus,
      watermarkLabel: governance.watermarkLabel,
      retentionDays: governance.retentionDays,
      signedSnapshot: governance.signedSnapshot,
      downloadUrl,
    },
  };
}

async function dispatchExportDeliveries(db: Database, job: ExportJob) {
  const filters = getRecordValue(job.filters);
  const distribution = getExportDistribution(filters);
  if (!distribution) {
    return;
  }

  const delivery = buildExportDeliveryPayload(job);

  for (const target of distribution.targets) {
    if (target.channel === "email") {
      await appendAuditLog(db, {
        workspaceId: job.workspaceId,
        actorType: "system",
        actorId: "export-worker",
        action: "export.delivery_skipped",
        subjectType: "export-job",
        subjectId: job.id,
        payload: {
          channel: target.channel,
          destination: target.destination,
          label: target.label ?? null,
          reason: "email_transport_not_configured",
        },
      });
      continue;
    }

    try {
      const body =
        target.channel === "slack"
          ? {
              text: delivery.summaryText,
            }
          : target.channel === "feishu"
            ? {
                msg_type: "text",
                content: {
                  text: delivery.summaryText,
                },
              }
            : delivery.payload;
      const response = await fetch(target.destination, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Delivery endpoint responded with ${response.status}`);
      }

      await appendAuditLog(db, {
        workspaceId: job.workspaceId,
        actorType: "system",
        actorId: "export-worker",
        action: "export.delivery_dispatched",
        subjectType: "export-job",
        subjectId: job.id,
        payload: {
          channel: target.channel,
          destination: target.destination,
          label: target.label ?? null,
          downloadUrlShared: Boolean(delivery.downloadUrl),
        },
      });
    } catch (error) {
      await appendAuditLog(db, {
        workspaceId: job.workspaceId,
        actorType: "system",
        actorId: "export-worker",
        action: "export.delivery_failed",
        subjectType: "export-job",
        subjectId: job.id,
        payload: {
          channel: target.channel,
          destination: target.destination,
          label: target.label ?? null,
          errorMessage: error instanceof Error ? error.message : "Unable to dispatch export delivery",
        },
      });
    }
  }
}

async function triggerFailedExportFollowupReports(db: Database, job: ExportJob) {
  const filters = getRecordValue(job.filters);
  const triggeredReports = await triggerEventDrivenScheduledReports(db, {
    workspaceId: job.workspaceId,
    eventType: "export-job-failed",
    eventEntityId: job.id,
    scope: getExportJobScope(filters),
    payload: {
      failedExportJobId: job.id,
      fileName: job.fileName,
      kind: job.kind,
      errorMessage: job.errorMessage,
    },
  });

  await Promise.all(
    triggeredReports.map(({ scheduledReport, exportJob }) =>
      appendAuditLog(db, {
        workspaceId: scheduledReport.workspaceId,
        actorType: "system",
        actorId: "export-worker",
        action: "scheduled_report.triggered",
        subjectType: "scheduled-report",
        subjectId: scheduledReport.id,
        payload: {
          cadence: scheduledReport.cadence,
          kind: scheduledReport.kind,
          format: scheduledReport.format,
          name: scheduledReport.name,
          exportJobId: exportJob.id,
          nextRunAt: scheduledReport.nextRunAt,
          lastRunAt: scheduledReport.lastRunAt,
          triggerSource: "event",
          triggerEvent: "export-job-failed",
          triggerEntityId: job.id,
        },
      }),
    ),
  );
}

type AuditExportRow = {
  created_at: string;
  workspace_id: string | null;
  project_id: string | null;
  environment_id: string | null;
  actor_type: string;
  actor_id: string;
  action: string;
  subject_type: string;
  subject_id: string;
  payload_json: string;
};

const usageExportHeaders: Array<keyof UsageExportRow> = [
  "created_at",
  "workspace_id",
  "project_id",
  "environment_id",
  "virtual_key_id",
  "provider_connection_id",
  "provider",
  "model",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "cost_usd",
  "latency_ms",
  "status",
  "request_id",
  "provider_request_id",
  "metadata_json",
];

const usageLedgerExportHeaders: Array<keyof UsageLedgerExportRow> = [
  "schema_version",
  "ledger_entry_id",
  "usage_event_id",
  "event_date",
  "created_at",
  "organization_id",
  "workspace_id",
  "project_id",
  "environment_id",
  "provider_connection_id",
  "virtual_key_id",
  "owner",
  "provider",
  "provider_model",
  "canonical_model",
  "model_family",
  "price_snapshot_id",
  "pricing_source",
  "input_usd_per_million",
  "output_usd_per_million",
  "status",
  "request_id",
  "provider_request_id",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "cost_usd",
  "metadata_json",
];

const auditExportHeaders: Array<keyof AuditExportRow> = [
  "created_at",
  "workspace_id",
  "project_id",
  "environment_id",
  "actor_type",
  "actor_id",
  "action",
  "subject_type",
  "subject_id",
  "payload_json",
];

const spreadsheetFormulaPrefixPattern = /^[\t\r\n ]*[=+\-@]/;

function sanitizeFileStem(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return normalized || "export";
}

function buildDefaultFileName(kind: ExportJob["kind"], format: ExportJob["format"]) {
  const now = new Date();
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");

  return `${kind}-${timestamp}.${format}`;
}

export function normalizeCreateExportJobInput(input: CreateExportJobInput): CreateExportJobInput {
  const fileName = input.fileName
    ? `${sanitizeFileStem(input.fileName)}.${input.format}`
    : buildDefaultFileName(input.kind, input.format);

  if (input.kind === "usage-events") {
    return {
      ...input,
      fileName,
      filters: {
        ...input.filters,
        workspaceId: input.workspaceId,
      },
    };
  }

  return {
    ...input,
    fileName,
    filters: {
      ...input.filters,
      workspaceId: input.workspaceId,
    },
  };
}

function getUsageExportRows(events: UsageEvent[]): UsageExportRow[] {
  return events.map((event) => ({
    created_at: event.createdAt,
    workspace_id: event.workspaceId,
    project_id: event.projectId,
    environment_id: event.environmentId,
    virtual_key_id: event.virtualKeyId,
    provider_connection_id: event.providerConnectionId,
    provider: event.provider,
    model: event.model,
    prompt_tokens: event.promptTokens,
    completion_tokens: event.completionTokens,
    total_tokens: event.totalTokens,
    cost_usd: event.costUsd,
    latency_ms: event.latencyMs,
    status: event.status,
    request_id: event.requestId,
    provider_request_id: event.providerRequestId,
    metadata_json: JSON.stringify(event.metadata),
  }));
}

function getUsageLedgerExportRows(entries: UsageLedgerEntry[]): UsageLedgerExportRow[] {
  return entries.map((entry) => ({
    schema_version: StableUsageLedgerExportSchemaVersion,
    ledger_entry_id: entry.id,
    usage_event_id: entry.usageEventId,
    event_date: entry.eventDate,
    created_at: entry.createdAt,
    organization_id: entry.organizationId,
    workspace_id: entry.workspaceId,
    project_id: entry.projectId,
    environment_id: entry.environmentId,
    provider_connection_id: entry.providerConnectionId,
    virtual_key_id: entry.virtualKeyId,
    owner: entry.owner,
    provider: entry.provider,
    provider_model: entry.providerModel,
    canonical_model: entry.canonicalModel,
    model_family: entry.modelFamily,
    price_snapshot_id: entry.priceSnapshotId,
    pricing_source: entry.pricingSource,
    input_usd_per_million: entry.inputUsdPerMillion,
    output_usd_per_million: entry.outputUsdPerMillion,
    status: entry.status,
    request_id: entry.requestId,
    provider_request_id: entry.providerRequestId,
    prompt_tokens: entry.promptTokens,
    completion_tokens: entry.completionTokens,
    total_tokens: entry.totalTokens,
    cost_usd: entry.costUsd,
    metadata_json: JSON.stringify(entry.metadata),
  }));
}

function getAuditExportRows(logs: AuditLog[]): AuditExportRow[] {
  return logs.map((log) => ({
    created_at: log.createdAt,
    workspace_id: log.workspaceId,
    project_id: log.projectId,
    environment_id: log.environmentId,
    actor_type: log.actorType,
    actor_id: log.actorId,
    action: log.action,
    subject_type: log.subjectType,
    subject_id: log.subjectId,
    payload_json: JSON.stringify(log.payload),
  }));
}

function getColumnWidth(header: string) {
  if (header.endsWith("_json")) {
    return 42;
  }

  if (header.endsWith("_id") || header === "request_id" || header === "provider_request_id") {
    return 24;
  }

  if (header === "model") {
    return 28;
  }

  return 20;
}

function sanitizeSpreadsheetCellValue(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  return spreadsheetFormulaPrefixPattern.test(value) ? `'${value}` : value;
}

function sanitizeSpreadsheetRow<T extends Record<string, unknown>>(row: T, headers: Array<keyof T>) {
  const sanitizedRow: Record<string, unknown> = {};

  for (const header of headers) {
    sanitizedRow[String(header)] = sanitizeSpreadsheetCellValue(row[header]);
  }

  return sanitizedRow;
}

function createWorkbook<T extends Record<string, unknown>>(rows: T[], headers: Array<keyof T>, sheetName: string) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.columns = headers.map((header) => ({
    header: String(header),
    key: String(header),
    width: getColumnWidth(String(header)),
  }));

  for (const row of rows) {
    worksheet.addRow(sanitizeSpreadsheetRow(row, headers));
  }

  return workbook;
}

async function ensureExportsDir() {
  await mkdir(exportsDir, {
    recursive: true,
  });

  return exportsDir;
}

async function writeFileAtomically(filePath: string, writer: (tempFilePath: string) => Promise<void>) {
  const tempFilePath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;

  try {
    await writer(tempFilePath);
    await rename(tempFilePath, filePath);
  } catch (error) {
    await rm(tempFilePath, {
      force: true,
    });
    throw error;
  }
}

function isManagedExportFile(fileName: string) {
  return /^[0-9a-f-]+\.(csv|xlsx)$/i.test(fileName);
}

async function pruneOrphanedExportFiles(
  db: Database,
  logger: ExportWorkerLogger,
): Promise<{ removedCount: number; keptCount: number }> {
  await ensureExportsDir();

  const [fileNames, referencedObjectKeys] = await Promise.all([readdir(exportsDir), listReferencedExportObjectKeys(db)]);
  const referencedFileNames = new Set(referencedObjectKeys.map((objectKey) => path.basename(objectKey)));

  let removedCount = 0;
  let keptCount = 0;

  for (const fileName of fileNames) {
    if (!isManagedExportFile(fileName)) {
      continue;
    }

    if (referencedFileNames.has(fileName)) {
      keptCount += 1;
      continue;
    }

    await rm(path.join(exportsDir, fileName), {
      force: true,
    });
    removedCount += 1;
  }

  if (removedCount) {
    logger.info("Pruned orphaned export files", {
      removedCount,
      keptCount,
    });
  }

  return {
    removedCount,
    keptCount,
  };
}

async function writeUsageExportFile(job: ExportJob, rows: UsageExportRow[]) {
  await ensureExportsDir();
  const objectKey = `${job.id}.${job.format}`;
  const filePath = path.join(exportsDir, objectKey);
  const workbook = createWorkbook(rows, usageExportHeaders, "usage_events");

  if (job.format === "csv") {
    await writeFileAtomically(filePath, async (tempFilePath) => {
      const csvBuffer = await workbook.csv.writeBuffer({
        sheetName: "usage_events",
      });
      await writeFile(tempFilePath, Buffer.concat([Buffer.from("\uFEFF", "utf8"), Buffer.from(csvBuffer)]));
    });
    return objectKey;
  }

  await writeFileAtomically(filePath, async (tempFilePath) => {
    await workbook.xlsx.writeFile(tempFilePath);
  });
  return objectKey;
}

async function writeAuditExportFile(job: ExportJob, rows: AuditExportRow[]) {
  await ensureExportsDir();
  const objectKey = `${job.id}.${job.format}`;
  const filePath = path.join(exportsDir, objectKey);
  const workbook = createWorkbook(rows, auditExportHeaders, "audit_logs");

  if (job.format === "csv") {
    await writeFileAtomically(filePath, async (tempFilePath) => {
      const csvBuffer = await workbook.csv.writeBuffer({
        sheetName: "audit_logs",
      });
      await writeFile(tempFilePath, Buffer.concat([Buffer.from("\uFEFF", "utf8"), Buffer.from(csvBuffer)]));
    });
    return objectKey;
  }

  await writeFileAtomically(filePath, async (tempFilePath) => {
    await workbook.xlsx.writeFile(tempFilePath);
  });
  return objectKey;
}

async function writeUsageLedgerExportFile(job: ExportJob, rows: UsageLedgerExportRow[]) {
  await ensureExportsDir();
  const objectKey = `${job.id}.${job.format}`;
  const filePath = path.join(exportsDir, objectKey);
  const workbook = createWorkbook(rows, usageLedgerExportHeaders, "usage_ledger");

  if (job.format === "csv") {
    await writeFileAtomically(filePath, async (tempFilePath) => {
      const csvBuffer = await workbook.csv.writeBuffer({
        sheetName: "usage_ledger",
      });
      await writeFile(tempFilePath, Buffer.concat([Buffer.from("\uFEFF", "utf8"), Buffer.from(csvBuffer)]));
    });
    return objectKey;
  }

  await writeFileAtomically(filePath, async (tempFilePath) => {
    await workbook.xlsx.writeFile(tempFilePath);
  });
  return objectKey;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown export error";
}

function formatSchemaIssues(errorMessage: string, issues: Array<{ path: (string | number)[]; message: string }>) {
  const formattedIssues = issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "input";
      return `${path}: ${issue.message}`;
    })
    .join("; ");

  return formattedIssues ? `${errorMessage}: ${formattedIssues}` : errorMessage;
}

function getExportJobInput(job: ExportJob): CreateExportJobInput {
  const parsedInput = CreateExportJobInputSchema.safeParse({
    workspaceId: job.workspaceId,
    kind: job.kind,
    format: job.format,
    fileName: job.fileName,
    filters: normalizeExportFilters(getRecordValue(job.filters)),
  });

  if (!parsedInput.success) {
    throw new Error(formatSchemaIssues("Invalid export job filters", parsedInput.error.issues));
  }

  return parsedInput.data;
}

function getExportJobDurationMs(job: Pick<ExportJob, "startedAt">, completedAt: string | null) {
  if (!job.startedAt || !completedAt) {
    return null;
  }

  const durationMs = Date.parse(completedAt) - Date.parse(job.startedAt);
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
}

function buildExportAuditPayload(
  job: Pick<ExportJob, "kind" | "format" | "fileName" | "attemptCount" | "createdAt" | "startedAt">,
  extra: Record<string, unknown> = {},
) {
  return {
    kind: job.kind,
    format: job.format,
    fileName: job.fileName,
    attemptCount: job.attemptCount,
    queuedAt: job.createdAt,
    startedAt: job.startedAt,
    ...extra,
  };
}

export async function processExportJob(db: Database, job: ExportJob) {
  try {
    const input = getExportJobInput(job);

    if (input.kind === "usage-events") {
      const events = await listUsageEventsForExport(db, {
        ...input.filters,
        workspaceId: input.workspaceId,
      });
      const objectKey = await writeUsageExportFile(job, getUsageExportRows(events));
      const completedJob = await completeExportJob(db, job.id, {
        objectKey,
        rowCount: events.length,
      });

      if (completedJob) {
        await appendAuditLog(db, {
          workspaceId: completedJob.workspaceId,
          actorType: "system",
          actorId: "export-worker",
          action: "export.completed",
          subjectType: "export-job",
          subjectId: completedJob.id,
          payload: buildExportAuditPayload(completedJob, {
            rowCount: completedJob.rowCount,
            completedAt: completedJob.completedAt,
            durationMs: getExportJobDurationMs(completedJob, completedJob.completedAt),
          }),
        });

        try {
          await dispatchExportDeliveries(db, completedJob);
        } catch (error) {
          console.error("Failed to dispatch export deliveries", {
            exportJobId: completedJob.id,
            error: error instanceof Error ? error.message : "unknown error",
          });
        }
      }

      return completedJob;
    }

    if (input.kind === "usage-ledger") {
      const entries = await listUsageLedgerEntriesForExport(db, {
        ...input.filters,
        workspaceId: input.workspaceId,
      });
      const objectKey = await writeUsageLedgerExportFile(job, getUsageLedgerExportRows(entries));
      const completedJob = await completeExportJob(db, job.id, {
        objectKey,
        rowCount: entries.length,
      });

      if (completedJob) {
        await appendAuditLog(db, {
          workspaceId: completedJob.workspaceId,
          actorType: "system",
          actorId: "export-worker",
          action: "export.completed",
          subjectType: "export-job",
          subjectId: completedJob.id,
          payload: buildExportAuditPayload(completedJob, {
            rowCount: completedJob.rowCount,
            completedAt: completedJob.completedAt,
            durationMs: getExportJobDurationMs(completedJob, completedJob.completedAt),
            schemaVersion: StableUsageLedgerExportSchemaVersion,
          }),
        });

        try {
          await dispatchExportDeliveries(db, completedJob);
        } catch (error) {
          console.error("Failed to dispatch export deliveries", {
            exportJobId: completedJob.id,
            error: error instanceof Error ? error.message : "unknown error",
          });
        }
      }

      return completedJob;
    }

    const logs = await listAuditLogsForExport(db, {
      ...input.filters,
      workspaceId: input.workspaceId,
    });
    const objectKey = await writeAuditExportFile(job, getAuditExportRows(logs));
    const completedJob = await completeExportJob(db, job.id, {
      objectKey,
      rowCount: logs.length,
    });

    if (completedJob) {
      await appendAuditLog(db, {
        workspaceId: completedJob.workspaceId,
        actorType: "system",
        actorId: "export-worker",
        action: "export.completed",
        subjectType: "export-job",
        subjectId: completedJob.id,
        payload: buildExportAuditPayload(completedJob, {
          rowCount: completedJob.rowCount,
          completedAt: completedJob.completedAt,
          durationMs: getExportJobDurationMs(completedJob, completedJob.completedAt),
        }),
      });

      try {
        await dispatchExportDeliveries(db, completedJob);
      } catch (error) {
        console.error("Failed to dispatch export deliveries", {
          exportJobId: completedJob.id,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return completedJob;
  } catch (error) {
    console.error("Export job failed", {
      exportJobId: job.id,
      workspaceId: job.workspaceId,
      kind: job.kind,
      format: job.format,
      scheduledReportId: getRecordStringValue(getRecordValue(job.filters), "scheduledReportId"),
      filters: normalizeExportFilters(getRecordValue(job.filters)),
      error: getErrorMessage(error),
    });

    const failedJob = await failExportJob(db, job.id, getErrorMessage(error));

    if (failedJob) {
      await appendAuditLog(db, {
        workspaceId: failedJob.workspaceId,
        actorType: "system",
        actorId: "export-worker",
        action: "export.failed",
        subjectType: "export-job",
        subjectId: failedJob.id,
        payload: buildExportAuditPayload(failedJob, {
          errorMessage: failedJob.errorMessage,
          completedAt: failedJob.completedAt,
          durationMs: getExportJobDurationMs(failedJob, failedJob.completedAt),
        }),
      });

      try {
        await triggerFailedExportFollowupReports(db, failedJob);
      } catch (error) {
        console.error("Failed to trigger follow-up reports for failed export", {
          exportJobId: failedJob.id,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return failedJob;
  }
}

export async function getExportDownloadFile(db: Database, exportJobId: string) {
  const descriptor = await getExportJobDownloadDescriptor(db, exportJobId);

  if (!descriptor || descriptor.status !== "completed" || !descriptor.objectKey) {
    return null;
  }

  try {
    await ensureExportsDir();
    const filePath = path.join(exportsDir, path.basename(descriptor.objectKey));
    await stat(filePath);

    return {
      workspaceId: descriptor.workspaceId,
      fileName: descriptor.fileName,
      stream: createReadStream(filePath),
    };
  } catch {
    return null;
  }
}

type ExportWorkerLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

const defaultLogger: ExportWorkerLogger = {
  info: (message, context) => {
    console.info(message, context ?? {});
  },
  error: (message, context) => {
    console.error(message, context ?? {});
  },
};

export function startExportWorker(
  db: Database,
  options: {
    idleDelayMs?: number;
    errorDelayMs?: number;
    logger?: ExportWorkerLogger;
  } = {},
) {
  const idleDelayMs = options.idleDelayMs ?? 1500;
  const errorDelayMs = options.errorDelayMs ?? 5000;
  const logger = options.logger ?? defaultLogger;

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastCleanupAt = 0;

  const schedule = (delayMs: number) => {
    if (stopped) {
      return;
    }

    timer = setTimeout(() => {
      void runLoop();
    }, delayMs);
  };

  const runLoop = async () => {
    if (stopped || running) {
      return;
    }

    running = true;

    try {
      let processedAnyJob = false;
      if (Date.now() - lastCleanupAt >= exportFileCleanupIntervalMs) {
        await pruneOrphanedExportFiles(db, logger);
        lastCleanupAt = Date.now();
      }

      const recoveredJobs = await recoverStaleExportJobs(db, new Date(Date.now() - exportJobStaleAfterMs));

      if (recoveredJobs.length) {
        logger.info("Recovered stale export jobs", {
          count: recoveredJobs.length,
          exportJobIds: recoveredJobs.map((job) => job.id),
        });

        for (const job of recoveredJobs) {
          await appendAuditLog(db, {
            workspaceId: job.workspaceId,
            actorType: "system",
            actorId: "export-worker",
            action: "export.requeued",
            subjectType: "export-job",
            subjectId: job.id,
            payload: {
              kind: job.kind,
              format: job.format,
              fileName: job.fileName,
              reason: "stale_running_job_recovered",
            },
          });
        }
      }

      while (!stopped) {
        const dueScheduledReport = await claimNextDueScheduledReport(db, new Date());
        if (!dueScheduledReport) {
          break;
        }

        const { scheduledReport, exportJob } = dueScheduledReport;

        processedAnyJob = true;

        await appendAuditLog(db, {
          workspaceId: scheduledReport.workspaceId,
          actorType: "system",
          actorId: "export-worker",
          action: "scheduled_report.triggered",
          subjectType: "scheduled-report",
          subjectId: scheduledReport.id,
          payload: {
            cadence: scheduledReport.cadence,
            kind: scheduledReport.kind,
            exportJobId: exportJob.id,
            name: scheduledReport.name,
            nextRunAt: scheduledReport.nextRunAt,
            lastRunAt: scheduledReport.lastRunAt,
          },
        });
      }

      while (!stopped) {
        const job = await claimNextPendingExportJob(db);
        if (!job) {
          break;
        }

        processedAnyJob = true;
        logger.info("Processing export job", {
          exportJobId: job.id,
          workspaceId: job.workspaceId,
          kind: job.kind,
          format: job.format,
        });

        await appendAuditLog(db, {
          workspaceId: job.workspaceId,
          actorType: "system",
          actorId: "export-worker",
          action: "export.started",
          subjectType: "export-job",
          subjectId: job.id,
          payload: buildExportAuditPayload(job),
        });

        try {
          const processedJob = await processExportJob(db, job);
          logger.info("Export job finished", {
            exportJobId: job.id,
            status: processedJob?.status ?? "unknown",
          });
        } catch (error) {
          logger.error("Export job crashed after being claimed", {
            exportJobId: job.id,
            workspaceId: job.workspaceId,
            kind: job.kind,
            format: job.format,
            message: getErrorMessage(error),
          });
        }
      }

      schedule(processedAnyJob ? 0 : idleDelayMs);
    } catch (error) {
      logger.error("Export worker loop failed", {
        message: getErrorMessage(error),
      });
      schedule(errorDelayMs);
    } finally {
      running = false;
    }
  };

  schedule(0);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
