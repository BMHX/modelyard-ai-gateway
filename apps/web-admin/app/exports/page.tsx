import type {
  CommonReportTemplate,
  Environment,
  EventDrivenTrigger,
  ExportJob,
  Project,
  ReportDistribution,
  ReportGovernance,
  ReportWorkflow,
  ScheduledReport,
} from "@teamops/contracts";
import { CommonReportTemplates } from "@teamops/contracts";

import { EmptyState } from "@/components/shared/empty-state";
import { AppShell } from "../components/app-shell";
import { ControlApiStatusCard } from "../components/control-api-status-card";
import { ReportTemplateGrid, type RecurringReportCard, type ReportTemplateCard } from "../components/report-template-grid";
import {
  diagnoseControlApiIssue,
  getExportDownloadUrl,
  listExportJobs,
  listProjects,
  listWorkspaceEnvironments,
  loadScheduledReportsState,
  loadWorkspaceSelectionWithOptimisticData,
  pickFirstControlApiIssue,
} from "../lib/control-api";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import { getCurrentLocale, getT } from "../lib/i18n-server";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import { getUserErrorMessage } from "../lib/user-facing-error";

import {
  createAuditExportAction,
  createUsageLedgerExportAction,
  createScheduledReportAction,
  createUsageExportAction,
  deleteScheduledReportAction,
  retryExportJobAction,
  retryVisibleFailedExportJobsAction,
  saveScheduledReportAction,
  triggerScheduledReportAction,
  updateExportJobFollowupAction,
} from "./actions";
import { ExportJobsAutoRefresh } from "./exports-auto-refresh";

export const dynamic = "force-dynamic";

const providerOptions = ["anthropic", "openai", "openai-compatible", "bedrock", "vertex"] as const;
const statusOptions = ["success", "error", "blocked"] as const;
const surfaceOptions = ["metadata", "streamed", "interrupted"] as const;
const sortOptions = ["newest", "oldest", "latency_desc", "cost_desc", "tokens_desc"] as const;
const projectStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Project["status"], number>;
const environmentStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Environment["status"], number>;

type RawSearchParams = Record<string, string | string[] | undefined>;
type ExportsPageProps = {
  searchParams?: Promise<RawSearchParams>;
};
type OutcomeFilter = (typeof statusOptions)[number] | "attention";
type SurfaceFilter = (typeof surfaceOptions)[number];
type SortFilter = (typeof sortOptions)[number];
type ExportJobKindFilter = ExportJob["kind"] | "";
type ExportJobStatusFilter = ExportJob["status"] | "";
type ReportCadence = "daily" | "weekly" | "monthly";
type ReportingSurfaceKind = "usage-events" | "usage-ledger" | "audit-logs";
type TranslationFn = (key: string, values?: Record<string, string | number | boolean | Date | null | undefined>) => string;

function getSingleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getOptionalFilter(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

function createFormatters(locale: AppLocale, t: TranslationFn) {
  const intlLocale = getIntlLocale(locale);

  const formatDateTime = (value: string | null) => {
    if (!value) {
      return t("shared.pending");
    }

    return new Intl.DateTimeFormat(intlLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  };

  return {
    compareLabels(left: string, right: string) {
      return left.localeCompare(right, intlLocale);
    },
    formatDateTime,
    formatInteger(value: number) {
      return new Intl.NumberFormat(intlLocale).format(value);
    },
    formatSlaLabel(value: string | null) {
      if (!value) {
        return null;
      }

      const dueAt = Date.parse(value);
      if (!Number.isFinite(dueAt)) {
        return null;
      }

      if (dueAt <= Date.now()) {
        return t("followup.slaBreached", { value: formatDateTime(value) });
      }

      return t("followup.slaDue", { value: formatDateTime(value) });
    },
  };
}

function formatQueueSummary(locale: AppLocale, visible: string | number, total: string | number) {
  return locale === "zh"
    ? `显示 ${visible} 个，共 ${total} 个任务`
    : `Showing ${visible} of ${total} jobs`;
}

function formatDateTimeLocalInput(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getExportJobTagClass(job: ExportJob) {
  if (job.status === "failed") {
    return "tag tag--critical";
  }

  if (job.status === "completed") {
    return "tag";
  }

  return "tag tag--warning";
}

function formatAttemptLabel(attemptCount: number, t: TranslationFn) {
  return t("queue.attempts", { count: attemptCount });
}

function formatExportFileDisplay(fileName: string) {
  return fileName;
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }

  if (durationMs < 1_000) {
    return `${durationMs} ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 0 : 1)} s`;
  }

  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function getExportJobActivitySummary(
  job: Pick<ExportJob, "status" | "createdAt" | "startedAt" | "completedAt">,
  formatDateTime: (value: string | null) => string,
  t: TranslationFn,
) {
  if (job.completedAt) {
    return {
      primary: `${formatExportJobStatusLabel("completed", t)} · ${formatDateTime(job.completedAt)}`,
      secondary: `${t("queue.timeline.queuedPrefix")}${formatDateTime(job.createdAt)}`,
    };
  }

  if (job.startedAt) {
    return {
      primary: `${formatExportJobStatusLabel("running", t)} · ${formatDateTime(job.startedAt)}`,
      secondary: `${t("queue.timeline.queuedPrefix")}${formatDateTime(job.createdAt)}`,
    };
  }

  return {
    primary: `${formatExportJobStatusLabel("pending", t)} · ${formatDateTime(job.createdAt)}`,
    secondary: t("queue.waitingForWorker"),
  };
}

function formatExportKindLabel(kind: ReportingSurfaceKind | ExportJob["kind"], t: TranslationFn) {
  return t(`labels.kind.${kind}`);
}

function formatExportCadenceLabel(cadence: ReportCadence, t: TranslationFn) {
  return t(`labels.cadence.${cadence}`);
}

function formatExportJobStatusLabel(status: ExportJob["status"], t: TranslationFn) {
  return t(`labels.jobStatus.${status}`);
}

function formatExportFormatLabel(format: string, locale: AppLocale) {
  return translateInlineText(locale, format);
}

function summarizeErrorMessage(value: string | null, maxLength = 180) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function getExportJobDurationMs(job: Pick<ExportJob, "startedAt" | "completedAt">) {
  if (!job.startedAt || !job.completedAt) {
    return null;
  }

  const durationMs = Date.parse(job.completedAt) - Date.parse(job.startedAt);
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
}

function summarizeExportJobs(exportJobs: ExportJob[]) {
  let completedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  let runningCount = 0;
  let exportedRowCount = 0;
  let lastCompletedAt: string | null = null;

  for (const job of exportJobs) {
    exportedRowCount += job.rowCount ?? 0;

    if (job.completedAt && (!lastCompletedAt || Date.parse(job.completedAt) > Date.parse(lastCompletedAt))) {
      lastCompletedAt = job.completedAt;
    }

    if (job.status === "completed") {
      completedCount += 1;
      continue;
    }

    if (job.status === "failed") {
      failedCount += 1;
      continue;
    }

    if (job.status === "running") {
      runningCount += 1;
      continue;
    }

    pendingCount += 1;
  }

  return {
    totalCount: exportJobs.length,
    completedCount,
    failedCount,
    pendingCount,
    runningCount,
    processingCount: pendingCount + runningCount,
    exportedRowCount,
    lastCompletedAt,
  };
}

function getStringFilterValue(filters: Record<string, unknown>, key: string) {
  const value = filters[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function describeExportScope(
  job: Pick<ExportJob, "kind" | "filters">,
  projectNameById: Map<string, string>,
  environmentById: Map<string, Environment>,
  t: TranslationFn,
) {
  const projectId = getStringFilterValue(job.filters, "projectId");
  const environmentId = getStringFilterValue(job.filters, "environmentId");
  const provider = getStringFilterValue(job.filters, "provider");
  const status = getStringFilterValue(job.filters, "status");
  const action = getStringFilterValue(job.filters, "action");
  const subjectType = getStringFilterValue(job.filters, "subjectType");

  if (environmentId) {
    const environment = environmentById.get(environmentId);
    if (environment) {
      return `${environment.name} (${environment.runtime})`;
    }

    return environmentId;
  }

  if (projectId) {
    return projectNameById.get(projectId) ?? projectId;
  }

  if (job.kind === "usage-events" || job.kind === "usage-ledger") {
    if (provider && status) {
      return `${provider} · ${status}`;
    }

    if (provider) {
      return provider;
    }

    if (status) {
      return status;
    }

    return job.kind === "usage-ledger" ? t("scope.workspaceWideLedger") : t("scope.workspaceWideUsage");
  }

  if (action && subjectType) {
    return `${action} · ${subjectType}`;
  }

  if (action) {
    return action;
  }

  if (subjectType) {
    return subjectType;
  }

  return t("scope.workspaceWideAudit");
}

function describeExportFocus(kind: ExportJob["kind"], filters: Record<string, unknown>, t: TranslationFn) {
  if (kind === "usage-events" || kind === "usage-ledger") {
    const parts = [
      getStringFilterValue(filters, "provider"),
      kind === "usage-ledger"
        ? getStringFilterValue(filters, "canonicalModel") ?? getStringFilterValue(filters, "model")
        : getStringFilterValue(filters, "model"),
      getStringFilterValue(filters, "statusGroup") === "attention"
        ? t("labels.outcome.attention")
        : getStringFilterValue(filters, "status"),
      kind === "usage-ledger" ? getStringFilterValue(filters, "owner") : getStringFilterValue(filters, "surface"),
      getStringFilterValue(filters, "budgetPolicyId") ? t("scope.budgetLinked") : null,
    ].filter(Boolean);

    return parts.length
      ? parts.join(" · ")
      : kind === "usage-ledger"
        ? t("focus.allLedgerRows")
        : t("focus.allUsageRows");
  }

  const parts = [
    getStringFilterValue(filters, "actorType"),
    getStringFilterValue(filters, "action"),
    getStringFilterValue(filters, "subjectType"),
    getStringFilterValue(filters, "subjectId"),
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : t("focus.allAuditEvents");
}

function isUsageLikeKind(kind: string): kind is "usage-events" | "usage-ledger" {
  return kind === "usage-events" || kind === "usage-ledger";
}

function slugifyName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function countStoredFilters(filters: Record<string, unknown>) {
  return Object.values(filters).filter((value) => {
    if (value === null || value === undefined || value === "") {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return true;
  }).length;
}

function getRecordFilterValue(filters: Record<string, unknown>, key: string) {
  const value = filters[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getBooleanRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function getNumberRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getDistributionConfig(filters: Record<string, unknown>): ReportDistribution | null {
  const record = getRecordFilterValue(filters, "distribution");
  if (!record) {
    return null;
  }

  const targets: ReportDistribution["targets"] = Array.isArray(record.targets)
    ? record.targets.flatMap((target) => {
        if (!target || typeof target !== "object" || Array.isArray(target)) {
          return [];
        }

        const parsedTarget = target as Record<string, unknown>;
        const rawChannel = typeof parsedTarget.channel === "string" ? parsedTarget.channel : null;
        const destination = typeof parsedTarget.destination === "string" ? parsedTarget.destination.trim() : "";
        const label = typeof parsedTarget.label === "string" && parsedTarget.label.trim() ? parsedTarget.label.trim() : undefined;
        const channel =
          rawChannel === "email" || rawChannel === "slack" || rawChannel === "feishu" || rawChannel === "webhook"
            ? rawChannel
            : null;
        if (
          !destination ||
          !channel
        ) {
          return [];
        }

        return [
          {
            channel,
            destination,
            label,
          },
        ];
      })
    : [];

  return {
    enabled: getBooleanRecordValue(record, "enabled") ?? targets.length > 0,
    targets,
    includeDownloadLink: getBooleanRecordValue(record, "includeDownloadLink") ?? true,
    includeSignedSnapshot: getBooleanRecordValue(record, "includeSignedSnapshot") ?? false,
  };
}

function getWorkflowConfig(filters: Record<string, unknown>): ReportWorkflow | null {
  const record = getRecordFilterValue(filters, "workflow");
  if (!record) {
    return null;
  }

  const status =
    getStringFilterValue(record, "status") === "acknowledged" ||
    getStringFilterValue(record, "status") === "in_progress" ||
    getStringFilterValue(record, "status") === "blocked" ||
    getStringFilterValue(record, "status") === "completed"
      ? (getStringFilterValue(record, "status") as ReportWorkflow["status"])
      : "pending";
  const ownerLabel = getStringFilterValue(record, "ownerLabel");
  const note = getStringFilterValue(record, "note");
  const slaDueAt = getStringFilterValue(record, "slaDueAt");
  const updatedAt = getStringFilterValue(record, "updatedAt");

  if (!ownerLabel && !note && !slaDueAt && status === "pending" && !updatedAt) {
    return null;
  }

  return {
    ownerLabel: ownerLabel ?? null,
    status,
    note: note ?? null,
    slaDueAt: slaDueAt ?? null,
    updatedAt: updatedAt ?? null,
  };
}

function getGovernanceConfig(filters: Record<string, unknown>): ReportGovernance | null {
  const record = getRecordFilterValue(filters, "governance");
  if (!record) {
    return null;
  }

  const approvalMode = getStringFilterValue(record, "approvalMode") === "required" ? "required" : "none";
  const approvalStatus =
    approvalMode === "required" && getStringFilterValue(record, "approvalStatus") === "approved"
      ? "approved"
      : approvalMode === "required"
        ? "pending"
        : "not_required";
  const approverLabel = getStringFilterValue(record, "approverLabel");
  const approvedAt = getStringFilterValue(record, "approvedAt");
  const watermarkLabel = getStringFilterValue(record, "watermarkLabel");
  const retentionDays = getNumberRecordValue(record, "retentionDays");
  const signedSnapshot = getBooleanRecordValue(record, "signedSnapshot") ?? false;

  if (approvalMode === "none" && !watermarkLabel && retentionDays === null && !signedSnapshot) {
    return null;
  }

  return {
    approvalMode,
    approvalStatus,
    approverLabel: approvalStatus === "approved" ? approverLabel ?? null : null,
    approvedAt: approvalStatus === "approved" ? approvedAt ?? null : null,
    watermarkLabel: watermarkLabel ?? null,
    retentionDays: retentionDays ?? null,
    signedSnapshot,
  };
}

function getEventTriggerConfig(filters: Record<string, unknown>): EventDrivenTrigger | null {
  const record = getRecordFilterValue(filters, "eventTrigger");
  if (!record) {
    return null;
  }

  const events = Array.isArray(record.events)
    ? record.events.filter(
        (value): value is EventDrivenTrigger["events"][number] =>
          value === "budget-alert-opened" || value === "export-job-failed",
      )
    : [];

  if (!events.length) {
    return null;
  }

  return {
    enabled: getBooleanRecordValue(record, "enabled") ?? true,
    events,
    scope: getStringFilterValue(record, "scope") === "workspace" ? "workspace" : "report-scope",
    cooldownMinutes: getNumberRecordValue(record, "cooldownMinutes") ?? 60,
  };
}

function summarizeDistributionConfig(config: ReportDistribution | null, t: TranslationFn) {
  if (!config || !config.targets.length) {
    return t("scheduled.noDeliveryTargets");
  }

  const channels = new Set(config.targets.map((target) => target.channel));
  return t("scheduled.deliveryTargetsSummary", { count: config.targets.length, channels: [...channels].join(", ") });
}

function summarizeEventTriggerConfig(config: EventDrivenTrigger | null, t: TranslationFn) {
  if (!config || !config.events.length) {
    return t("scheduled.cadenceOnly");
  }

  return t("scheduled.eventTriggerSummary", {
    events: config.events.join(" + "),
    scope: config.scope === "workspace" ? t("scheduled.scopeWorkspace") : t("scheduled.scopeReport"),
    minutes: config.cooldownMinutes,
  });
}

function summarizeGovernanceConfig(config: ReportGovernance | null, t: TranslationFn) {
  if (!config) {
    return t("scheduled.noGovernanceGate");
  }

  return [
    config.approvalMode === "required"
      ? t("scheduled.governanceApprovalStatus", { status: config.approvalStatus })
      : t("scheduled.governanceApprovalNone"),
    config.watermarkLabel ? t("scheduled.governanceWatermark", { value: config.watermarkLabel }) : null,
    config.retentionDays !== null ? t("scheduled.governanceRetention", { days: config.retentionDays }) : null,
    config.signedSnapshot ? t("scheduled.governanceSignedSnapshot") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function getDistributionTargetsByChannel(
  config: ReportDistribution | null,
  channel: ReportDistribution["targets"][number]["channel"],
) {
  if (!config) {
    return "";
  }

  return config.targets
    .filter((target) => target.channel === channel)
    .map((target) => target.destination)
    .join("\n");
}

function buildUsageSourceHref(
  workspaceId: string,
  filters: Record<string, unknown>,
  returnTo?: string | null,
) {
  const scopedFilters: Record<string, string> = {};
  const stringKeys = [
    "projectId",
    "environmentId",
    "virtualKeyId",
    "providerConnectionId",
    "budgetPolicyId",
    "provider",
    "model",
    "requestId",
    "providerRequestId",
    "surface",
    "sortBy",
    "from",
    "to",
  ] as const;

  for (const key of stringKeys) {
    const value = getStringFilterValue(filters, key);
    if (value) {
      scopedFilters[key] = value;
    }
  }

  const statusGroup = getStringFilterValue(filters, "statusGroup");
  const status = getStringFilterValue(filters, "status");
  if (statusGroup === "attention") {
    scopedFilters.outcome = "attention";
  } else if (status) {
    scopedFilters.outcome = status;
  }

  const minLatencyMs = filters.minLatencyMs;
  if (typeof minLatencyMs === "number" && Number.isFinite(minLatencyMs) && minLatencyMs >= 0) {
    scopedFilters.minLatencyMs = String(minLatencyMs);
  }

  return buildScopedHref("/usage-events", workspaceId, scopedFilters, returnTo);
}

function buildAuditSourceHref(
  workspaceId: string,
  filters: Record<string, unknown>,
  returnTo?: string | null,
) {
  const scopedFilters: Record<string, string> = {};
  const stringKeys = [
    "projectId",
    "environmentId",
    "actorType",
    "actorId",
    "action",
    "subjectType",
    "subjectId",
    "from",
    "to",
  ] as const;

  for (const key of stringKeys) {
    const value = getStringFilterValue(filters, key);
    if (value) {
      scopedFilters[key] = value;
    }
  }

  return buildScopedHref("/audit-logs", workspaceId, scopedFilters, returnTo);
}

function buildScheduledReportSourceHref(report: ScheduledReport, returnTo?: string | null) {
  const filters = report.filters as Record<string, unknown>;
  return report.kind === "audit-logs"
    ? buildAuditSourceHref(report.workspaceId, filters, returnTo)
    : buildUsageSourceHref(report.workspaceId, filters, returnTo);
}

function buildScheduledReportAuditHref(report: ScheduledReport, returnTo?: string | null) {
  return buildScopedHref(
    "/audit-logs",
    report.workspaceId,
    {
      subjectType: "scheduled-report",
      subjectId: report.id,
    },
    returnTo,
  );
}

function summarizeScheduledReportJobs(report: ScheduledReport, exportJobs: ExportJob[]) {
  const fileStem = slugifyName(report.name) || report.kind;
  const matchingJobs = exportJobs.filter(
    (job) =>
      job.kind === report.kind &&
      (getStringFilterValue(job.filters, "scheduledReportId") === report.id || job.fileName.startsWith(`${fileStem}-`)),
  );
  const latestJob =
    [...matchingJobs].sort((left, right) => {
      const leftTime = Date.parse(left.completedAt ?? left.startedAt ?? left.createdAt);
      const rightTime = Date.parse(right.completedAt ?? right.startedAt ?? right.createdAt);
      return rightTime - leftTime;
    })[0] ?? null;

  return {
    matchingJobs,
    latestJob,
    counts: summarizeExportJobs(matchingJobs),
  };
}

function getScheduledReportJobMeta(job: ExportJob) {
  const scheduledReportId = getStringFilterValue(job.filters, "scheduledReportId");
  const scheduledReportName = getStringFilterValue(job.filters, "scheduledReportName");
  const scheduledReportCadence = getStringFilterValue(job.filters, "scheduledReportCadence");

  if (!scheduledReportId) {
    return null;
  }

  return {
    scheduledReportId,
    scheduledReportName,
    scheduledReportCadence,
  };
}

function buildScopedHref(
  pathname: string,
  workspaceId: string,
  filters: Record<string, string>,
  returnTo?: string | null,
) {
  const params = new URLSearchParams({ workspaceId });

  for (const [key, value] of Object.entries(filters)) {
    if (!value) {
      continue;
    }

    params.set(key, value);
  }

  return buildContextualHref(`${pathname}?${params.toString()}`, returnTo);
}

function buildScheduledFilters(input: {
  kind: "usage-events" | "audit-logs";
  projectId: string | null;
  environmentId: string | null;
  provider: string;
  outcome: string;
  surface: string;
  sortBy: string;
  minLatencyMs: string;
  requestId: string;
  providerRequestId: string;
  from: string;
  to: string;
  actorType: string;
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  virtualKeyId: string;
  providerConnectionId: string;
  budgetPolicyId: string;
  model: string;
}) {
  if (input.kind === "usage-events") {
    return {
      workspaceId: undefined,
      projectId: input.projectId,
      environmentId: input.environmentId,
      virtualKeyId: input.virtualKeyId || null,
      providerConnectionId: input.providerConnectionId || null,
      budgetPolicyId: input.budgetPolicyId || null,
      provider: input.provider || null,
      model: input.model || null,
      requestId: input.requestId || null,
      providerRequestId: input.providerRequestId || null,
      outcome: input.outcome || null,
      surface: input.surface || null,
      minLatencyMs: input.minLatencyMs ? Number.parseInt(input.minLatencyMs, 10) : null,
      sortBy: input.sortBy && input.sortBy !== "newest" ? input.sortBy : null,
      from: input.from || null,
      to: input.to || null,
    };
  }

  return {
    workspaceId: undefined,
    projectId: input.projectId,
    environmentId: input.environmentId,
    actorType: input.actorType || null,
    actorId: input.actorId || null,
    action: input.action || null,
    subjectType: input.subjectType || null,
    subjectId: input.subjectId || null,
    from: input.from || null,
    to: input.to || null,
  };
}

export default async function ExportsPage({ searchParams }: ExportsPageProps) {
  const locale = await getCurrentLocale();
  const t = await getT("exports");
  const { compareLabels, formatDateTime, formatInteger, formatSlaLabel } = createFormatters(locale, t);
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = getSafeReturnTo(getSingleValue(resolvedSearchParams.returnTo) || undefined);
  const requestedWorkspaceId = getSingleValue(resolvedSearchParams.workspaceId) || undefined;
  const workspaceSelection = await loadWorkspaceSelectionWithOptimisticData(
    requestedWorkspaceId,
    async (workspaceId) =>
      Promise.all([
        listExportJobs(workspaceId).then(
          (items) => ({ ok: true as const, items }),
          (error) => ({ ok: false as const, error }),
        ),
        loadScheduledReportsState(workspaceId),
        listProjects(workspaceId).then(
          (items) => ({ ok: true as const, items }),
          (error) => ({ ok: false as const, error }),
        ),
        listWorkspaceEnvironments(workspaceId).then(
          (items) => ({ ok: true as const, items }),
          (error) => ({ ok: false as const, error }),
        ),
      ]),
  );
  const { workspaceOptions, selectedWorkspaceId, dataResult } = workspaceSelection;
  let exportJobs: ExportJob[] = [];
  let scheduledReports: ScheduledReport[] = [];
  let projects: Project[] = [];
  let environments: Environment[] = [];
  let loadMessage = "";
  let exportsIssue = workspaceSelection.issue;
  let scheduledReportsIssue: Awaited<ReturnType<typeof loadScheduledReportsState>>["issue"] = null;

  if (selectedWorkspaceId && dataResult?.ok) {
    const [exportJobsResult, scheduledReportsResult, projectsResult, environmentsResult] = dataResult.data;

    scheduledReports = scheduledReportsResult.items;
    scheduledReportsIssue = scheduledReportsResult.issue;

    if (exportJobsResult.ok) {
      exportJobs = exportJobsResult.items;
    } else {
      exportsIssue = pickFirstControlApiIssue(exportsIssue, diagnoseControlApiIssue(exportJobsResult.error));
      loadMessage = getUserErrorMessage(exportJobsResult.error, t("status.loadExportsError"));
    }

    if (projectsResult.ok) {
      projects = projectsResult.items;
    } else {
      exportsIssue = pickFirstControlApiIssue(exportsIssue, diagnoseControlApiIssue(projectsResult.error));
      loadMessage = loadMessage || getUserErrorMessage(projectsResult.error, t("status.loadProjectsError"));
    }

    if (environmentsResult.ok) {
      environments = environmentsResult.items;
    } else {
      exportsIssue = pickFirstControlApiIssue(exportsIssue, diagnoseControlApiIssue(environmentsResult.error));
      loadMessage = loadMessage || getUserErrorMessage(environmentsResult.error, t("status.loadEnvironmentsError"));
    }
  } else if (selectedWorkspaceId && dataResult && !dataResult.ok) {
    exportsIssue = pickFirstControlApiIssue(exportsIssue, diagnoseControlApiIssue(dataResult.error));
    loadMessage = getUserErrorMessage(dataResult.error, t("status.loadExportsError"));
  }

  const sortedProjects = [...projects].sort(
    (left, right) =>
      projectStatusOrder[left.status] - projectStatusOrder[right.status] || compareLabels(left.name, right.name),
  );
  const projectNameById = new Map(sortedProjects.map((project) => [project.id, project.name]));
  const sortedEnvironments = [...environments].sort(
    (left, right) =>
      compareLabels(projectNameById.get(left.projectId) ?? "", projectNameById.get(right.projectId) ?? "") ||
      environmentStatusOrder[left.status] - environmentStatusOrder[right.status] ||
      compareLabels(left.name, right.name),
  );
  const environmentById = new Map(sortedEnvironments.map((environment) => [environment.id, environment]));
  const selectedProjectId = (() => {
    const rawProjectId = getOptionalFilter(getSingleValue(resolvedSearchParams.projectId) || undefined);
    return rawProjectId && sortedProjects.some((project) => project.id === rawProjectId) ? rawProjectId : null;
  })();
  const filteredEnvironmentOptions = selectedProjectId
    ? sortedEnvironments.filter((environment) => environment.projectId === selectedProjectId)
    : sortedEnvironments;
  const selectedEnvironmentId = (() => {
    const rawEnvironmentId = getOptionalFilter(getSingleValue(resolvedSearchParams.environmentId) || undefined);
    return rawEnvironmentId && filteredEnvironmentOptions.some((environment) => environment.id === rawEnvironmentId)
      ? rawEnvironmentId
      : null;
  })();
  const selectedProvider = (() => {
    const rawProvider = getOptionalFilter(getSingleValue(resolvedSearchParams.provider) || undefined);
    return rawProvider && providerOptions.includes(rawProvider as (typeof providerOptions)[number]) ? rawProvider : "";
  })();
  const selectedOutcome = (() => {
    const rawOutcome = getOptionalFilter(getSingleValue(resolvedSearchParams.outcome) || undefined);
    const rawStatusGroup = getOptionalFilter(getSingleValue(resolvedSearchParams.statusGroup) || undefined);
    const rawStatus = getOptionalFilter(getSingleValue(resolvedSearchParams.status) || undefined);

    if (rawOutcome === "attention" || rawStatusGroup === "attention") {
      return "attention" as OutcomeFilter;
    }

    if (rawOutcome && statusOptions.includes(rawOutcome as (typeof statusOptions)[number])) {
      return rawOutcome as OutcomeFilter;
    }

    if (rawStatus && statusOptions.includes(rawStatus as (typeof statusOptions)[number])) {
      return rawStatus as OutcomeFilter;
    }

    return "";
  })();
  const selectedSurface = (() => {
    const rawSurface = getOptionalFilter(getSingleValue(resolvedSearchParams.surface) || undefined);
    return rawSurface && surfaceOptions.includes(rawSurface as SurfaceFilter) ? rawSurface : "";
  })();
  const selectedMinLatencyMs = (() => {
    const rawValue = getOptionalFilter(getSingleValue(resolvedSearchParams.minLatencyMs) || undefined);
    const parsed = Number.parseInt(rawValue ?? "", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "";
  })();
  const selectedSortBy = (() => {
    const rawSortBy = getOptionalFilter(getSingleValue(resolvedSearchParams.sortBy) || undefined);
    return rawSortBy && sortOptions.includes(rawSortBy as SortFilter) ? rawSortBy : "newest";
  })();
  const selectedCanonicalModel = getOptionalFilter(getSingleValue(resolvedSearchParams.canonicalModel) || undefined) ?? "";
  const selectedOwner = getOptionalFilter(getSingleValue(resolvedSearchParams.owner) || undefined) ?? "";
  const selectedJobKind = (() => {
    const rawJobKind = getOptionalFilter(getSingleValue(resolvedSearchParams.jobKind) || undefined);
    return rawJobKind === "usage-events" || rawJobKind === "usage-ledger" || rawJobKind === "audit-logs" ? rawJobKind : "";
  })();
  const selectedJobStatus = (() => {
    const rawJobStatus = getOptionalFilter(getSingleValue(resolvedSearchParams.jobStatus) || undefined);
    return rawJobStatus === "pending" ||
      rawJobStatus === "running" ||
      rawJobStatus === "completed" ||
      rawJobStatus === "failed"
      ? rawJobStatus
      : "";
  })();
  const selectedJobQuery = getOptionalFilter(getSingleValue(resolvedSearchParams.jobQuery) || undefined) ?? "";
  const selectedReportTemplate = getOptionalFilter(getSingleValue(resolvedSearchParams.reportTemplate) || undefined) ?? "";
  const selectedReportCadence = (() => {
    const cadence = getOptionalFilter(getSingleValue(resolvedSearchParams.reportCadence) || undefined);
    if (cadence === "daily" || cadence === "weekly" || cadence === "monthly") {
      return cadence as ReportCadence;
    }

    return "";
  })();
  const notice = getSingleValue(resolvedSearchParams.notice);
  const message = getSingleValue(resolvedSearchParams.message) || loadMessage;
  const kind = (() => {
    const rawKind = getSingleValue(resolvedSearchParams.kind) || "usage-events";
    return rawKind === "usage-ledger" || rawKind === "audit-logs" ? rawKind : "usage-events";
  })();
  const activeReportKind: ReportingSurfaceKind = kind;
  const currentOneOffKind = activeReportKind;
  const selectedWorkspace =
    selectedWorkspaceId ? workspaceOptions.find((workspace) => workspace.id === selectedWorkspaceId) ?? null : null;
  const exportSummary = summarizeExportJobs(exportJobs);
  const filteredExportJobs = exportJobs.filter((job) => {
    if (selectedJobKind && job.kind !== selectedJobKind) {
      return false;
    }

    if (selectedJobStatus && job.status !== selectedJobStatus) {
      return false;
    }

    if (!selectedJobQuery) {
      return true;
    }

    const searchIndex = [
      job.fileName,
      job.kind,
      job.format,
      job.status,
      job.errorMessage,
      getStringFilterValue(job.filters, "scheduledReportName"),
      getStringFilterValue(job.filters, "scheduledReportCadence"),
      describeExportScope(job, projectNameById, environmentById, t),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchIndex.includes(selectedJobQuery.toLowerCase());
  });
  const filteredExportSummary = summarizeExportJobs(filteredExportJobs);
  const failedVisibleExportJobs = filteredExportJobs.filter((job) => job.status === "failed");
  const buildExportsPageHref = (overrides?: {
    kind?: string | null;
    jobKind?: ExportJobKindFilter | null;
    jobStatus?: ExportJobStatusFilter | null;
    jobQuery?: string | null;
    reportTemplate?: string | null;
    reportCadence?: ReportCadence | null;
  }) => {
    if (!selectedWorkspaceId) {
      return buildContextualHref("/exports", returnTo);
    }

    const params = new URLSearchParams({
      workspaceId: selectedWorkspaceId,
    });

    if (selectedProjectId) {
      params.set("projectId", selectedProjectId);
    }
    if (selectedEnvironmentId) {
      params.set("environmentId", selectedEnvironmentId);
    }
    if (selectedProvider) {
      params.set("provider", selectedProvider);
    }
    if (selectedOutcome) {
      params.set("outcome", selectedOutcome);
    }
    if (selectedSurface) {
      params.set("surface", selectedSurface);
    }
    if (selectedMinLatencyMs) {
      params.set("minLatencyMs", selectedMinLatencyMs);
    }
    if (selectedSortBy && selectedSortBy !== "newest") {
      params.set("sortBy", selectedSortBy);
    }
    const nextKind = overrides?.kind === undefined ? kind : overrides.kind ?? "";
    if (nextKind) {
      params.set("kind", nextKind);
    }
    const nextJobKind = overrides?.jobKind === undefined ? selectedJobKind : overrides.jobKind ?? "";
    if (nextJobKind) {
      params.set("jobKind", nextJobKind);
    }
    const nextJobStatus = overrides?.jobStatus === undefined ? selectedJobStatus : overrides.jobStatus ?? "";
    if (nextJobStatus) {
      params.set("jobStatus", nextJobStatus);
    }
    const nextJobQuery = overrides?.jobQuery === undefined ? selectedJobQuery : overrides.jobQuery ?? "";
    if (nextJobQuery) {
      params.set("jobQuery", nextJobQuery);
    }
    const nextReportTemplate =
      overrides?.reportTemplate === undefined ? selectedReportTemplate : overrides.reportTemplate ?? "";
    if (nextReportTemplate) {
      params.set("reportTemplate", nextReportTemplate);
    }
    const nextReportCadence =
      overrides?.reportCadence === undefined ? selectedReportCadence : overrides.reportCadence ?? "";
    if (nextReportCadence) {
      params.set("reportCadence", nextReportCadence);
    }
    for (const key of [
      "virtualKeyId",
      "providerConnectionId",
      "budgetPolicyId",
      "model",
      "canonicalModel",
      "owner",
      "requestId",
      "providerRequestId",
      "from",
      "to",
      "actorType",
      "actorId",
      "action",
      "subjectType",
      "subjectId",
      "usageFormat",
      "auditFormat",
    ]) {
      const value = getOptionalFilter(getSingleValue(resolvedSearchParams[key]) || undefined);
      if (value) {
        params.set(key, value);
      }
    }

    return buildContextualHref(`/exports?${params.toString()}`, returnTo);
  };
  const buildExportsFilterHref = (
    overrides: Partial<
      Record<
        | "kind"
        | "projectId"
        | "environmentId"
        | "provider"
        | "outcome"
        | "surface"
        | "minLatencyMs"
        | "sortBy"
        | "virtualKeyId"
        | "providerConnectionId"
        | "budgetPolicyId"
        | "model"
        | "canonicalModel"
        | "owner"
        | "requestId"
        | "providerRequestId"
        | "from"
        | "to"
        | "actorType"
        | "actorId"
        | "action"
        | "subjectType"
        | "subjectId"
        | "usageFormat"
        | "auditFormat"
        | "jobKind"
        | "jobStatus"
        | "jobQuery"
        | "reportTemplate"
        | "reportCadence",
        string | null
      >
    >,
  ) => {
    if (!selectedWorkspaceId) {
      return buildContextualHref("/exports", returnTo);
    }

    const currentParams: Record<string, string | null> = {
      kind,
      projectId: selectedProjectId,
      environmentId: selectedEnvironmentId,
      provider: selectedProvider || null,
      outcome: selectedOutcome || null,
      surface: selectedSurface || null,
      minLatencyMs: selectedMinLatencyMs || null,
      sortBy: selectedSortBy && selectedSortBy !== "newest" ? selectedSortBy : null,
      virtualKeyId: getOptionalFilter(getSingleValue(resolvedSearchParams.virtualKeyId) || undefined),
      providerConnectionId: getOptionalFilter(getSingleValue(resolvedSearchParams.providerConnectionId) || undefined),
      budgetPolicyId: getOptionalFilter(getSingleValue(resolvedSearchParams.budgetPolicyId) || undefined),
      model: getOptionalFilter(getSingleValue(resolvedSearchParams.model) || undefined),
      canonicalModel: selectedCanonicalModel || null,
      owner: selectedOwner || null,
      requestId: getOptionalFilter(getSingleValue(resolvedSearchParams.requestId) || undefined),
      providerRequestId: getOptionalFilter(getSingleValue(resolvedSearchParams.providerRequestId) || undefined),
      from: getOptionalFilter(getSingleValue(resolvedSearchParams.from) || undefined),
      to: getOptionalFilter(getSingleValue(resolvedSearchParams.to) || undefined),
      actorType: getOptionalFilter(getSingleValue(resolvedSearchParams.actorType) || undefined),
      actorId: getOptionalFilter(getSingleValue(resolvedSearchParams.actorId) || undefined),
      action: getOptionalFilter(getSingleValue(resolvedSearchParams.action) || undefined),
      subjectType: getOptionalFilter(getSingleValue(resolvedSearchParams.subjectType) || undefined),
      subjectId: getOptionalFilter(getSingleValue(resolvedSearchParams.subjectId) || undefined),
      usageFormat: getOptionalFilter(getSingleValue(resolvedSearchParams.usageFormat) || undefined),
      auditFormat: getOptionalFilter(getSingleValue(resolvedSearchParams.auditFormat) || undefined),
      jobKind: selectedJobKind || null,
      jobStatus: selectedJobStatus || null,
      jobQuery: selectedJobQuery || null,
      reportTemplate: selectedReportTemplate || null,
      reportCadence: selectedReportCadence || null,
    };

    const params = new URLSearchParams({
      workspaceId: selectedWorkspaceId,
    });

    for (const [key, value] of Object.entries({
      ...currentParams,
      ...overrides,
    })) {
      if (value) {
        params.set(key, value);
      }
    }

    return buildContextualHref(`/exports?${params.toString()}`, returnTo);
  };
  const exportsHref = buildExportsPageHref();

  const noticeTag =
    notice === "created" ? {
      label: t("notice.created"),
      className: "tag status-tag--success",
    }
    : notice === "error" ? {
      label: t("notice.error"),
      className: "tag status-tag--error",
    }
    : loadMessage ? {
      label: t("notice.unavailable"),
      className: "tag status-tag--error",
    } : null;
  const jobQuickViews = selectedWorkspaceId
    ? [
        {
          label: t("queue.quickViews.allJobs"),
          hint: t("queue.quickViews.allJobsHint", { count: exportJobs.length }),
          href: buildExportsPageHref({
            jobStatus: null,
            jobQuery: null,
          }),
          active: !selectedJobStatus && !selectedJobQuery,
        },
        {
          label: t("labels.jobStatus.running"),
          hint: t("queue.quickViews.runningHint", { count: exportSummary.runningCount }),
          href: buildExportsPageHref({
            jobStatus: "running",
            jobQuery: null,
          }),
          active: selectedJobStatus === "running" && !selectedJobQuery,
        },
        {
          label: t("labels.jobStatus.failed"),
          hint: t("queue.quickViews.failedHint", { count: exportSummary.failedCount }),
          href: buildExportsPageHref({
            jobStatus: "failed",
            jobQuery: null,
          }),
          active: selectedJobStatus === "failed" && !selectedJobQuery,
        },
        {
          label: t("labels.jobStatus.completed"),
          hint: t("queue.quickViews.completedHint", { count: exportSummary.completedCount }),
          href: buildExportsPageHref({
            jobStatus: "completed",
            jobQuery: null,
          }),
          active: selectedJobStatus === "completed" && !selectedJobQuery,
        },
      ]
    : [];
  const activeJobFilterChips = selectedWorkspaceId
    ? [
        selectedJobKind
          ? {
              label: t("queue.filters.kind"),
              value: selectedJobKind,
              href: buildExportsPageHref({
                jobKind: null,
              }),
            }
          : null,
        selectedJobStatus
          ? {
              label: t("queue.filters.status"),
              value: selectedJobStatus,
              href: buildExportsPageHref({
                jobStatus: null,
              }),
            }
          : null,
        selectedJobQuery
          ? {
              label: t("queue.filters.search"),
              value: selectedJobQuery,
              href: buildExportsPageHref({
                jobQuery: null,
              }),
            }
          : null,
      ].filter((chip): chip is { label: string; value: string; href: string } => Boolean(chip))
    : [];
  const activeReportFilterChips = selectedWorkspaceId
    ? [
        selectedProjectId
          ? {
              label: t("reportFilters.project"),
              value: projectNameById.get(selectedProjectId) ?? selectedProjectId,
              href: buildExportsFilterHref({ projectId: null, environmentId: null }),
            }
          : null,
        selectedEnvironmentId
          ? {
              label: t("reportFilters.environment"),
              value:
                environmentById.get(selectedEnvironmentId)?.name ??
                selectedEnvironmentId,
              href: buildExportsFilterHref({ environmentId: null }),
            }
          : null,
        selectedProvider
          ? {
              label: t("reportFilters.provider"),
              value: selectedProvider,
              href: buildExportsFilterHref({ provider: null }),
            }
          : null,
        selectedOutcome
          ? {
              label: t("reportFilters.outcome"),
              value: selectedOutcome,
              href: buildExportsFilterHref({ outcome: null }),
            }
          : null,
        selectedSurface && activeReportKind === "usage-events"
          ? {
              label: t("reportFilters.callType"),
              value: selectedSurface,
              href: buildExportsFilterHref({ surface: null }),
            }
          : null,
        selectedCanonicalModel && activeReportKind === "usage-ledger"
          ? {
              label: t("reportFilters.canonicalModel"),
              value: selectedCanonicalModel,
              href: buildExportsFilterHref({ canonicalModel: null }),
            }
          : null,
        selectedOwner && activeReportKind === "usage-ledger"
          ? {
              label: t("reportFilters.owner"),
              value: selectedOwner,
              href: buildExportsFilterHref({ owner: null }),
            }
          : null,
        getOptionalFilter(getSingleValue(resolvedSearchParams.model) || undefined) && activeReportKind === "usage-events"
          ? {
              label: t("reportFilters.model"),
              value: getSingleValue(resolvedSearchParams.model),
              href: buildExportsFilterHref({ model: null }),
            }
          : null,
        getOptionalFilter(getSingleValue(resolvedSearchParams.budgetPolicyId) || undefined)
          ? {
              label: t("reportFilters.budget"),
              value: getSingleValue(resolvedSearchParams.budgetPolicyId),
              href: buildExportsFilterHref({ budgetPolicyId: null }),
            }
          : null,
        getOptionalFilter(getSingleValue(resolvedSearchParams.virtualKeyId) || undefined)
          ? {
              label: t("reportFilters.virtualKey"),
              value: getSingleValue(resolvedSearchParams.virtualKeyId),
              href: buildExportsFilterHref({ virtualKeyId: null }),
            }
          : null,
        getOptionalFilter(getSingleValue(resolvedSearchParams.providerConnectionId) || undefined)
          ? {
              label: t("reportFilters.connection"),
              value: getSingleValue(resolvedSearchParams.providerConnectionId),
              href: buildExportsFilterHref({ providerConnectionId: null }),
            }
          : null,
        getOptionalFilter(getSingleValue(resolvedSearchParams.requestId) || undefined)
          ? {
              label: t("reportFilters.request"),
              value: getSingleValue(resolvedSearchParams.requestId),
              href: buildExportsFilterHref({ requestId: null }),
            }
          : null,
        getOptionalFilter(getSingleValue(resolvedSearchParams.providerRequestId) || undefined)
          ? {
              label: t("reportFilters.providerRequest"),
              value: getSingleValue(resolvedSearchParams.providerRequestId),
              href: buildExportsFilterHref({ providerRequestId: null }),
            }
          : null,
      ].filter((chip): chip is { label: string; value: string; href: string } => Boolean(chip))
    : [];


  const queueInterpretation = selectedWorkspaceId
    ? activeReportKind === "usage-ledger"
      ? exportSummary.totalCount === 0
        ? t("queue.ledgerEmpty")
        : t("queue.ledgerSummary", {
            pending: formatInteger(exportSummary.pendingCount),
            running: formatInteger(exportSummary.runningCount),
            failed: formatInteger(exportSummary.failedCount),
            lastCompleted: exportSummary.lastCompletedAt ? formatDateTime(exportSummary.lastCompletedAt) : "",
          })
      : exportSummary.totalCount === 0
        ? t("queue.empty")
        : formatQueueSummary(locale, formatInteger(exportSummary.totalCount), formatInteger(exportSummary.totalCount))
    : "";
  const queueHealthTag = selectedWorkspaceId
    ? exportSummary.failedCount > 0
      ? {
          label: t("queue.health.needsIntervention"),
          className: "tag tag--critical",
        }
      : exportSummary.processingCount > 0
        ? {
            label: t("queue.health.activePipeline"),
            className: "tag tag--warning",
          }
        : {
            label: t("queue.health.stable"),
            className: "tag",
          }
    : null;
  const queueStageCards = selectedWorkspaceId
    ? [
        {
          label: t("queue.stage.backlog"),
          count: exportSummary.pendingCount,
          hint:
            exportSummary.pendingCount > 0
              ? t("queue.stage.backlogHint")
              : t("queue.stage.backlogEmpty"),
        },
        {
          label: t("queue.stage.inProgress"),
          count: exportSummary.runningCount,
          hint:
            exportSummary.runningCount > 0
              ? t("queue.stage.inProgressHint")
              : t("queue.stage.inProgressEmpty"),
        },
        {
          label: t("queue.stage.needsReview"),
          count: exportSummary.failedCount,
          hint:
            exportSummary.failedCount > 0
              ? t("queue.stage.needsReviewHint")
              : t("queue.stage.needsReviewEmpty"),
        },
        {
          label: t("queue.stage.ready"),
          count: exportSummary.completedCount,
          hint:
            exportSummary.completedCount > 0
              ? t("queue.stage.readyHint")
              : t("queue.stage.readyEmpty"),
        },
      ]
    : [];


  const reportTemplates: ReportTemplateCard[] = selectedWorkspaceId
    ? [
        ...CommonReportTemplates.map((template: CommonReportTemplate) => ({
          id: template.id,
          title: t(`templates.${template.id}.title`),
          description: t(`templates.${template.id}.description`),
          href: buildExportsPageHref({
            kind: template.kind,
            jobKind: template.kind,
            reportTemplate: template.id,
            reportCadence: template.cadence === "adhoc" ? null : template.cadence,
          }),
          kindLabel: t(`labels.kind.${template.kind}`),
          focusLabel: t(`templates.${template.id}.focus`),
          cadenceLabel: template.cadence === "adhoc" ? t("labels.cadence.adhoc") : t(`labels.cadence.${template.cadence}`),
        })),
        {
          id: "finance-weekly",
          title: t("templates.finance-weekly.title"),
          description: t("templates.finance-weekly.description", { count: formatInteger(exportSummary.exportedRowCount) }),
          href: buildExportsPageHref({
            kind: "usage-events",
            jobKind: "usage-events",
            jobStatus: "completed",
            reportTemplate: "finance-weekly",
            reportCadence: "weekly",
          }),
          kindLabel: t("labels.kind.usage-events"),
          focusLabel: t("templates.finance-weekly.focus"),
          cadenceLabel: t("labels.cadence.weekly"),
        },
        {
          id: "ops-attention",
          title: t("templates.ops-attention.title"),
          description: t("templates.ops-attention.description", { count: formatInteger(exportSummary.failedCount) }),
          href: buildExportsPageHref({
            kind: "audit-logs",
            jobKind: "audit-logs",
            jobStatus: "failed",
            reportTemplate: "ops-attention",
            reportCadence: "weekly",
          }),
          kindLabel: t("labels.kind.audit-logs"),
          focusLabel: t("templates.ops-attention.focus"),
          cadenceLabel: t("labels.cadence.weekly"),
        },
        {
          id: "leadership-overview",
          title: t("templates.leadership-overview.title"),
          description: t("templates.leadership-overview.description"),
          href: buildExportsPageHref({
            kind: "usage-ledger",
            jobKind: "usage-ledger",
            jobStatus: "",
            reportTemplate: "leadership-overview",
            reportCadence: "monthly",
          }),
          kindLabel: t("labels.kind.usage-ledger"),
          focusLabel: t("templates.leadership-overview.focus"),
          cadenceLabel: t("labels.cadence.monthly"),
        },
      ]
    : [];

  const recurringPresets: RecurringReportCard[] = selectedWorkspaceId
    ? [
        {
          id: "daily-ops-brief",
          title: t("recurringPresets.daily-ops-brief.title"),
          description: t("recurringPresets.daily-ops-brief.description"),
          href: buildExportsPageHref({
            jobKind: "usage-events",
            jobStatus: "",
            reportTemplate: "daily-ops-brief",
            reportCadence: "daily",
          }),
          cadenceLabel: t("labels.cadence.daily"),
        },
        {
          id: "weekly-leadership",
          title: t("recurringPresets.weekly-leadership.title"),
          description: t("recurringPresets.weekly-leadership.description"),
          href: buildExportsPageHref({
            jobKind: "",
            jobStatus: "",
            reportTemplate: "weekly-leadership",
            reportCadence: "weekly",
          }),
          cadenceLabel: t("labels.cadence.weekly"),
        },
        {
          id: "monthly-qa",
          title: t("recurringPresets.monthly-qa.title"),
          description: t("recurringPresets.monthly-qa.description"),
          href: buildExportsPageHref({
            jobKind: "",
            jobStatus: "",
            reportTemplate: "monthly-qa",
            reportCadence: "monthly",
          }),
          cadenceLabel: t("labels.cadence.monthly"),
        },
      ]
    : [];
  const scheduleFilterInputs = {
    projectId: selectedProjectId,
    environmentId: selectedEnvironmentId,
    provider: selectedProvider,
    outcome: selectedOutcome,
    surface: selectedSurface,
    sortBy: selectedSortBy,
    minLatencyMs: selectedMinLatencyMs,
    requestId: getSingleValue(resolvedSearchParams.requestId),
    providerRequestId: getSingleValue(resolvedSearchParams.providerRequestId),
    from: getSingleValue(resolvedSearchParams.from),
    to: getSingleValue(resolvedSearchParams.to),
    actorType: getSingleValue(resolvedSearchParams.actorType),
    actorId: getSingleValue(resolvedSearchParams.actorId),
    action: getSingleValue(resolvedSearchParams.action),
    subjectType: getSingleValue(resolvedSearchParams.subjectType),
    subjectId: getSingleValue(resolvedSearchParams.subjectId),
    virtualKeyId: getSingleValue(resolvedSearchParams.virtualKeyId),
    providerConnectionId: getSingleValue(resolvedSearchParams.providerConnectionId),
    budgetPolicyId: getSingleValue(resolvedSearchParams.budgetPolicyId),
    model: getSingleValue(resolvedSearchParams.model),
  };
  const currentUsageScheduleFilters = buildScheduledFilters({
    kind: "usage-events",
    ...scheduleFilterInputs,
  });
  const currentAuditScheduleFilters = buildScheduledFilters({
    kind: "audit-logs",
    ...scheduleFilterInputs,
  });
  const currentScheduleKind = activeReportKind === "audit-logs" ? "audit-logs" : "usage-events";
  const currentScheduleFilters =
    currentScheduleKind === "audit-logs" ? currentAuditScheduleFilters : currentUsageScheduleFilters;
  const scheduledReportCounts = {
    total: scheduledReports.length,
    daily: scheduledReports.filter((report) => report.cadence === "daily").length,
    weekly: scheduledReports.filter((report) => report.cadence === "weekly").length,
    monthly: scheduledReports.filter((report) => report.cadence === "monthly").length,
  };
  const nextScheduledRun =
    [...scheduledReports]
      .sort((left, right) => Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt))[0] ?? null;
  const currentReportFormat =
    currentOneOffKind === "audit-logs"
      ? getSingleValue(resolvedSearchParams.auditFormat) || "csv"
      : getSingleValue(resolvedSearchParams.usageFormat) || "csv";
  const currentReportScopeLabel = selectedWorkspaceId
    ? describeExportScope(
        {
          kind: currentOneOffKind,
          filters:
            currentOneOffKind === "audit-logs"
              ? (currentAuditScheduleFilters as Record<string, unknown>)
              : ({
                  ...(currentUsageScheduleFilters as Record<string, unknown>),
                  canonicalModel: selectedCanonicalModel || null,
                  owner: selectedOwner || null,
                } as Record<string, unknown>),
        },
        projectNameById,
        environmentById,
        t,
      )
    : "";
  const currentReportFocusLabel = describeExportFocus(
    currentOneOffKind,
    currentOneOffKind === "audit-logs"
      ? (currentAuditScheduleFilters as Record<string, unknown>)
      : ({
          ...(currentUsageScheduleFilters as Record<string, unknown>),
          canonicalModel: selectedCanonicalModel || null,
          owner: selectedOwner || null,
        } as Record<string, unknown>),
    t,
  );
  const currentReportSourceHref = selectedWorkspaceId
    ? currentOneOffKind === "audit-logs"
      ? buildAuditSourceHref(
          selectedWorkspaceId,
          currentScheduleFilters as Record<string, unknown>,
          returnTo,
        )
      : currentOneOffKind === "usage-ledger"
        ? `${exportsHref}#usage-ledger-export-form`
      : buildUsageSourceHref(
          selectedWorkspaceId,
          currentScheduleFilters as Record<string, unknown>,
          returnTo,
        )
    : null;
  const currentReportCadence = selectedReportCadence || "weekly";
  const currentReportStoredFilterCount = countStoredFilters(
    currentOneOffKind === "audit-logs"
      ? (currentScheduleFilters as Record<string, unknown>)
      : ({
          ...(currentUsageScheduleFilters as Record<string, unknown>),
          canonicalModel: selectedCanonicalModel || null,
          owner: selectedOwner || null,
        } as Record<string, unknown>),
  );
  const defaultScheduledApprovalMode = selectedReportTemplate === "monthly-qa" ? "required" : "none";
  const defaultScheduledRetentionDays = selectedReportTemplate === "monthly-qa" ? "365" : "";
  const defaultScheduledSignedSnapshot = selectedReportTemplate === "monthly-qa";
  const defaultOpsEventTrigger =
    selectedReportTemplate === "ops-attention" || selectedReportTemplate === "daily-ops-brief";
  const scheduledReportCards = scheduledReports.map((report) => {
    const reportFilters = report.filters as Record<string, unknown>;
    const jobSummary = summarizeScheduledReportJobs(report, exportJobs);
    const distribution = getDistributionConfig(reportFilters);
    const eventTrigger = getEventTriggerConfig(reportFilters);
    const governance = getGovernanceConfig(reportFilters);
    const scopeLabel = describeExportScope(
      {
        kind: report.kind,
        filters: reportFilters,
      },
      projectNameById,
      environmentById,
      t,
    );
    const focusLabel = describeExportFocus(report.kind, reportFilters, t);
    const latestJobLabel =
      jobSummary.latestJob ?
        `${jobSummary.latestJob.status} · ${formatDateTime(jobSummary.latestJob.completedAt ?? jobSummary.latestJob.startedAt ?? jobSummary.latestJob.createdAt)}`
      : report.lastRunAt ?
        `Triggered ${formatDateTime(report.lastRunAt)}`
      : "No generated files yet";
    const statusTag =
      jobSummary.latestJob?.status === "failed" ?
        { label: "needs review", className: "tag tag--critical" }
      : jobSummary.latestJob?.status === "running" || jobSummary.latestJob?.status === "pending" ?
        { label: "processing", className: "tag tag--warning" }
      : report.lastRunAt ?
        { label: "tracked", className: "tag tag--resolved" }
      : { label: "scheduled", className: "tag" };
    const latestFailureMessage =
      jobSummary.latestJob?.status === "failed" ? summarizeErrorMessage(jobSummary.latestJob.errorMessage) : null;

    return {
      report,
      sourceHref: buildScheduledReportSourceHref(report, exportsHref),
      auditHref: buildScheduledReportAuditHref(report, exportsHref),
      queueHref: buildExportsPageHref({
        kind: report.kind,
        jobKind: report.kind,
        jobQuery: slugifyName(report.name) || report.name,
      }),
      scopeLabel,
      focusLabel,
      storedFilterCount: countStoredFilters(reportFilters),
      latestJobLabel,
      latestFailureMessage,
      statusTag,
      jobSummary,
      distributionSummary: summarizeDistributionConfig(distribution, t),
      eventTriggerSummary: summarizeEventTriggerConfig(eventTrigger, t),
      governanceSummary: summarizeGovernanceConfig(governance, t),
      distribution,
      eventTrigger,
      governance,
    };
  });
  const scheduledReportCardById = new Map(
    scheduledReportCards.map((card) => [card.report.id, card]),
  );
  const followupExportJobs = filteredExportJobs
    .map((job) => {
      const filters = job.filters as Record<string, unknown>;
      const workflow = getWorkflowConfig(filters);
      const governance = getGovernanceConfig(filters);
      const distribution = getDistributionConfig(filters);
      const scheduledReportMeta = getScheduledReportJobMeta(job);
      return {
        job,
        workflow,
        governance,
        distribution,
        distributionSummary: summarizeDistributionConfig(distribution, t),
        governanceSummary: summarizeGovernanceConfig(governance, t),
        workflowSlaLabel: formatSlaLabel(workflow?.slaDueAt ?? null),
        scheduledReportMeta,
      };
    })
    .filter(
      (entry) =>
        entry.job.status === "failed" ||
        Boolean(entry.workflow) ||
        (entry.governance?.approvalMode === "required" && entry.governance.approvalStatus !== "approved") ||
        Boolean(entry.distribution?.targets.length),
    );
  const approvalPendingCount = followupExportJobs.filter(
    (entry) => entry.governance?.approvalMode === "required" && entry.governance.approvalStatus !== "approved",
  ).length;
  const ownerlessFollowupCount = followupExportJobs.filter(
    (entry) => !entry.workflow?.ownerLabel || !entry.workflow.ownerLabel.trim().length,
  ).length;
  const deliveryConfiguredCount = scheduledReportCards.filter((card) => card.distribution?.targets.length).length;
  const trackedRecurringCount = scheduledReportCards.filter(
    (card) => Boolean(card.report.lastRunAt) || Boolean(card.jobSummary.latestJob),
  ).length;
  const reportWorkbenchScopeLabel = [
    selectedWorkspace ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}` : t("workspace.noSelection"),
    currentReportScopeLabel || t("reportSpec.noScopedSource"),
  ].join(" · ");
  const reportWorkbenchScopeSummary = [
    t("workbench.reportSpecSummary", { kind: currentOneOffKind }),
    t("workbench.storedFiltersSummary", { count: currentReportStoredFilterCount }),
    currentReportFocusLabel,
    t("workbench.outputSummary", { format: currentReportFormat.toUpperCase() }),
  ].join(" · ");
  const reportWorkbenchMetrics = [
    {
      label: t("workbench.metrics.followUp"),
      value: String(followupExportJobs.length),
      tone: followupExportJobs.length > 0 ? ("warning" as const) : ("resolved" as const),
    },
    {
      label: t("workbench.metrics.approvalPending"),
      value: String(approvalPendingCount),
      tone: approvalPendingCount > 0 ? ("critical" as const) : ("resolved" as const),
    },
    {
      label: t("workbench.metrics.recurring"),
      value: String(scheduledReportCounts.total),
      tone: scheduledReportCounts.total > 0 ? ("resolved" as const) : ("warning" as const),
    },
    {
      label: t("workbench.metrics.nextRun"),
      value: nextScheduledRun ? formatDateTime(nextScheduledRun.nextRunAt) : t("shared.none"),
      tone: nextScheduledRun ? ("resolved" as const) : ("warning" as const),
    },
  ];
  const reportWorkbenchLanes = [
    {
      eyebrow: t("workbench.steps.step1"),
      title:
        currentOneOffKind === "usage-ledger"
          ? t("workbench.lanes.refineLedgerTitle")
          : currentReportSourceHref
            ? t("workbench.lanes.returnToSourceTitle")
            : t("workbench.lanes.defineSourceTitle"),
      description:
        currentOneOffKind === "usage-ledger"
          ? t("workbench.lanes.refineLedgerDescription")
          : currentReportSourceHref
            ? t("workbench.lanes.returnToSourceDescription")
            : t("workbench.lanes.defineSourceDescription"),
      href: currentReportSourceHref,
      tone: currentOneOffKind === "usage-ledger" ? undefined : currentReportSourceHref ? undefined : ("warning" as const),
      ctaLabel:
        currentOneOffKind === "usage-ledger"
          ? t("workbench.cta.refineLedgerSlice")
          : currentReportSourceHref
            ? t("actions.openSource")
            : t("workbench.cta.refineSource"),
    },
    {
      eyebrow: t("workbench.steps.step2"),
      title: followupExportJobs.length ? t("workbench.lanes.followUpQueueTitle") : t("workbench.lanes.queueOneOffTitle"),
      description: followupExportJobs.length
        ? t("workbench.lanes.followUpQueueDescription", { count: followupExportJobs.length })
        : t("workbench.lanes.queueOneOffDescription"),
      href: followupExportJobs.length
        ? `${exportsHref}#operational-follow-up`
        : `${exportsHref}${
            currentOneOffKind === "audit-logs"
              ? "#audit-export-form"
              : currentOneOffKind === "usage-ledger"
                ? "#usage-ledger-export-form"
                : "#usage-export-form"
          }`,
      tone: approvalPendingCount > 0 ? ("critical" as const) : followupExportJobs.length > 0 ? ("warning" as const) : undefined,
      ctaLabel: followupExportJobs.length ? t("actions.openFollowUp") : t("actions.prepareExport"),
    },
    {
      eyebrow: t("workbench.steps.step3"),
      title: scheduledReportCounts.total ? t("workbench.lanes.recurringLaneTitle") : t("workbench.lanes.createRecurringTitle"),
      description: scheduledReportCounts.total
        ? t("workbench.lanes.recurringLaneDescription", {
            trackedCount: trackedRecurringCount,
            deliveryCount: deliveryConfiguredCount,
          })
        : t("workbench.lanes.createRecurringDescription"),
      href: `${exportsHref}#scheduled-reports`,
      tone: scheduledReportCounts.total > 0 ? undefined : ("warning" as const),
      ctaLabel: scheduledReportCounts.total ? t("actions.manageRecurring") : t("actions.createRecurring"),
    },
  ];
  const operatorShortcutCards = [
    {
      title:
        currentOneOffKind === "usage-ledger"
          ? t("workbench.shortcuts.refineLedgerTitle")
          : currentReportSourceHref
            ? t("workbench.shortcuts.returnToSourceTitle")
            : t("workbench.shortcuts.tightenSourceTitle"),
      description:
        currentOneOffKind === "usage-ledger"
          ? t("workbench.shortcuts.refineLedgerDescription")
          : currentReportSourceHref
            ? t("workbench.shortcuts.returnToSourceDescription")
            : t("workbench.shortcuts.tightenSourceDescription"),
      href: currentReportSourceHref ?? `${exportsHref}#report-spec`,
      badge:
        currentOneOffKind === "usage-ledger"
          ? t("workbench.badge.ledgerScope")
          : currentReportSourceHref
            ? t("workbench.badge.sourceLane")
            : t("workbench.badge.refineSource"),
      className:
        currentOneOffKind === "usage-ledger"
          ? "action-card"
          : currentReportSourceHref
            ? "action-card"
            : "action-card action-card--warning",
      ctaLabel:
        currentOneOffKind === "usage-ledger"
          ? t("actions.refineLedger")
          : currentReportSourceHref
            ? t("actions.openSource")
            : t("actions.refineSpec"),
    },
    {
      title: followupExportJobs.length ? t("workbench.shortcuts.clearFollowUpTitle") : t("workbench.shortcuts.queueNextExportTitle"),
      description: followupExportJobs.length
        ? t("workbench.shortcuts.clearFollowUpDescription", { count: followupExportJobs.length })
        : t("workbench.shortcuts.queueNextExportDescription"),
      href: followupExportJobs.length
        ? `${exportsHref}#operational-follow-up`
        : `${exportsHref}${
            currentOneOffKind === "audit-logs"
              ? "#audit-export-form"
              : currentOneOffKind === "usage-ledger"
                ? "#usage-ledger-export-form"
                : "#usage-export-form"
          }`,
      badge: approvalPendingCount > 0 ? t("workbench.badge.approvalRisk") : followupExportJobs.length ? t("workbench.badge.followUp") : t("workbench.badge.oneOff"),
      className:
        approvalPendingCount > 0
          ? "action-card action-card--critical"
          : followupExportJobs.length
            ? "action-card action-card--warning"
            : "action-card",
      ctaLabel: followupExportJobs.length ? t("actions.openFollowUp") : t("actions.queueExport"),
    },
    {
      title: scheduledReportCounts.total ? t("workbench.shortcuts.keepRecurringHealthyTitle") : t("workbench.shortcuts.turnIntoRecurringTitle"),
      description: scheduledReportCounts.total
        ? t("workbench.shortcuts.keepRecurringHealthyDescription", {
            count: scheduledReportCounts.total,
            deliveryCount: deliveryConfiguredCount,
          })
        : t("workbench.shortcuts.turnIntoRecurringDescription"),
      href: `${exportsHref}#scheduled-reports`,
      badge: scheduledReportCounts.total ? t("workbench.badge.recurring") : t("workbench.badge.automationGap"),
      className: scheduledReportCounts.total ? "action-card" : "action-card action-card--warning",
      ctaLabel: scheduledReportCounts.total ? t("actions.manageRecurring") : t("actions.createRecurring"),
    },
  ];
  const reportSessionBriefCards = [
    {
      label: t("workbench.session.startHere"),
      title:
        currentReportSourceHref
          ? t("workbench.session.reopenSourceTitle")
          : t("workbench.session.tightenScopeTitle"),
      description:
        currentReportSourceHref
          ? t("workbench.session.reopenSourceDescription")
          : t("workbench.session.tightenScopeDescription"),
      href: currentReportSourceHref ?? `${exportsHref}#report-spec`,
      badge: currentReportSourceHref ? t("workbench.badge.openSource") : t("workbench.badge.refineScope"),
      className: currentReportSourceHref ? "action-card" : "action-card action-card--warning",
      ctaLabel: currentReportSourceHref ? t("actions.returnToSource") : t("workbench.cta.refineSource"),
    },
    {
      label: t("workbench.session.watchNext"),
      title:
        followupExportJobs.length > 0
          ? t("workbench.lanes.followUpQueueTitle")
          : scheduledReportCounts.total > 0
            ? t("workbench.shortcuts.keepRecurringHealthyTitle")
            : t("workbench.session.createFirstRecurringTitle"),
      description:
        followupExportJobs.length > 0
          ? t("workbench.session.followUpNeedsAttentionDescription", { count: followupExportJobs.length })
          : scheduledReportCounts.total > 0
            ? t("workbench.session.keepRecurringHealthyDescription")
            : t("workbench.session.createFirstRecurringDescription"),
      href:
        followupExportJobs.length > 0
          ? `${exportsHref}#operational-follow-up`
          : `${exportsHref}#scheduled-reports`,
      badge:
        approvalPendingCount > 0
          ? t("workbench.badge.approvalRisk")
          : followupExportJobs.length > 0
            ? t("workbench.badge.followUp")
            : scheduledReportCounts.total > 0
              ? t("workbench.badge.recurring")
              : t("workbench.badge.automationGap"),
      className:
        approvalPendingCount > 0
          ? "action-card action-card--critical"
          : followupExportJobs.length > 0 || !scheduledReportCounts.total
            ? "action-card action-card--warning"
            : "action-card",
      ctaLabel:
        followupExportJobs.length > 0
          ? t("actions.openFollowUp")
          : scheduledReportCounts.total > 0
            ? t("actions.reviewRecurring")
            : t("actions.createRecurring"),
    },
    {
      label: t("workbench.session.beforeHandoff"),
      title: t("workbench.session.leaveLaneTrustableTitle"),
      description:
        ownerlessFollowupCount > 0
          ? t("workbench.session.ownerGapDescription", { count: ownerlessFollowupCount })
          : t("workbench.session.handoffDescription"),
      href: `${exportsHref}#operational-follow-up`,
      badge: ownerlessFollowupCount > 0 ? t("workbench.badge.ownerGap") : t("workbench.badge.handoff"),
      className: ownerlessFollowupCount > 0 ? "action-card action-card--warning" : "action-card",
      ctaLabel: t("actions.checkHandoff"),
    },
  ];
  const nextMoveCards = [
    ...reportSessionBriefCards.map((card) => ({
      label: card.label,
      title: card.title,
      description: card.description,
      href: card.href,
      badge: card.badge,
      className: card.className,
      ctaLabel: card.ctaLabel,
    })),
    ...operatorShortcutCards.map((card) => ({
      label: card.badge,
      title: card.title,
      description: card.description,
      href: card.href,
      badge: card.ctaLabel,
      className: card.className,
      ctaLabel: card.ctaLabel,
    })),
  ];
  const mobileFocusCards = selectedWorkspaceId ? nextMoveCards.slice(0, 3) : [];

  return (
    <AppShell
      headerMode="compact"
      sidebarVariant="minimal"
      showOperatorContextCards={false}
      showSupportPanels={false}
      title={t("page.title")}
      subtitle=""
      workspaceId={selectedWorkspaceId}
      workspaceLabel={selectedWorkspace ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}` : null}
    >
      <section className="legacy-grid">
        {exportsIssue ? (
          <ControlApiStatusCard
            issue={exportsIssue}
            heading={
              selectedWorkspaceId
                ? t("workspace.partialData")
                : t("workspace.contextUnavailable")
            }
          />
        ) : null}

        {selectedWorkspaceId ? (
          <>
            <article className="card span-12 order-5" id="report-spec">
              <div className="summary-row">
                <div className="cell-stack">
                  <h2>{t("oneOff.title")}</h2>
                  <p>
                    {locale === "zh"
                      ? "先确认当前范围，再发起一次性导出。周期任务和交接项收在下方。"
                      : "Confirm the current scope, then queue a one-off export. Recurring schedules and handoff stay below."}
                  </p>
                </div>
                <div className="badge-row">
                  <span className="tag">{selectedReportTemplate ? selectedReportTemplate.replace(/-/g, " ") : translateInlineText(locale, "custom")}</span>
                  <span className="tag">{formatExportKindLabel(currentOneOffKind, t)}</span>
                  <span className="tag">{formatExportFormatLabel(currentReportFormat, locale)}</span>
                  <span className="tag">
                    {currentOneOffKind === "usage-ledger" ? t("labels.cadence.adhoc") : formatExportCadenceLabel(currentReportCadence, t)}
                  </span>
                </div>
              </div>

              <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,auto)] xl:items-start">
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-1 border-t border-black/8 pt-3">
                    <dt className="meta">{t("reportSpec.sourceScope")}</dt>
                    <dd className="text-[1.05rem] font-semibold text-[#1f1d1a]">{currentReportScopeLabel}</dd>
                  </div>
                  <div className="space-y-1 border-t border-black/8 pt-3">
                    <dt className="meta">{t("reportSpec.focus")}</dt>
                    <dd className="text-[1.05rem] font-semibold text-[#1f1d1a]">{currentReportFocusLabel}</dd>
                  </div>
                  <div className="space-y-1 border-t border-black/8 pt-3">
                    <dt className="meta">{t("reportSpec.storedFilters")}</dt>
                    <dd className="text-[1.05rem] font-semibold text-[#1f1d1a]">{currentReportStoredFilterCount}</dd>
                  </div>
                  <div className="space-y-1 border-t border-black/8 pt-3">
                    <dt className="meta">
                      {currentOneOffKind === "usage-ledger" ? t("reportSpec.recurringSupport") : t("reportSpec.nextCadence")}
                    </dt>
                    <dd className="text-[1.05rem] font-semibold text-[#1f1d1a]">
                      {currentOneOffKind === "usage-ledger" ? t("reportSpec.adHocOnly") : formatExportCadenceLabel(currentReportCadence, t)}
                    </dd>
                  </div>
                </dl>

                <div className="space-y-3 xl:justify-self-end xl:text-right">
                  <div className="cell-stack xl:items-end">
                    <strong>{t("actions.applyExport")}</strong>
                    <span className="meta">{t("oneOff.description")}</span>
                  </div>
                  <div className="inline-actions xl:justify-end">
                    <a className={currentOneOffKind === "usage-ledger" ? "button" : "button button--ghost"} href="#usage-ledger-export-form">
                      {t("oneOff.usageLedger")}
                    </a>
                    <a className={currentOneOffKind === "usage-events" ? "button" : "button button--ghost"} href="#usage-export-form">
                      {t("oneOff.usageExport")}
                    </a>
                    <a className={currentOneOffKind === "audit-logs" ? "button" : "button button--ghost"} href="#audit-export-form">
                      {t("oneOff.auditExport")}
                    </a>
                  </div>
                  <div className="inline-actions xl:justify-end">
                    {currentReportSourceHref ? (
                      <a className="button button--ghost" href={currentReportSourceHref}>
                        {t("actions.openSource")}
                      </a>
                    ) : null}
                    <a className="button button--ghost" href="#scheduled-reports">
                      {t("actions.reviewRecurring")}
                    </a>
                  </div>
                </div>
              </div>

              {activeReportFilterChips.length ? (
                <div className="filter-chip-row mt-5">
                  {activeReportFilterChips.map((chip) => (
                    <a key={`${chip.label}-${chip.value}`} className="filter-chip" href={chip.href}>
                      <span className="filter-chip__label">{chip.label}</span>
                      <span className="filter-chip__value">{chip.value}</span>
                      <span className="filter-chip__remove">{t("actions.clear")}</span>
                    </a>
                  ))}
                </div>
              ) : null}
            </article>

            <details className="card span-12 order-10 fold-section" id="export-secondary-surfaces">
              <summary>
                {t("secondary.title")}
                <span>{t("secondary.description")}</span>
              </summary>
              <div className="fold-section__body">
                <details className="card span-12 order-11 fold-section" id="export-status">
                  <summary>
                    {t("templates.sectionTitle")}
                    <span>{t("templates.sectionDescription")}</span>
                  </summary>
                  <div className="fold-section__body">
                    <ReportTemplateGrid
                      templates={reportTemplates}
                      recurringPresets={recurringPresets}
                      activeTemplateId={selectedReportTemplate || null}
                      activeCadence={selectedReportCadence || null}
                      locale={locale}
                    />
                  </div>
                </details>

            <article className="card span-12 order-11" id="scheduled-reports">
              <div className="summary-row">
                <div>
                  <h2>{t("scheduled.title")}</h2>
                  <p>
                    {currentOneOffKind === "usage-ledger"
                      ? t("scheduled.adhocLedgerOnly")
                      : t("scheduled.description")}
                  </p>
                </div>
                <span className="tag">{scheduledReportCounts.total} scheduled</span>
              </div>
              <div className="metric-grid">
                <div className="metric-card">
                  <span className="meta">{t("labels.cadence.daily")}</span>
                  <strong>{scheduledReportCounts.daily}</strong>
                </div>
                <div className="metric-card">
                  <span className="meta">{t("labels.cadence.weekly")}</span>
                  <strong>{scheduledReportCounts.weekly}</strong>
                </div>
                <div className="metric-card">
                  <span className="meta">{t("labels.cadence.monthly")}</span>
                  <strong>{scheduledReportCounts.monthly}</strong>
                </div>
                <div className="metric-card">
                  <span className="meta">{t("workbench.metrics.nextRun")}</span>
                  <strong>{nextScheduledRun ? formatDateTime(nextScheduledRun.nextRunAt) : "No schedule yet"}</strong>
                </div>
              </div>
              {scheduledReportsIssue ? (
                <ControlApiStatusCard
                  issue={scheduledReportsIssue}
                  heading={t("scheduled.unavailable")}
                  mode="inline"
                />
              ) : null}
              {!scheduledReportsIssue ? (
                <details className="fold-section" open={scheduledReportCards.length === 0 ? true : undefined}>
                  <summary>
                    {t("actions.createRecurring")}
                    <span>{t("scheduled.createDescription")}</span>
                  </summary>
                  <div className="fold-section__body">
                <form className="toolbar toolbar--stacked" action={createScheduledReportAction}>
                  <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                  <input name="currentPath" type="hidden" value={exportsHref} />
                  {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                  {selectedReportTemplate ? <input name="reportTemplate" type="hidden" value={selectedReportTemplate} /> : null}
                  {selectedReportCadence ? <input name="reportCadence" type="hidden" value={selectedReportCadence} /> : null}
                  <input name="filtersJson" type="hidden" value={JSON.stringify(currentScheduleFilters)} />
                  <div className="toolbar__row">
                    <div className="field field--inline">
                      <label htmlFor="scheduled-report-name">Report name</label>
                      <input
                        defaultValue={
                          selectedReportTemplate
                            ? selectedReportTemplate.replace(/-/g, " ")
                            : currentScheduleKind === "audit-logs"
                              ? "audit governance report"
                              : "usage operations report"
                        }
                        id="scheduled-report-name"
                        name="name"
                        placeholder="Weekly leadership export"
                      />
                    </div>
                    <div className="field field--inline">
                      <label htmlFor="scheduled-report-kind">{t("queue.columns.kind")}</label>
                      <select id="scheduled-report-kind" name="kind" defaultValue={currentScheduleKind}>
                        <option value="usage-events">usage-events</option>
                        <option value="audit-logs">audit-logs</option>
                      </select>
                    </div>
                    <div className="field field--inline">
                      <label htmlFor="scheduled-report-format">Format</label>
                      <select id="scheduled-report-format" name="format" defaultValue={currentReportFormat}>
                        <option value="csv">csv</option>
                        <option value="xlsx">xlsx</option>
                      </select>
                    </div>
                    <div className="field field--inline">
                      <label htmlFor="scheduled-report-cadence">Cadence</label>
                      <select id="scheduled-report-cadence" name="cadence" defaultValue={selectedReportCadence || "weekly"}>
                        <option value="daily">daily</option>
                        <option value="weekly">weekly</option>
                        <option value="monthly">monthly</option>
                      </select>
                    </div>
                  </div>
                  <details className="fold-section">
                    <summary>
                      {t("scheduled.deliveryChannelsTitle")}
                      <span>Email, Slack, Feishu, and webhook targets</span>
                    </summary>
                    <div className="fold-section__body">
                      <div className="form-grid form-grid--inline">
                        <div className="field">
                          <label htmlFor="delivery-email-targets">{t("scheduled.emailRecipients")}</label>
                          <textarea
                            id="delivery-email-targets"
                            name="deliveryEmailTargets"
                            placeholder="finance@example.com, ops@example.com"
                            rows={3}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="delivery-slack-targets">{t("scheduled.slackWebhooks")}</label>
                          <textarea
                            id="delivery-slack-targets"
                            name="deliverySlackTargets"
                            placeholder="https://hooks.slack.com/services/..."
                            rows={3}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="delivery-feishu-targets">{t("scheduled.feishuWebhooks")}</label>
                          <textarea
                            id="delivery-feishu-targets"
                            name="deliveryFeishuTargets"
                            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                            rows={3}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="delivery-webhook-targets">{t("scheduled.webhookTargets")}</label>
                          <textarea
                            id="delivery-webhook-targets"
                            name="deliveryWebhookTargets"
                            placeholder="https://ops.example.com/hooks/export"
                            rows={3}
                          />
                        </div>
                      </div>
                    </div>
                  </details>
                  <details className="fold-section">
                    <summary>
                      {t("scheduled.governanceTitle")}
                      <span>Payload, triggers, approvals, watermark, retention</span>
                    </summary>
                    <div className="fold-section__body">
                      <div className="form-grid form-grid--inline">
                        <div className="field">
                          <label htmlFor="delivery-include-download-link">{t("scheduled.deliveryPayload")}</label>
                          <select id="delivery-include-download-link" name="deliveryIncludeDownloadLink" defaultValue="yes">
                            <option value="yes">Include download link when allowed</option>
                            <option value="no">Notify only without link</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="delivery-include-signed-snapshot">{t("scheduled.signedSnapshotInDelivery")}</label>
                          <select
                            id="delivery-include-signed-snapshot"
                            name="deliveryIncludeSignedSnapshot"
                            defaultValue={defaultScheduledSignedSnapshot ? "yes" : "no"}
                          >
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="event-trigger-scope">{t("scheduled.eventTriggerScope")}</label>
                          <select id="event-trigger-scope" name="eventTriggerScope" defaultValue="report-scope">
                            <option value="report-scope">Only events inside this report scope</option>
                            <option value="workspace">Any workspace event can trigger it</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="event-trigger-cooldown">{t("scheduled.triggerCooldown")}</label>
                          <input
                            id="event-trigger-cooldown"
                            name="eventTriggerCooldownMinutes"
                            type="number"
                            min="0"
                            defaultValue="60"
                          />
                        </div>
                      </div>
                      <div className="form-grid form-grid--inline">
                        <div className="field">
                          <span className="meta">{t("scheduled.eventDrivenRuns")}</span>
                          <label>
                            <input
                              type="checkbox"
                              name="eventTriggerEvent"
                              value="budget-alert-opened"
                            />{" "}
                            {t("scheduled.budgetAlertOpened")}
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              name="eventTriggerEvent"
                              value="export-job-failed"
                              defaultChecked={defaultOpsEventTrigger}
                            />{" "}
                            {t("scheduled.exportJobFailed")}
                          </label>
                        </div>
                        <div className="field">
                          <label htmlFor="approval-mode">{t("followup.approval")}</label>
                          <select id="approval-mode" name="approvalMode" defaultValue={defaultScheduledApprovalMode}>
                            <option value="none">No approval gate</option>
                            <option value="required">Approval required before download</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="watermark-label">{t("scheduled.watermarkLabel")}</label>
                          <input
                            id="watermark-label"
                            name="watermarkLabel"
                            defaultValue={selectedReportTemplate === "monthly-qa" ? "internal-review" : ""}
                            placeholder="internal-review"
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="retention-days">{t("scheduled.retentionDays")}</label>
                          <input
                            id="retention-days"
                            name="retentionDays"
                            type="number"
                            min="1"
                            defaultValue={defaultScheduledRetentionDays}
                            placeholder="365"
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="signed-snapshot">{t("scheduled.signedSnapshot")}</label>
                          <select id="signed-snapshot" name="signedSnapshot" defaultValue={defaultScheduledSignedSnapshot ? "yes" : "no"}>
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </details>
                  <div className="toolbar__actions">
                    <button className="button" type="submit">
                      {t("actions.createRecurring")}
                    </button>
                    {currentReportSourceHref ? (
                      <a className="button button--ghost" href={currentReportSourceHref}>
                        {t("actions.openSource")}
                      </a>
                    ) : null}
                    <a
                      className="button button--ghost"
                      href={
                        currentOneOffKind === "audit-logs"
                          ? "#audit-export-form"
                          : currentOneOffKind === "usage-ledger"
                            ? "#usage-ledger-export-form"
                            : "#usage-export-form"
                      }
                    >
                      {t("actions.applyExport")}
                    </a>
                    <span className="meta">{t("scheduled.firstRunNotice")}</span>
                  </div>
                  <div className="notice">
                    <p>
                      Slack, Feishu, and generic webhook deliveries dispatch from the export-worker after files complete. {t("scheduled.emailRecipients")}
                      are stored on the report object for governance handoff until a mail transport is configured.
                    </p>
                  </div>
                </form>
                  </div>
                </details>
              ) : null}
              {!scheduledReportsIssue && scheduledReportCards.length ? (
                <div className="stack">
                  {scheduledReportCards.map((card) => (
                    <div key={card.report.id} id={`scheduled-report-${card.report.id}`} className="resource-card">
                      <div className="resource-card__header">
                        <div className="cell-stack">
                          <strong>{card.report.name}</strong>
                          <span className="meta">
                            {card.report.kind} · {card.report.format} · next run {formatDateTime(card.report.nextRunAt)}
                          </span>
                          <span className="meta">
                            {card.report.lastRunAt ? `Last run ${formatDateTime(card.report.lastRunAt)}` : "Has not run yet"}
                          </span>
                          <span className="meta">
                            {card.scopeLabel} · {card.focusLabel}
                          </span>
                        </div>
                        <div className="badge-row">
                          <span className={card.statusTag.className}>{card.statusTag.label}</span>
                          <span className="tag">{card.report.cadence}</span>
                          <span className="tag">
                            {locale === "zh" ? `${card.storedFilterCount} 个筛选` : `${card.storedFilterCount} filters`}
                          </span>
                        </div>
                      </div>
                      <div className="metric-grid metric-grid--compact">
                        <div className="metric-card">
                          <span className="meta">{locale === "zh" ? "已生成文件" : "Generated files"}</span>
                          <strong>{card.jobSummary.counts.totalCount}</strong>
                        </div>
                        <div className="metric-card">
                          <span className="meta">{t("labels.jobStatus.completed")}</span>
                          <strong>{card.jobSummary.counts.completedCount}</strong>
                        </div>
                        <div className="metric-card">
                          <span className="meta">{t("labels.jobStatus.failed")}</span>
                          <strong>{card.jobSummary.counts.failedCount}</strong>
                        </div>
                        <div className="metric-card">
                          <span className="meta">Latest activity</span>
                          <strong>{card.latestJobLabel}</strong>
                        </div>
                        <div className="metric-card">
                          <span className="meta">{t("queue.columns.delivery")}</span>
                          <strong>{card.distributionSummary}</strong>
                        </div>
                        <div className="metric-card">
                          <span className="meta">Event trigger</span>
                          <strong>{card.eventTriggerSummary}</strong>
                        </div>
                        <div className="metric-card">
                          <span className="meta">Governance</span>
                          <strong>{card.governanceSummary}</strong>
                        </div>
                      </div>
                      <div className="inline-actions">
                        <form action={triggerScheduledReportAction}>
                          <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                          <input name="currentPath" type="hidden" value={exportsHref} />
                          {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                          {selectedReportTemplate ? <input name="reportTemplate" type="hidden" value={selectedReportTemplate} /> : null}
                          {selectedReportCadence ? <input name="reportCadence" type="hidden" value={selectedReportCadence} /> : null}
                          {selectedJobKind ? <input name="jobKind" type="hidden" value={selectedJobKind} /> : null}
                          {selectedJobStatus ? <input name="jobStatus" type="hidden" value={selectedJobStatus} /> : null}
                          {selectedJobQuery ? <input name="jobQuery" type="hidden" value={selectedJobQuery} /> : null}
                          <input name="kind" type="hidden" value={card.report.kind} />
                          <input name="scheduledReportId" type="hidden" value={card.report.id} />
                          <button className="button button--ghost" type="submit">
                            {t("actions.runNow")}
                          </button>
                        </form>
                        <a className="button button--ghost" href={card.sourceHref}>
                          Source
                        </a>
                        <a className="button button--ghost" href={card.queueHref}>
                          Jobs
                        </a>
                        <a className="button button--ghost" href={card.auditHref}>
                          Audit
                        </a>
                      </div>
                      {card.latestFailureMessage ? (
                        <div className="notice notice--error">
                          <div className="cell-stack">
                            <strong>{t("scheduled.latestFailure")}</strong>
                            <span className="meta">{card.latestFailureMessage}</span>
                          </div>
                        </div>
                      ) : null}
                      <details className="fold-section">
                        <summary>
                          {t("scheduled.editTitle")}
                          <span>{t("scheduled.editDescription")}</span>
                        </summary>
                        <div className="fold-section__body">
                      <form className="toolbar toolbar--stacked" action={saveScheduledReportAction}>
                        <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                        <input name="currentPath" type="hidden" value={exportsHref} />
                        {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                        {selectedReportTemplate ? <input name="reportTemplate" type="hidden" value={selectedReportTemplate} /> : null}
                        {selectedReportCadence ? <input name="reportCadence" type="hidden" value={selectedReportCadence} /> : null}
                        <input name="scheduledReportId" type="hidden" value={card.report.id} />
                        <input name="existingFiltersJson" type="hidden" value={JSON.stringify(card.report.filters)} />
                        <input name="previousFiltersJson" type="hidden" value={JSON.stringify(card.report.filters)} />
                        <input name="usageFiltersJson" type="hidden" value={JSON.stringify(currentUsageScheduleFilters)} />
                        <input name="auditFiltersJson" type="hidden" value={JSON.stringify(currentAuditScheduleFilters)} />
                        <input name="previousKind" type="hidden" value={card.report.kind} />
                        <input name="previousName" type="hidden" value={card.report.name} />
                        <input name="previousFormat" type="hidden" value={card.report.format} />
                        <input name="previousCadence" type="hidden" value={card.report.cadence} />
                        <div className="toolbar__row">
                          <div className="field field--inline">
                            <label htmlFor={`scheduled-edit-name-${card.report.id}`}>{t("shared.name")}</label>
                            <input
                              id={`scheduled-edit-name-${card.report.id}`}
                              name="name"
                              defaultValue={card.report.name}
                              required
                            />
                          </div>
                          <div className="field field--inline">
                            <label htmlFor={`scheduled-edit-kind-${card.report.id}`}>{t("queue.columns.kind")}</label>
                            <select id={`scheduled-edit-kind-${card.report.id}`} name="kind" defaultValue={card.report.kind}>
                              <option value="usage-events">usage-events</option>
                              <option value="audit-logs">audit-logs</option>
                            </select>
                          </div>
                          <div className="field field--inline">
                            <label htmlFor={`scheduled-edit-format-${card.report.id}`}>Format</label>
                            <select id={`scheduled-edit-format-${card.report.id}`} name="format" defaultValue={card.report.format}>
                              <option value="csv">csv</option>
                              <option value="xlsx">xlsx</option>
                            </select>
                          </div>
                          <div className="field field--inline">
                            <label htmlFor={`scheduled-edit-cadence-${card.report.id}`}>Cadence</label>
                            <select id={`scheduled-edit-cadence-${card.report.id}`} name="cadence" defaultValue={card.report.cadence}>
                              <option value="daily">daily</option>
                              <option value="weekly">weekly</option>
                              <option value="monthly">monthly</option>
                            </select>
                          </div>
                          <div className="field field--inline">
                            <label htmlFor={`scheduled-edit-filters-${card.report.id}`}>Filters</label>
                            <select id={`scheduled-edit-filters-${card.report.id}`} name="filterSource" defaultValue="existing">
                              <option value="existing">{t("scheduled.keepExistingFilters")}</option>
                              <option value="current">{t("scheduled.replaceCurrentFilters")}</option>
                            </select>
                          </div>
                        </div>
                        <details className="fold-section">
                          <summary>
                            {t("scheduled.deliveryChannelsTitle")}
                            <span>Email, Slack, Feishu, and webhook targets</span>
                          </summary>
                          <div className="fold-section__body">
                            <div className="form-grid form-grid--inline">
                              <div className="field">
                                <label htmlFor={`scheduled-edit-email-${card.report.id}`}>{t("scheduled.emailRecipients")}</label>
                                <textarea
                                  id={`scheduled-edit-email-${card.report.id}`}
                                  name="deliveryEmailTargets"
                                  defaultValue={getDistributionTargetsByChannel(card.distribution, "email")}
                                  rows={3}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-slack-${card.report.id}`}>{t("scheduled.slackWebhooks")}</label>
                                <textarea
                                  id={`scheduled-edit-slack-${card.report.id}`}
                                  name="deliverySlackTargets"
                                  defaultValue={getDistributionTargetsByChannel(card.distribution, "slack")}
                                  rows={3}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-feishu-${card.report.id}`}>{t("scheduled.feishuWebhooks")}</label>
                                <textarea
                                  id={`scheduled-edit-feishu-${card.report.id}`}
                                  name="deliveryFeishuTargets"
                                  defaultValue={getDistributionTargetsByChannel(card.distribution, "feishu")}
                                  rows={3}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-webhook-${card.report.id}`}>{t("scheduled.webhookTargets")}</label>
                                <textarea
                                  id={`scheduled-edit-webhook-${card.report.id}`}
                                  name="deliveryWebhookTargets"
                                  defaultValue={getDistributionTargetsByChannel(card.distribution, "webhook")}
                                  rows={3}
                                />
                              </div>
                            </div>
                          </div>
                        </details>
                        <details className="fold-section">
                          <summary>
                            {t("scheduled.governanceTitle")}
                            <span>Payload, triggers, approvals, watermark, and retention</span>
                          </summary>
                          <div className="fold-section__body">
                            <div className="form-grid form-grid--inline">
                              <div className="field">
                                <label htmlFor={`scheduled-edit-delivery-link-${card.report.id}`}>{t("scheduled.deliveryPayload")}</label>
                                <select
                                  id={`scheduled-edit-delivery-link-${card.report.id}`}
                                  name="deliveryIncludeDownloadLink"
                                  defaultValue={card.distribution?.includeDownloadLink === false ? "no" : "yes"}
                                >
                                  <option value="yes">Include download link when allowed</option>
                                  <option value="no">Notify only without link</option>
                                </select>
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-delivery-signed-${card.report.id}`}>{t("scheduled.signedSnapshotInDelivery")}</label>
                                <select
                                  id={`scheduled-edit-delivery-signed-${card.report.id}`}
                                  name="deliveryIncludeSignedSnapshot"
                                  defaultValue={card.distribution?.includeSignedSnapshot ? "yes" : "no"}
                                >
                                  <option value="no">No</option>
                                  <option value="yes">Yes</option>
                                </select>
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-trigger-scope-${card.report.id}`}>{t("scheduled.eventTriggerScope")}</label>
                                <select
                                  id={`scheduled-edit-trigger-scope-${card.report.id}`}
                                  name="eventTriggerScope"
                                  defaultValue={card.eventTrigger?.scope ?? "report-scope"}
                                >
                                  <option value="report-scope">Only events inside this report scope</option>
                                  <option value="workspace">Any workspace event can trigger it</option>
                                </select>
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-trigger-cooldown-${card.report.id}`}>{t("scheduled.triggerCooldown")}</label>
                                <input
                                  id={`scheduled-edit-trigger-cooldown-${card.report.id}`}
                                  name="eventTriggerCooldownMinutes"
                                  type="number"
                                  min="0"
                                  defaultValue={card.eventTrigger?.cooldownMinutes ?? 60}
                                />
                              </div>
                            </div>
                            <div className="form-grid form-grid--inline">
                              <div className="field">
                                <span className="meta">{t("scheduled.eventDrivenRuns")}</span>
                                <label>
                                  <input
                                    type="checkbox"
                                    name="eventTriggerEvent"
                                    value="budget-alert-opened"
                                    defaultChecked={Boolean(card.eventTrigger?.events.includes("budget-alert-opened"))}
                                  />{" "}
                                  {t("scheduled.budgetAlertOpened")}
                                </label>
                                <label>
                                  <input
                                    type="checkbox"
                                    name="eventTriggerEvent"
                                    value="export-job-failed"
                                    defaultChecked={Boolean(card.eventTrigger?.events.includes("export-job-failed"))}
                                  />{" "}
                                  {t("scheduled.exportJobFailed")}
                                </label>
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-approval-${card.report.id}`}>{t("followup.approval")}</label>
                                <select
                                  id={`scheduled-edit-approval-${card.report.id}`}
                                  name="approvalMode"
                                  defaultValue={card.governance?.approvalMode ?? "none"}
                                >
                                  <option value="none">No approval gate</option>
                                  <option value="required">Approval required before download</option>
                                </select>
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-watermark-${card.report.id}`}>{t("scheduled.watermarkLabel")}</label>
                                <input
                                  id={`scheduled-edit-watermark-${card.report.id}`}
                                  name="watermarkLabel"
                                  defaultValue={card.governance?.watermarkLabel ?? ""}
                                  placeholder="internal-review"
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-retention-${card.report.id}`}>{t("scheduled.retentionDays")}</label>
                                <input
                                  id={`scheduled-edit-retention-${card.report.id}`}
                                  name="retentionDays"
                                  type="number"
                                  min="1"
                                  defaultValue={card.governance?.retentionDays ?? ""}
                                  placeholder="365"
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`scheduled-edit-signed-${card.report.id}`}>{t("scheduled.signedSnapshot")}</label>
                                <select
                                  id={`scheduled-edit-signed-${card.report.id}`}
                                  name="signedSnapshot"
                                  defaultValue={card.governance?.signedSnapshot ? "yes" : "no"}
                                >
                                  <option value="no">No</option>
                                  <option value="yes">Yes</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        </details>
                        <div className="toolbar__actions">
                          <button className="button button--ghost button--micro" type="submit">
                            Update object
                          </button>
                        </div>
                      </form>
                      <div className="button-row">
                        <form action={deleteScheduledReportAction}>
                          <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                          <input name="currentPath" type="hidden" value={exportsHref} />
                          {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                          {selectedReportTemplate ? <input name="reportTemplate" type="hidden" value={selectedReportTemplate} /> : null}
                          {selectedReportCadence ? <input name="reportCadence" type="hidden" value={selectedReportCadence} /> : null}
                          <input name="kind" type="hidden" value={card.report.kind} />
                          <input name="scheduledReportId" type="hidden" value={card.report.id} />
                          <button className="button button--ghost button--micro" type="submit">
                            Delete object
                          </button>
                        </form>
                      </div>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              ) : !scheduledReportsIssue ? (
                <EmptyState
                  compact
                  description="Create a report."
                  title="No scheduled reports yet"
                />
              ) : null}
            </article>

            <article
              className={`card span-6 order-7${currentOneOffKind === "usage-ledger" ? " card--highlight" : ""}`}
              id="usage-ledger-export-form"
            >
              <details className="fold-section" open={currentOneOffKind === "usage-ledger" ? true : undefined}>
                <summary>
                  {t("oneOff.usageLedger")} export
                  <span>{t("forms.usageLedger.description")}</span>
                </summary>
                <div className="fold-section__body">
              <form className="form-grid" action={createUsageLedgerExportAction}>
                <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                <input name="currentPath" type="hidden" value={exportsHref} />
                <input name="kind" type="hidden" value="usage-ledger" />
                {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                {selectedJobKind ? <input name="jobKind" type="hidden" value={selectedJobKind} /> : null}
                {selectedJobStatus ? <input name="jobStatus" type="hidden" value={selectedJobStatus} /> : null}
                {selectedJobQuery ? <input name="jobQuery" type="hidden" value={selectedJobQuery} /> : null}

                <div className="metric-grid metric-grid--compact">
                  <div className="metric-card">
                    <span className="meta">{t("forms.usageLedger.schema")}</span>
                    <strong>usage-ledger.v1</strong>
                  </div>
                  <div className="metric-card">
                    <span className="meta">{t("forms.usageLedger.bestForLabel")}</span>
                    <strong>burn rate / chargeback</strong>
                  </div>
                  <div className="metric-card">
                    <span className="meta">{t("forms.usageLedger.grainLabel")}</span>
                    <strong>1 ledger row per usage event</strong>
                  </div>
                  <div className="metric-card">
                    <span className="meta">Recurring</span>
                    <strong>Ad hoc today</strong>
                  </div>
                </div>

                <div className="form-grid form-grid--inline">
                  <div className="field">
                    <label htmlFor="ledger-projectId">Project</label>
                    <select id="ledger-projectId" name="projectId" defaultValue={selectedProjectId ?? ""}>
                      <option value="">{t("forms.allProjects")}</option>
                      {sortedProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                          {project.status === "archived" ? " (archived)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-environmentId">Environment</label>
                    <select id="ledger-environmentId" name="environmentId" defaultValue={selectedEnvironmentId ?? ""}>
                      <option value="">{t("forms.allEnvironments")}</option>
                      {filteredEnvironmentOptions.map((environment) => (
                        <option key={environment.id} value={environment.id}>
                          {environment.name} ({environment.runtime})
                          {environment.status === "archived" ? " · archived" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-provider">Provider</label>
                    <select id="ledger-provider" name="provider" defaultValue={selectedProvider}>
                      <option value="">{t("forms.allProviders")}</option>
                      {providerOptions.map((provider) => (
                        <option key={provider} value={provider}>
                          {provider}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-outcome">Outcome</label>
                    <select id="ledger-outcome" name="outcome" defaultValue={selectedOutcome}>
                      <option value="">{t("forms.allOutcomes")}</option>
                      <option value="attention">{t("labels.outcome.attention")}</option>
                      <option value="success">success</option>
                      <option value="error">error</option>
                      <option value="blocked">blocked</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-sortBy">{t("forms.sortBy")}</label>
                    <select id="ledger-sortBy" name="sortBy" defaultValue={selectedSortBy}>
                      <option value="newest">{t("forms.sort.newest")}</option>
                      <option value="oldest">{t("forms.sort.oldest")}</option>
                      <option value="cost_desc">{t("forms.sort.costDesc")}</option>
                      <option value="tokens_desc">{t("forms.sort.tokensDesc")}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-format">Format</label>
                    <select id="ledger-format" name="format" defaultValue={getSingleValue(resolvedSearchParams.usageFormat) || "xlsx"}>
                      <option value="xlsx">xlsx</option>
                      <option value="csv">csv</option>
                    </select>
                  </div>
                </div>

                <div className="form-grid form-grid--inline">
                  <div className="field">
                    <label htmlFor="ledger-owner">Owner</label>
                    <input
                      id="ledger-owner"
                      name="owner"
                      defaultValue={selectedOwner}
                      placeholder="team lead / service owner"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-canonicalModel">{t("reportFilters.canonicalModel")}</label>
                    <input
                      id="ledger-canonicalModel"
                      name="canonicalModel"
                      defaultValue={selectedCanonicalModel}
                      placeholder="gpt-4.1 / claude-sonnet-4"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-virtualKeyId">{t("forms.virtualKeyId")}</label>
                    <input
                      id="ledger-virtualKeyId"
                      name="virtualKeyId"
                      defaultValue={getSingleValue(resolvedSearchParams.virtualKeyId)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-providerConnectionId">Provider connection ID</label>
                    <input
                      id="ledger-providerConnectionId"
                      name="providerConnectionId"
                      defaultValue={getSingleValue(resolvedSearchParams.providerConnectionId)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-budgetPolicyId">{t("forms.budgetPolicyId")}</label>
                    <input
                      id="ledger-budgetPolicyId"
                      name="budgetPolicyId"
                      defaultValue={getSingleValue(resolvedSearchParams.budgetPolicyId)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-fileName">{t("forms.fileName")}</label>
                    <input
                      id="ledger-fileName"
                      name="fileName"
                      defaultValue={selectedReportTemplate ? `${selectedReportTemplate}-ledger` : ""}
                      placeholder="month-end-chargeback"
                    />
                  </div>
                </div>

                <div className="form-grid form-grid--inline">
                  <div className="field">
                    <label htmlFor="ledger-requestId">{t("forms.gatewayRequestId")}</label>
                    <input
                      id="ledger-requestId"
                      name="requestId"
                      defaultValue={getSingleValue(resolvedSearchParams.requestId)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-providerRequestId">Provider request ID</label>
                    <input
                      id="ledger-providerRequestId"
                      name="providerRequestId"
                      defaultValue={getSingleValue(resolvedSearchParams.providerRequestId)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-from">From</label>
                    <input id="ledger-from" name="from" type="datetime-local" defaultValue={getSingleValue(resolvedSearchParams.from)} />
                  </div>
                  <div className="field">
                    <label htmlFor="ledger-to">To</label>
                    <input id="ledger-to" name="to" type="datetime-local" defaultValue={getSingleValue(resolvedSearchParams.to)} />
                  </div>
                </div>

                <div className="toolbar__actions">
                  <button className="button" type="submit">
                    {t("forms.usageLedger.submit")}
                  </button>
                  <a className="button button--ghost" href="#recent-export-jobs">
                    {t("queue.reviewQueue")}
                  </a>
                  <span className="meta">Choose this surface when you care more about stable finance dimensions than raw request debugging.</span>
                </div>
              </form>
                </div>
              </details>
            </article>

            <article className="card span-6 order-8" id="usage-export-form">
              <details className="fold-section" open={currentOneOffKind === "usage-events" ? true : undefined}>
                <summary>
                  {t("oneOff.usageExport")}
                  <span>{t("forms.usage.description")}</span>
                </summary>
                <div className="fold-section__body">
              <form className="form-grid" action={createUsageExportAction}>
                <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                <input name="currentPath" type="hidden" value={exportsHref} />
                {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                {selectedJobKind ? <input name="jobKind" type="hidden" value={selectedJobKind} /> : null}
                {selectedJobStatus ? <input name="jobStatus" type="hidden" value={selectedJobStatus} /> : null}
                {selectedJobQuery ? <input name="jobQuery" type="hidden" value={selectedJobQuery} /> : null}

                <div className="form-grid form-grid--inline">
                  <div className="field">
                    <label htmlFor="projectId">Project</label>
                    <select id="projectId" name="projectId" defaultValue={selectedProjectId ?? ""}>
                      <option value="">{t("forms.allProjects")}</option>
                      {sortedProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                          {project.status === "archived" ? " (archived)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="environmentId">Environment</label>
                    <select id="environmentId" name="environmentId" defaultValue={selectedEnvironmentId ?? ""}>
                      <option value="">{t("forms.allEnvironments")}</option>
                      {filteredEnvironmentOptions.map((environment) => (
                        <option key={environment.id} value={environment.id}>
                          {environment.name} ({environment.runtime})
                          {environment.status === "archived" ? " · archived" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="virtualKeyId">{t("forms.virtualKeyId")}</label>
                    <input
                      id="virtualKeyId"
                      name="virtualKeyId"
                      defaultValue={getSingleValue(resolvedSearchParams.virtualKeyId)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="providerConnectionId">Provider connection ID</label>
                    <input
                      id="providerConnectionId"
                      name="providerConnectionId"
                      defaultValue={getSingleValue(resolvedSearchParams.providerConnectionId)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="budgetPolicyId">{t("forms.budgetPolicyId")}</label>
                    <input
                      id="budgetPolicyId"
                      name="budgetPolicyId"
                      defaultValue={getSingleValue(resolvedSearchParams.budgetPolicyId)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="provider">Provider</label>
                    <select id="provider" name="provider" defaultValue={selectedProvider}>
                      <option value="">{t("forms.allProviders")}</option>
                      {providerOptions.map((provider) => (
                        <option key={provider} value={provider}>
                          {provider}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-grid form-grid--inline">
                  <div className="field">
                    <label htmlFor="model">Model</label>
                    <input
                      id="model"
                      name="model"
                      defaultValue={getSingleValue(resolvedSearchParams.model)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="outcome">Outcome</label>
                    <select id="outcome" name="outcome" defaultValue={selectedOutcome}>
                      <option value="">{t("forms.allOutcomes")}</option>
                      <option value="attention">{t("labels.outcome.attention")}</option>
                      <option value="success">success</option>
                      <option value="error">error</option>
                      <option value="blocked">blocked</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="surface">{t("reportFilters.callType")}</label>
                    <select id="surface" name="surface" defaultValue={selectedSurface}>
                      <option value="">{t("forms.allCallTypes")}</option>
                      <option value="metadata">{t("forms.callType.metadata")}</option>
                      <option value="streamed">{t("forms.callType.streamed")}</option>
                      <option value="interrupted">{t("forms.callType.interrupted")}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="sortBy">{t("forms.sortBy")}</label>
                    <select id="sortBy" name="sortBy" defaultValue={selectedSortBy}>
                      <option value="newest">{t("forms.sort.newest")}</option>
                      <option value="oldest">{t("forms.sort.oldest")}</option>
                      <option value="latency_desc">{t("forms.sort.latencyDesc")}</option>
                      <option value="cost_desc">{t("forms.sort.costDesc")}</option>
                      <option value="tokens_desc">{t("forms.sort.tokensDesc")}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="usage-format">Format</label>
                    <select
                      id="usage-format"
                      name="format"
                      defaultValue={getSingleValue(resolvedSearchParams.usageFormat) || "csv"}
                    >
                      <option value="csv">csv</option>
                      <option value="xlsx">xlsx</option>
                    </select>
                  </div>
                </div>

                <details className="fold-section">
                  <summary>
                    {t("forms.advancedFilters")}
                    <span>{t("forms.usage.advancedDescription")}</span>
                  </summary>
                  <div className="fold-section__body">
                    <div className="form-grid form-grid--inline">
                      <div className="field">
                        <label htmlFor="requestId">{t("forms.gatewayRequestId")}</label>
                        <input
                          id="requestId"
                          name="requestId"
                          defaultValue={getSingleValue(resolvedSearchParams.requestId)}
                          placeholder="Optional"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="providerRequestId">Provider request ID</label>
                        <input
                          id="providerRequestId"
                          name="providerRequestId"
                          defaultValue={getSingleValue(resolvedSearchParams.providerRequestId)}
                          placeholder="Optional"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="minLatencyMs">{t("forms.minLatency")}</label>
                        <input id="minLatencyMs" name="minLatencyMs" type="number" min="0" defaultValue={selectedMinLatencyMs} placeholder="1000" />
                      </div>
                    </div>

                    <div className="form-grid form-grid--inline">
                      <div className="field">
                        <label htmlFor="usage-from">From</label>
                        <input id="usage-from" name="from" type="datetime-local" defaultValue={getSingleValue(resolvedSearchParams.from)} />
                      </div>
                      <div className="field">
                        <label htmlFor="usage-to">To</label>
                        <input id="usage-to" name="to" type="datetime-local" defaultValue={getSingleValue(resolvedSearchParams.to)} />
                      </div>
                      <div className="field">
                        <label htmlFor="usage-fileName">{t("forms.fileName")}</label>
                        <input
                          id="usage-fileName"
                          name="fileName"
                          defaultValue={kind === "usage-events" ? "usage-export" : ""}
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  </div>
                </details>

                <button className="button" type="submit">
                  {t("forms.usage.submit")}
                </button>
              </form>
                </div>
              </details>
            </article>

            <article className="card span-6 order-9" id="audit-export-form">
              <details className="fold-section" open={currentOneOffKind === "audit-logs" ? true : undefined}>
                <summary>
                  {t("oneOff.auditExport")}
                  <span>{t("forms.audit.description")}</span>
                </summary>
                <div className="fold-section__body">
              <form className="form-grid" action={createAuditExportAction}>
                <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                <input name="currentPath" type="hidden" value={exportsHref} />
                {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                {selectedJobKind ? <input name="jobKind" type="hidden" value={selectedJobKind} /> : null}
                {selectedJobStatus ? <input name="jobStatus" type="hidden" value={selectedJobStatus} /> : null}
                {selectedJobQuery ? <input name="jobQuery" type="hidden" value={selectedJobQuery} /> : null}

                <div className="form-grid form-grid--inline">
                  <div className="field">
                    <label htmlFor="actorType">{t("forms.audit.actorType")}</label>
                    <input
                      id="actorType"
                      name="actorType"
                      defaultValue={getSingleValue(resolvedSearchParams.actorType)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="actorId">{t("forms.audit.actorId")}</label>
                    <input
                      id="actorId"
                      name="actorId"
                      defaultValue={getSingleValue(resolvedSearchParams.actorId)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="audit-projectId">Project</label>
                    <select id="audit-projectId" name="projectId" defaultValue={selectedProjectId ?? ""}>
                      <option value="">{t("forms.allProjects")}</option>
                      {sortedProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                          {project.status === "archived" ? " (archived)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="audit-environmentId">Environment</label>
                    <select id="audit-environmentId" name="environmentId" defaultValue={selectedEnvironmentId ?? ""}>
                      <option value="">{t("forms.allEnvironments")}</option>
                      {filteredEnvironmentOptions.map((environment) => (
                        <option key={environment.id} value={environment.id}>
                          {environment.name} ({environment.runtime})
                          {environment.status === "archived" ? " · archived" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="audit-action">Action</label>
                    <input
                      id="audit-action"
                      name="action"
                      defaultValue={getSingleValue(resolvedSearchParams.action)}
                      placeholder="Optional"
                    />
                  </div>
                </div>

                <details className="fold-section">
                  <summary>
                    {t("forms.advancedFilters")}
                    <span>{t("forms.audit.advancedDescription")}</span>
                  </summary>
                  <div className="fold-section__body">
                    <div className="form-grid form-grid--inline">
                      <div className="field">
                        <label htmlFor="subjectType">{t("forms.audit.subjectType")}</label>
                        <input
                          id="subjectType"
                          name="subjectType"
                          defaultValue={getSingleValue(resolvedSearchParams.subjectType)}
                          placeholder="Optional"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="subjectId">{t("forms.audit.subjectId")}</label>
                        <input
                          id="subjectId"
                          name="subjectId"
                          defaultValue={getSingleValue(resolvedSearchParams.subjectId)}
                          placeholder="Optional"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="audit-format">Format</label>
                        <select
                          id="audit-format"
                          name="format"
                          defaultValue={getSingleValue(resolvedSearchParams.auditFormat) || "csv"}
                        >
                          <option value="csv">csv</option>
                          <option value="xlsx">xlsx</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-grid form-grid--inline">
                      <div className="field">
                        <label htmlFor="audit-from">From</label>
                        <input
                          id="audit-from"
                          name="auditFrom"
                          type="datetime-local"
                          defaultValue={getSingleValue(resolvedSearchParams.from)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="audit-to">To</label>
                        <input
                          id="audit-to"
                          name="auditTo"
                          type="datetime-local"
                          defaultValue={getSingleValue(resolvedSearchParams.to)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="audit-fileName">{t("forms.fileName")}</label>
                        <input
                          id="audit-fileName"
                          name="fileName"
                          defaultValue={kind === "audit-logs" ? "audit-export" : ""}
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  </div>
                </details>

                <button className="button" type="submit">
                  {t("forms.audit.submit")}
                </button>
              </form>
                </div>
              </details>
            </article>

            <article className="card span-12 order-12" id="operational-follow-up">
              <div className="summary-row">
                <div>
                  <h2>{t("followup.title")}</h2>
                  <p>{t("followup.description")}</p>
                </div>
                <span className="tag">{followupExportJobs.length} {t("shared.items")}</span>
              </div>
              {followupExportJobs.length ? (
                <div className="stack">
                  {followupExportJobs.map((entry) => {
                    const sourceCard =
                      entry.scheduledReportMeta ?
                        scheduledReportCardById.get(entry.scheduledReportMeta.scheduledReportId) ?? null
                      : null;
                    const downloadUrl = getExportDownloadUrl(entry.job);
                    const approvalBlocked =
                      entry.governance?.approvalMode === "required" && entry.governance.approvalStatus !== "approved";

                    return (
                      <div key={`followup-${entry.job.id}`} className="resource-card">
                        <div className="resource-card__header">
                          <div className="cell-stack">
                            <strong className="mono mono--wrap" title={entry.job.fileName}>
                              {formatExportFileDisplay(entry.job.fileName)}
                            </strong>
                            <span className="meta">
                              {describeExportScope(entry.job, projectNameById, environmentById, t)} · {describeExportFocus(entry.job.kind, entry.job.filters as Record<string, unknown>, t)}
                            </span>
                            <span className="meta">
                              {entry.scheduledReportMeta
                                ? `${locale === "zh" ? "周期任务" : "Recurring"} · ${entry.scheduledReportMeta.scheduledReportName ?? entry.scheduledReportMeta.scheduledReportId}`
                                : t("queue.oneOffExport")}
                            </span>
                          </div>
                          <div className="badge-row">
                            <span className={getExportJobTagClass(entry.job)}>{formatExportJobStatusLabel(entry.job.status, t)}</span>
                            <span className="tag">{entry.workflow?.status ? t(`shared.${entry.workflow.status}`) : t("shared.pending")}</span>
                            {approvalBlocked ? <span className="tag tag--warning">{locale === "zh" ? "待审批" : "approval pending"}</span> : null}
                          </div>
                        </div>
                        <div className="metric-grid metric-grid--compact">
                          <div className="metric-card">
                            <span className="meta">Owner</span>
                            <strong>{entry.workflow?.ownerLabel ?? "Unassigned"}</strong>
                          </div>
                          <div className="metric-card">
                            <span className="meta">SLA</span>
                            <strong>{entry.workflowSlaLabel ?? "No SLA"}</strong>
                          </div>
                          <div className="metric-card">
                            <span className="meta">Distribution</span>
                            <strong>{entry.distributionSummary}</strong>
                          </div>
                          <div className="metric-card">
                            <span className="meta">Governance</span>
                            <strong>{entry.governanceSummary}</strong>
                          </div>
                        </div>
                        <details className="fold-section">
                          <summary>
                            Update owner, SLA, approval, and note
                            <span>{entry.workflow?.ownerLabel ?? "Unassigned"} · {entry.workflow?.status ?? "pending"}</span>
                          </summary>
                          <div className="fold-section__body">
                        {entry.workflow?.note ? (
                          <div className="notice">
                            <p>{entry.workflow.note}</p>
                          </div>
                        ) : null}
                        <form className="toolbar toolbar--stacked" action={updateExportJobFollowupAction}>
                          <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                          <input name="currentPath" type="hidden" value={exportsHref} />
                          <input name="exportJobId" type="hidden" value={entry.job.id} />
                          {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                          {kind ? <input name="kind" type="hidden" value={kind} /> : null}
                          {selectedReportTemplate ? <input name="reportTemplate" type="hidden" value={selectedReportTemplate} /> : null}
                          {selectedReportCadence ? <input name="reportCadence" type="hidden" value={selectedReportCadence} /> : null}
                          {selectedJobKind ? <input name="jobKind" type="hidden" value={selectedJobKind} /> : null}
                          {selectedJobStatus ? <input name="jobStatus" type="hidden" value={selectedJobStatus} /> : null}
                          {selectedJobQuery ? <input name="jobQuery" type="hidden" value={selectedJobQuery} /> : null}
                          {selectedProjectId ? <input name="projectId" type="hidden" value={selectedProjectId} /> : null}
                          {selectedEnvironmentId ? <input name="environmentId" type="hidden" value={selectedEnvironmentId} /> : null}
                          {selectedProvider ? <input name="provider" type="hidden" value={selectedProvider} /> : null}
                          {selectedOutcome ? <input name="outcome" type="hidden" value={selectedOutcome} /> : null}
                          {selectedSurface ? <input name="surface" type="hidden" value={selectedSurface} /> : null}
                          {selectedMinLatencyMs ? <input name="minLatencyMs" type="hidden" value={selectedMinLatencyMs} /> : null}
                          {selectedSortBy ? <input name="sortBy" type="hidden" value={selectedSortBy} /> : null}
                          {getSingleValue(resolvedSearchParams.virtualKeyId) ? (
                            <input name="virtualKeyId" type="hidden" value={getSingleValue(resolvedSearchParams.virtualKeyId)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.providerConnectionId) ? (
                            <input name="providerConnectionId" type="hidden" value={getSingleValue(resolvedSearchParams.providerConnectionId)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.budgetPolicyId) ? (
                            <input name="budgetPolicyId" type="hidden" value={getSingleValue(resolvedSearchParams.budgetPolicyId)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.model) ? (
                            <input name="model" type="hidden" value={getSingleValue(resolvedSearchParams.model)} />
                          ) : null}
                          {selectedCanonicalModel ? (
                            <input name="canonicalModel" type="hidden" value={selectedCanonicalModel} />
                          ) : null}
                          {selectedOwner ? <input name="owner" type="hidden" value={selectedOwner} /> : null}
                          {getSingleValue(resolvedSearchParams.requestId) ? (
                            <input name="requestId" type="hidden" value={getSingleValue(resolvedSearchParams.requestId)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.providerRequestId) ? (
                            <input name="providerRequestId" type="hidden" value={getSingleValue(resolvedSearchParams.providerRequestId)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.from) ? (
                            <input name="from" type="hidden" value={getSingleValue(resolvedSearchParams.from)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.to) ? (
                            <input name="to" type="hidden" value={getSingleValue(resolvedSearchParams.to)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.actorType) ? (
                            <input name="actorType" type="hidden" value={getSingleValue(resolvedSearchParams.actorType)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.actorId) ? (
                            <input name="actorId" type="hidden" value={getSingleValue(resolvedSearchParams.actorId)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.action) ? (
                            <input name="action" type="hidden" value={getSingleValue(resolvedSearchParams.action)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.subjectType) ? (
                            <input name="subjectType" type="hidden" value={getSingleValue(resolvedSearchParams.subjectType)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.subjectId) ? (
                            <input name="subjectId" type="hidden" value={getSingleValue(resolvedSearchParams.subjectId)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.usageFormat) ? (
                            <input name="usageFormat" type="hidden" value={getSingleValue(resolvedSearchParams.usageFormat)} />
                          ) : null}
                          {getSingleValue(resolvedSearchParams.auditFormat) ? (
                            <input name="auditFormat" type="hidden" value={getSingleValue(resolvedSearchParams.auditFormat)} />
                          ) : null}
                          <div className="toolbar__row">
                            <div className="field field--inline">
                              <label htmlFor={`workflow-owner-${entry.job.id}`}>Owner</label>
                              <input
                                id={`workflow-owner-${entry.job.id}`}
                                name="workflowOwnerLabel"
                                defaultValue={entry.workflow?.ownerLabel ?? ""}
                                placeholder="ops lead / finance reviewer"
                              />
                            </div>
                            <div className="field field--inline">
                              <label htmlFor={`workflow-status-${entry.job.id}`}>{t("queue.columns.status")}</label>
                              <select
                                id={`workflow-status-${entry.job.id}`}
                                name="workflowStatus"
                                defaultValue={entry.workflow?.status ?? "pending"}
                              >
                                <option value="pending">pending</option>
                                <option value="acknowledged">acknowledged</option>
                                <option value="in_progress">in_progress</option>
                                <option value="blocked">blocked</option>
                                <option value="completed">completed</option>
                              </select>
                            </div>
                            <div className="field field--inline">
                              <label htmlFor={`workflow-sla-${entry.job.id}`}>SLA due</label>
                              <input
                                id={`workflow-sla-${entry.job.id}`}
                                name="workflowSlaDueAt"
                                type="datetime-local"
                                defaultValue={formatDateTimeLocalInput(entry.workflow?.slaDueAt)}
                              />
                            </div>
                            <div className="field field--inline">
                              <label htmlFor={`approval-status-${entry.job.id}`}>Approval</label>
                              <input type="hidden" name="governanceApprovalMode" value={entry.governance?.approvalMode ?? "none"} />
                              <select
                                id={`approval-status-${entry.job.id}`}
                                name="governanceApprovalStatus"
                                defaultValue={
                                  entry.governance?.approvalMode === "required" ? entry.governance.approvalStatus : "pending"
                                }
                                disabled={entry.governance?.approvalMode !== "required"}
                              >
                                <option value="pending">pending</option>
                                <option value="approved">approved</option>
                              </select>
                            </div>
                            <div className="field field--inline">
                              <label htmlFor={`approval-approver-${entry.job.id}`}>Approver</label>
                              <input
                                id={`approval-approver-${entry.job.id}`}
                                name="governanceApproverLabel"
                                defaultValue={entry.governance?.approverLabel ?? ""}
                                placeholder="finance controller"
                              />
                            </div>
                          </div>
                          <div className="field">
                            <label htmlFor={`workflow-note-${entry.job.id}`}>Follow-up note</label>
                            <textarea
                              id={`workflow-note-${entry.job.id}`}
                              name="workflowNote"
                              defaultValue={entry.workflow?.note ?? ""}
                              rows={3}
                            />
                          </div>
                          <div className="toolbar__actions">
                            <button className="button button--ghost button--micro" type="submit">
                              Save follow-up
                            </button>
                            {downloadUrl && !approvalBlocked ? (
                              <a className="button button--ghost button--micro" href={downloadUrl}>
                                Download
                              </a>
                            ) : approvalBlocked ? (
                              <span className="meta">Download is blocked until approval is marked approved.</span>
                            ) : null}
                            {sourceCard ? (
                              <a className="button button--ghost button--micro" href={`#scheduled-report-${sourceCard.report.id}`}>
                                {t("actions.openSource")} report
                              </a>
                            ) : null}
                          </div>
                        </form>
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState compact description={t("operationalFollowUp.emptyDescription")} title={t("operationalFollowUp.emptyTitle")} />
              )}
            </article>

              </div>
            </details>

            <article className="card span-12 order-2" id="recent-export-jobs">
              <div className="summary-row">
                <div className="cell-stack">
                  <h2>{t("queue.title")}</h2>
                  <p>{queueInterpretation}</p>
                  <span className="meta">
                    {t("queue.workspacePrefix")}: {selectedWorkspace?.organizationName} / {selectedWorkspace?.name}
                  </span>
                </div>
                <div className="button-row">
                  {queueHealthTag ? <span className={queueHealthTag.className}>{queueHealthTag.label}</span> : null}
                  <ExportJobsAutoRefresh pendingCount={exportSummary.pendingCount} runningCount={exportSummary.runningCount} />
                </div>
              </div>

              <form className="toolbar toolbar--stacked" action="/exports" method="get">
                <div className="toolbar__row">
                  <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                  {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                  {selectedProjectId ? <input name="projectId" type="hidden" value={selectedProjectId} /> : null}
                  {selectedEnvironmentId ? <input name="environmentId" type="hidden" value={selectedEnvironmentId} /> : null}
                  {selectedProvider ? <input name="provider" type="hidden" value={selectedProvider} /> : null}
                  {selectedOutcome ? <input name="outcome" type="hidden" value={selectedOutcome} /> : null}
                  {selectedSurface ? <input name="surface" type="hidden" value={selectedSurface} /> : null}
                  {selectedMinLatencyMs ? <input name="minLatencyMs" type="hidden" value={selectedMinLatencyMs} /> : null}
                  {selectedSortBy ? <input name="sortBy" type="hidden" value={selectedSortBy} /> : null}
                  {kind ? <input name="kind" type="hidden" value={kind} /> : null}
                  {getSingleValue(resolvedSearchParams.virtualKeyId) ? (
                    <input name="virtualKeyId" type="hidden" value={getSingleValue(resolvedSearchParams.virtualKeyId)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.providerConnectionId) ? (
                    <input
                      name="providerConnectionId"
                      type="hidden"
                      value={getSingleValue(resolvedSearchParams.providerConnectionId)}
                    />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.budgetPolicyId) ? (
                    <input name="budgetPolicyId" type="hidden" value={getSingleValue(resolvedSearchParams.budgetPolicyId)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.model) ? (
                    <input name="model" type="hidden" value={getSingleValue(resolvedSearchParams.model)} />
                  ) : null}
                  {selectedCanonicalModel ? <input name="canonicalModel" type="hidden" value={selectedCanonicalModel} /> : null}
                  {selectedOwner ? <input name="owner" type="hidden" value={selectedOwner} /> : null}
                  {getSingleValue(resolvedSearchParams.requestId) ? (
                    <input name="requestId" type="hidden" value={getSingleValue(resolvedSearchParams.requestId)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.providerRequestId) ? (
                    <input
                      name="providerRequestId"
                      type="hidden"
                      value={getSingleValue(resolvedSearchParams.providerRequestId)}
                    />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.from) ? (
                    <input name="from" type="hidden" value={getSingleValue(resolvedSearchParams.from)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.to) ? (
                    <input name="to" type="hidden" value={getSingleValue(resolvedSearchParams.to)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.actorType) ? (
                    <input name="actorType" type="hidden" value={getSingleValue(resolvedSearchParams.actorType)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.actorId) ? (
                    <input name="actorId" type="hidden" value={getSingleValue(resolvedSearchParams.actorId)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.action) ? (
                    <input name="action" type="hidden" value={getSingleValue(resolvedSearchParams.action)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.subjectType) ? (
                    <input name="subjectType" type="hidden" value={getSingleValue(resolvedSearchParams.subjectType)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.subjectId) ? (
                    <input name="subjectId" type="hidden" value={getSingleValue(resolvedSearchParams.subjectId)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.usageFormat) ? (
                    <input name="usageFormat" type="hidden" value={getSingleValue(resolvedSearchParams.usageFormat)} />
                  ) : null}
                  {getSingleValue(resolvedSearchParams.auditFormat) ? (
                    <input name="auditFormat" type="hidden" value={getSingleValue(resolvedSearchParams.auditFormat)} />
                  ) : null}

                  <div className="field field--inline">
                    <label htmlFor="jobKind">{t("queue.filters.kind")}</label>
                    <select id="jobKind" name="jobKind" defaultValue={selectedJobKind}>
                      <option value="">{t("queue.allJobTypes")}</option>
                      <option value="usage-events">{t("labels.kind.usage-events")}</option>
                      <option value="usage-ledger">{t("labels.kind.usage-ledger")}</option>
                      <option value="audit-logs">{t("labels.kind.audit-logs")}</option>
                    </select>
                  </div>

                  <div className="field field--inline">
                    <label htmlFor="jobStatus">{t("queue.filters.status")}</label>
                    <select id="jobStatus" name="jobStatus" defaultValue={selectedJobStatus}>
                      <option value="">{t("queue.allStatuses")}</option>
                      <option value="pending">{t("labels.jobStatus.pending")}</option>
                      <option value="running">{t("labels.jobStatus.running")}</option>
                      <option value="completed">{t("labels.jobStatus.completed")}</option>
                      <option value="failed">{t("labels.jobStatus.failed")}</option>
                    </select>
                  </div>

                  <div className="field field--inline">
                    <label htmlFor="jobQuery">{t("queue.searchPlaceholder")}</label>
                    <input
                      id="jobQuery"
                      name="jobQuery"
                      defaultValue={selectedJobQuery}
                      placeholder={t("queue.searchPlaceholder")}
                      type="search"
                    />
                  </div>
                </div>

                <div className="toolbar__actions">
                  <button className="button" type="submit">
                    {t("queue.applyFilters")}
                  </button>
                  <a className="button button--ghost" href={buildExportsPageHref({ jobKind: null, jobStatus: null, jobQuery: null })}>
                    {t("queue.clearFilters")}
                  </a>
                </div>
              </form>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {jobQuickViews.map((view) => (
                    <a
                      key={view.label}
                      href={view.href}
                      className={
                        view.active
                          ? "inline-flex items-center rounded-full border border-[#0075de] bg-[#f2f9ff] px-3 py-1 text-xs font-semibold text-[#097fe8]"
                          : "inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-black/70 transition hover:border-black/20 hover:text-black"
                      }
                    >
                      {view.label}
                      <span className="ml-1 text-[11px] font-medium text-black/45">{view.hint}</span>
                    </a>
                  ))}
                </div>
                <div className="summary-row">
                  <p>
                    {formatQueueSummary(locale, formatInteger(filteredExportJobs.length), formatInteger(exportJobs.length))}
                  </p>
                </div>
                {activeJobFilterChips.length ? (
                  <div className="filter-chip-row">
                    {activeJobFilterChips.map((chip) => (
                      <a key={`${chip.label}-${chip.value}`} className="filter-chip" href={chip.href}>
                        <span className="filter-chip__label">{chip.label}</span>
                        <span className="filter-chip__value">{chip.value}</span>
                        <span className="filter-chip__remove">{t("actions.clear")}</span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>

              {filteredExportJobs.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t("queue.columns.file")}</th>
                        <th>{t("queue.columns.kind")}</th>
                        <th>{t("queue.format")}</th>
                        <th className="numeric">{t("queue.columns.rows")}</th>
                        <th>{t("queue.columns.status")}</th>
                        <th>{t("queue.columns.timeline")}</th>
                        <th>{t("queue.columns.delivery")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExportJobs.map((job) => {
                        const downloadUrl = getExportDownloadUrl(job);
                        const scopeSummary = describeExportScope(job, projectNameById, environmentById, t);
                        const scheduledReportMeta = getScheduledReportJobMeta(job);
                        const governance = getGovernanceConfig(job.filters as Record<string, unknown>);
                        const sourceCard =
                          scheduledReportMeta ? scheduledReportCardById.get(scheduledReportMeta.scheduledReportId) ?? null : null;

                        return (
                          <tr key={job.id}>
                            <td>
                              <div className="cell-stack">
                                <strong className="mono mono--wrap" title={job.fileName}>
                                  {formatExportFileDisplay(job.fileName)}
                                </strong>
                                <span className="meta">{scopeSummary}</span>
                                {scheduledReportMeta ? (
                                  <span className="meta">
                                    {t("queue.recurringReportPrefix")}{" "}
                                    {sourceCard ? (
                                      <a href={`#scheduled-report-${scheduledReportMeta.scheduledReportId}`}>
                                        {scheduledReportMeta.scheduledReportName ?? sourceCard.report.name}
                                      </a>
                                    ) : (
                                      scheduledReportMeta.scheduledReportName ?? scheduledReportMeta.scheduledReportId
                                    )}
                                    {scheduledReportMeta.scheduledReportCadence ? ` · ${formatExportCadenceLabel(scheduledReportMeta.scheduledReportCadence as ReportCadence, t)}` : ""}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>{formatExportKindLabel(job.kind, t)}</td>
                            <td>{formatExportFormatLabel(job.format, locale)}</td>
                            <td className="numeric">{job.rowCount ?? 0}</td>
                            <td>
                              <div className="cell-stack">
                                <span className={getExportJobTagClass(job)}>{formatExportJobStatusLabel(job.status, t)}</span>
                                {job.attemptCount > 0 ? <span className="meta">{formatAttemptLabel(job.attemptCount, t)}</span> : null}
                              </div>
                            </td>
                            <td>
                              {(() => {
                                const activity = getExportJobActivitySummary(job, formatDateTime, t);
                                const duration = formatDuration(getExportJobDurationMs(job));

                                return (
                                  <div className="cell-stack">
                                    <span>{activity.primary}</span>
                                    <span className="meta">{activity.secondary}</span>
                                    {duration ? <span className="meta">{t("queue.timeline.durationPrefix")}{duration}</span> : null}
                                  </div>
                                );
                              })()}
                            </td>
                            <td>
                              <div className="cell-stack">
                                {downloadUrl ? (
                                  governance?.approvalMode === "required" && governance.approvalStatus !== "approved" ? (
                                    <span className="meta">{t("queue.approvalPendingBeforeDownload")}</span>
                                  ) : (
                                    <a className="button button--ghost" href={downloadUrl}>
                                      {t("queue.download")}
                                    </a>
                                  )
                                ) : job.status === "failed" ? (
                                  <>
                                    <span className="meta">{summarizeErrorMessage(job.errorMessage, 220) ?? t("queue.exportFailed")}</span>
                                    <form action={retryExportJobAction}>
                                      <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                                      <input name="currentPath" type="hidden" value={exportsHref} />
                                      <input name="exportJobId" type="hidden" value={job.id} />
                                      <button className="button button--ghost button--micro" type="submit">
                                        {t("queue.retryExport")}
                                      </button>
                                    </form>
                                  </>
                                ) : (
                                  <span className="meta">{t("queue.processing")}</span>
                                )}
                                {sourceCard ? (
                                  <a className="button button--ghost button--micro" href={`#scheduled-report-${sourceCard.report.id}`}>
                                    {t("actions.openSource")}
                                  </a>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  compact
                  description={exportJobs.length ? t("queue.noMatchDescription") : t("queue.ledgerSummary")}
                  title={exportJobs.length ? t("queue.noMatch") : t("queue.empty")}
                />
              )}
            </article>
          </>
        ) : (
          <article className="card span-12">
            <EmptyState
              description={
                exportsIssue
                  ? t("status.refresh")
                  : locale === "zh"
                    ? "请先在页头选择全局工作区，再查看导出任务。"
                    : "Choose the active workspace from the header before viewing exports."
              }
              title={exportsIssue ? t("status.dataUnavailable") : t("workspace.noSelection")}
            />
          </article>
        )}
      </section>
    </AppShell>
  );
}
