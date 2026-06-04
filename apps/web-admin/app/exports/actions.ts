"use server";

import { redirect } from "next/navigation";

import {
  createExportJob,
  createScheduledReport,
  deleteScheduledReport,
  retryExportJob as retryExportJobRequest,
  triggerScheduledReport as triggerScheduledReportRequest,
  updateExportJob,
  updateScheduledReport,
} from "../lib/control-api";
import { buildActionRedirectPath } from "../lib/action-redirect";
import { getSafeReturnTo } from "../lib/navigation";
import { getUserErrorMessage } from "../lib/user-facing-error";

function getRequiredString(formData: FormData, key: string) {
  const rawValue = formData.get(key);
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function getOptionalString(formData: FormData, key: string) {
  const rawValue = formData.get(key);
  if (typeof rawValue !== "string") {
    return undefined;
  }

  const value = rawValue.trim();
  return value || undefined;
}

function getNullableString(formData: FormData, key: string) {
  const rawValue = formData.get(key);
  if (typeof rawValue !== "string") {
    return undefined;
  }

  const value = rawValue.trim();
  return value.length ? value : null;
}

function getFormat(formData: FormData) {
  return getRequiredString(formData, "format") === "xlsx" ? "xlsx" : "csv";
}

function getOptionalDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function getProvider(value: string | undefined) {
  return value === "anthropic" ||
    value === "openai" ||
    value === "bedrock" ||
    value === "vertex" ||
    value === "openai-compatible"
    ? value
    : undefined;
}

function getUsageOutcomeFilters(value: string | undefined): {
  outcome?: "attention" | "success" | "error" | "blocked";
  status?: "success" | "error" | "blocked";
  statusGroup?: "attention";
} {
  if (value === "attention") {
    return {
      outcome: "attention",
      status: undefined,
      statusGroup: "attention" as const,
    };
  }

  if (value === "success" || value === "error" || value === "blocked") {
    return {
      outcome: value,
      status: value,
      statusGroup: undefined,
    };
  }

  return {
    outcome: undefined,
    status: undefined,
    statusGroup: undefined,
  };
}

function getUsageSurface(value: string | undefined): "metadata" | "streamed" | "interrupted" | undefined {
  return value === "metadata" || value === "streamed" || value === "interrupted" ? value : undefined;
}

function getUsageSort(value: string | undefined): "newest" | "oldest" | "latency_desc" | "cost_desc" | "tokens_desc" | undefined {
  return value === "oldest" ||
    value === "latency_desc" ||
    value === "cost_desc" ||
    value === "tokens_desc"
    ? value
    : undefined;
}

function getScheduledCadence(value: string | undefined): "daily" | "weekly" | "monthly" {
  return value === "daily" || value === "monthly" ? value : "weekly";
}

function getExportKind(value: string | undefined): "usage-events" | "audit-logs" {
  return value === "audit-logs" ? "audit-logs" : "usage-events";
}

function getOneOffExportKind(value: string | undefined): "usage-events" | "usage-ledger" | "audit-logs" {
  if (value === "audit-logs" || value === "usage-ledger") {
    return value;
  }

  return "usage-events";
}

function getOptionalNonNegativeInt(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function getNullableNonNegativeInt(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (!value.trim()) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildRedirectPath(
  workspaceId: string,
  query: Record<string, string | undefined>,
) {
  const params = new URLSearchParams({
    workspaceId,
  });

  for (const [key, value] of Object.entries(query)) {
    if (!value) {
      continue;
    }

    params.set(key, value);
  }

  return `/exports?${params.toString()}`;
}

function redirectToExports(
  formData: FormData,
  workspaceId: string,
  query: Record<string, string | undefined>,
  options?: {
    notice?: "created" | "error";
    message?: string;
  },
) {
  redirect(
    buildActionRedirectPath(
      buildRedirectPath(workspaceId, query),
      getSafeReturnTo(getOptionalString(formData, "currentPath")) ?? undefined,
      options,
    ),
  );
}

type ExportRedirectOptions = NonNullable<Parameters<typeof redirectToExports>[3]>;

function getActionErrorMessage(error: unknown, fallback: string) {
  return getUserErrorMessage(error, fallback);
}

async function resolveExportActionRedirect<T>(
  operation: () => Promise<T>,
  options: {
    getSuccessMessage: (result: T) => string;
    fallbackErrorMessage: string;
    getErrorMessage?: (error: unknown) => string;
  },
): Promise<ExportRedirectOptions> {
  try {
    const result = await operation();
    return {
      notice: "created",
      message: options.getSuccessMessage(result),
    };
  } catch (error) {
    return {
      notice: "error",
      message: options.getErrorMessage?.(error) ?? getActionErrorMessage(error, options.fallbackErrorMessage),
    };
  }
}

function parseFiltersJson(value: string, key: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${key} must be valid JSON`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${key} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

function getRequiredFiltersJson(formData: FormData, key: string) {
  return parseFiltersJson(getRequiredString(formData, key), key);
}

function cleanScheduledReportFilterValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const nextValues = value
      .map((entry) => cleanScheduledReportFilterValue(entry))
      .filter((entry): entry is Exclude<typeof entry, undefined> => entry !== undefined);

    return nextValues.length ? nextValues : undefined;
  }

  if (typeof value === "object") {
    const nextEntries = Object.entries(value as Record<string, unknown>).flatMap(([key, entryValue]) => {
      const nextValue = cleanScheduledReportFilterValue(entryValue);
      return nextValue === undefined ? [] : [[key, nextValue] as const];
    });

    return nextEntries.length ? Object.fromEntries(nextEntries) : undefined;
  }

  return value;
}

function cleanScheduledReportFilters(filters: Record<string, unknown>) {
  const cleaned = cleanScheduledReportFilterValue(filters);

  return cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)
    ? (cleaned as Record<string, unknown>)
    : {};
}

function getRepeatedStrings(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .flatMap((value) => (typeof value === "string" ? [value.trim()] : []))
    .filter(Boolean);
}

function parseSeparatedValues(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildReportDistributionFromForm(formData: FormData) {
  const targets = [
    ...parseSeparatedValues(getOptionalString(formData, "deliveryEmailTargets")).map((destination) => ({
      channel: "email" as const,
      destination,
    })),
    ...parseSeparatedValues(getOptionalString(formData, "deliverySlackTargets")).map((destination) => ({
      channel: "slack" as const,
      destination,
    })),
    ...parseSeparatedValues(getOptionalString(formData, "deliveryFeishuTargets")).map((destination) => ({
      channel: "feishu" as const,
      destination,
    })),
    ...parseSeparatedValues(getOptionalString(formData, "deliveryWebhookTargets")).map((destination) => ({
      channel: "webhook" as const,
      destination,
    })),
  ];

  if (!targets.length) {
    return undefined;
  }

  return {
    enabled: true,
    targets,
    includeDownloadLink: getOptionalString(formData, "deliveryIncludeDownloadLink") !== "no",
    includeSignedSnapshot: getOptionalString(formData, "deliveryIncludeSignedSnapshot") === "yes",
  };
}

function buildEventTriggerFromForm(formData: FormData) {
  const events = [...new Set(getRepeatedStrings(formData, "eventTriggerEvent"))].filter(
    (value): value is "budget-alert-opened" | "export-job-failed" =>
      value === "budget-alert-opened" || value === "export-job-failed",
  );

  if (!events.length) {
    return undefined;
  }

  return {
    enabled: true,
    events,
    scope: getOptionalString(formData, "eventTriggerScope") === "workspace" ? "workspace" : "report-scope",
    cooldownMinutes: getOptionalNonNegativeInt(getOptionalString(formData, "eventTriggerCooldownMinutes")) ?? 60,
  };
}

function buildGovernanceFromForm(formData: FormData) {
  const approvalMode = getOptionalString(formData, "approvalMode") === "required" ? "required" : "none";
  const watermarkLabel = getNullableString(formData, "watermarkLabel");
  const retentionDays = getNullableNonNegativeInt(getOptionalString(formData, "retentionDays"));
  const signedSnapshot = getOptionalString(formData, "signedSnapshot") === "yes";

  if (approvalMode === "none" && watermarkLabel == null && retentionDays == null && !signedSnapshot) {
    return undefined;
  }

  return {
    approvalMode,
    approvalStatus: approvalMode === "required" ? "pending" : "not_required",
    approverLabel: null,
    approvedAt: null,
    watermarkLabel: watermarkLabel ?? null,
    retentionDays: retentionDays ?? null,
    signedSnapshot,
  };
}

function applyReportSettings(
  filters: Record<string, unknown>,
  formData: FormData,
) {
  const nextFilters = {
    ...filters,
  };

  delete nextFilters.distribution;
  delete nextFilters.eventTrigger;
  delete nextFilters.governance;

  const distribution = buildReportDistributionFromForm(formData);
  const eventTrigger = buildEventTriggerFromForm(formData);
  const governance = buildGovernanceFromForm(formData);

  if (distribution) {
    nextFilters.distribution = distribution;
  }

  if (eventTrigger) {
    nextFilters.eventTrigger = eventTrigger;
  }

  if (governance) {
    nextFilters.governance = governance;
  }

  return nextFilters;
}

function getWorkflowStatus(value: string | undefined): "pending" | "acknowledged" | "in_progress" | "blocked" | "completed" {
  return value === "acknowledged" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "completed"
    ? value
    : "pending";
}

function getApprovalStatus(value: string | undefined): "pending" | "approved" {
  return value === "approved" ? "approved" : "pending";
}

function buildExportsQueueQuery(formData: FormData) {
  return {
    returnTo: getSafeReturnTo(getOptionalString(formData, "returnTo")) ?? undefined,
    kind: getOptionalString(formData, "kind"),
    reportTemplate: getOptionalString(formData, "reportTemplate"),
    reportCadence: getOptionalString(formData, "reportCadence"),
    jobKind: getOptionalString(formData, "jobKind"),
    jobStatus: getOptionalString(formData, "jobStatus"),
    jobQuery: getOptionalString(formData, "jobQuery"),
    projectId: getOptionalString(formData, "projectId"),
    environmentId: getOptionalString(formData, "environmentId"),
    provider: getOptionalString(formData, "provider"),
    outcome: getOptionalString(formData, "outcome"),
    surface: getOptionalString(formData, "surface"),
    minLatencyMs: getOptionalString(formData, "minLatencyMs"),
    sortBy: getOptionalString(formData, "sortBy"),
    virtualKeyId: getOptionalString(formData, "virtualKeyId"),
    providerConnectionId: getOptionalString(formData, "providerConnectionId"),
    budgetPolicyId: getOptionalString(formData, "budgetPolicyId"),
    model: getOptionalString(formData, "model"),
    canonicalModel: getOptionalString(formData, "canonicalModel"),
    owner: getOptionalString(formData, "owner"),
    requestId: getOptionalString(formData, "requestId"),
    providerRequestId: getOptionalString(formData, "providerRequestId"),
    from: getOptionalString(formData, "from"),
    to: getOptionalString(formData, "to"),
    actorType: getOptionalString(formData, "actorType"),
    actorId: getOptionalString(formData, "actorId"),
    action: getOptionalString(formData, "action"),
    subjectType: getOptionalString(formData, "subjectType"),
    subjectId: getOptionalString(formData, "subjectId"),
    usageFormat: getOptionalString(formData, "usageFormat"),
    auditFormat: getOptionalString(formData, "auditFormat"),
  };
}

export async function createUsageExportAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const outcomeFilters = getUsageOutcomeFilters(getOptionalString(formData, "outcome"));
  const surface = getUsageSurface(getOptionalString(formData, "surface"));
  const sortBy = getUsageSort(getOptionalString(formData, "sortBy"));
  const query = {
    kind: "usage-events",
    returnTo: getSafeReturnTo(getOptionalString(formData, "returnTo")) ?? undefined,
    jobKind: getOptionalString(formData, "jobKind"),
    jobStatus: getOptionalString(formData, "jobStatus"),
    jobQuery: getOptionalString(formData, "jobQuery"),
    projectId: getOptionalString(formData, "projectId"),
    environmentId: getOptionalString(formData, "environmentId"),
    virtualKeyId: getOptionalString(formData, "virtualKeyId"),
    providerConnectionId: getOptionalString(formData, "providerConnectionId"),
    budgetPolicyId: getOptionalString(formData, "budgetPolicyId"),
    provider: getOptionalString(formData, "provider"),
    model: getOptionalString(formData, "model"),
    requestId: getOptionalString(formData, "requestId"),
    providerRequestId: getOptionalString(formData, "providerRequestId"),
    outcome: outcomeFilters.outcome,
    surface,
    sortBy,
    minLatencyMs: getOptionalString(formData, "minLatencyMs"),
    from: getOptionalString(formData, "from"),
    to: getOptionalString(formData, "to"),
    usageFormat: getOptionalString(formData, "format"),
  };

  const redirectOptions = await resolveExportActionRedirect(
    async () =>
      createExportJob({
        workspaceId,
        kind: "usage-events",
        format: getFormat(formData),
        fileName: getOptionalString(formData, "fileName"),
        filters: {
          workspaceId,
          projectId: query.projectId,
          environmentId: query.environmentId,
          virtualKeyId: query.virtualKeyId,
          providerConnectionId: query.providerConnectionId,
          budgetPolicyId: query.budgetPolicyId,
          provider: getProvider(query.provider),
          model: query.model,
          requestId: query.requestId,
          providerRequestId: query.providerRequestId,
          status: outcomeFilters.status,
          statusGroup: outcomeFilters.statusGroup,
          surface: query.surface,
          minLatencyMs: getOptionalNonNegativeInt(query.minLatencyMs),
          sortBy: query.sortBy,
          from: getOptionalDate(query.from),
          to: getOptionalDate(query.to),
        },
      }),
    {
      getSuccessMessage: () => "Created usage export job.",
      fallbackErrorMessage: "Unable to create usage export",
    },
  );

  redirectToExports(formData, workspaceId, query, redirectOptions);
}

export async function createUsageLedgerExportAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const outcomeFilters = getUsageOutcomeFilters(getOptionalString(formData, "outcome"));
  const sortBy = getUsageSort(getOptionalString(formData, "sortBy"));
  const query = {
    kind: "usage-ledger",
    returnTo: getSafeReturnTo(getOptionalString(formData, "returnTo")) ?? undefined,
    jobKind: getOptionalString(formData, "jobKind"),
    jobStatus: getOptionalString(formData, "jobStatus"),
    jobQuery: getOptionalString(formData, "jobQuery"),
    projectId: getOptionalString(formData, "projectId"),
    environmentId: getOptionalString(formData, "environmentId"),
    virtualKeyId: getOptionalString(formData, "virtualKeyId"),
    providerConnectionId: getOptionalString(formData, "providerConnectionId"),
    budgetPolicyId: getOptionalString(formData, "budgetPolicyId"),
    provider: getOptionalString(formData, "provider"),
    canonicalModel: getOptionalString(formData, "canonicalModel"),
    owner: getOptionalString(formData, "owner"),
    requestId: getOptionalString(formData, "requestId"),
    providerRequestId: getOptionalString(formData, "providerRequestId"),
    outcome: outcomeFilters.outcome,
    sortBy,
    from: getOptionalString(formData, "from"),
    to: getOptionalString(formData, "to"),
    usageFormat: getOptionalString(formData, "format"),
  };

  const redirectOptions = await resolveExportActionRedirect(
    async () =>
      createExportJob({
        workspaceId,
        kind: "usage-ledger",
        format: getFormat(formData),
        fileName: getOptionalString(formData, "fileName"),
        filters: {
          workspaceId,
          projectId: query.projectId,
          environmentId: query.environmentId,
          virtualKeyId: query.virtualKeyId,
          providerConnectionId: query.providerConnectionId,
          budgetPolicyId: query.budgetPolicyId,
          provider: getProvider(query.provider),
          canonicalModel: query.canonicalModel,
          owner: query.owner,
          requestId: query.requestId,
          providerRequestId: query.providerRequestId,
          status: outcomeFilters.status,
          statusGroup: outcomeFilters.statusGroup,
          sortBy: query.sortBy,
          from: getOptionalDate(query.from),
          to: getOptionalDate(query.to),
        },
      }),
    {
      getSuccessMessage: () => "Created usage ledger export job.",
      fallbackErrorMessage: "Unable to create usage ledger export",
    },
  );

  redirectToExports(formData, workspaceId, query, redirectOptions);
}

export async function createExportJobAction(formData: FormData) {
  const kind = getOneOffExportKind(getOptionalString(formData, "kind"));

  if (kind === "audit-logs") {
    return createAuditExportAction(formData);
  }

  if (kind === "usage-ledger") {
    return createUsageLedgerExportAction(formData);
  }

  return createUsageExportAction(formData);
}

export async function createAuditExportAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const query = {
    kind: "audit-logs",
    returnTo: getSafeReturnTo(getOptionalString(formData, "returnTo")) ?? undefined,
    jobKind: getOptionalString(formData, "jobKind"),
    jobStatus: getOptionalString(formData, "jobStatus"),
    jobQuery: getOptionalString(formData, "jobQuery"),
    projectId: getOptionalString(formData, "projectId"),
    environmentId: getOptionalString(formData, "environmentId"),
    actorType: getOptionalString(formData, "actorType"),
    actorId: getOptionalString(formData, "actorId"),
    action: getOptionalString(formData, "action"),
    subjectType: getOptionalString(formData, "subjectType"),
    subjectId: getOptionalString(formData, "subjectId"),
    from: getOptionalString(formData, "auditFrom"),
    to: getOptionalString(formData, "auditTo"),
    auditFormat: getOptionalString(formData, "format"),
  };

  const redirectOptions = await resolveExportActionRedirect(
    async () =>
      createExportJob({
        workspaceId,
        kind: "audit-logs",
        format: getFormat(formData),
        fileName: getOptionalString(formData, "fileName"),
        filters: {
          workspaceId,
          projectId: query.projectId,
          environmentId: query.environmentId,
          actorType: query.actorType,
          actorId: query.actorId,
          action: query.action,
          subjectType: query.subjectType,
          subjectId: query.subjectId,
          from: getOptionalDate(query.from),
          to: getOptionalDate(query.to),
        },
      }),
    {
      getSuccessMessage: () => "Created audit export job.",
      fallbackErrorMessage: "Unable to create audit export",
    },
  );

  redirectToExports(formData, workspaceId, query, redirectOptions);
}

export async function createScheduledReportAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const kind = getExportKind(getOptionalString(formData, "kind"));
  const cadence = getScheduledCadence(getOptionalString(formData, "cadence"));
  const query = {
    returnTo: getSafeReturnTo(getOptionalString(formData, "returnTo")) ?? undefined,
    kind,
    reportTemplate: getOptionalString(formData, "reportTemplate"),
    reportCadence: cadence,
  };

  const redirectOptions = await resolveExportActionRedirect(
    async () =>
      createScheduledReport({
        workspaceId,
        kind,
        format: getFormat(formData),
        name: getRequiredString(formData, "name"),
        filters: cleanScheduledReportFilters(applyReportSettings(getRequiredFiltersJson(formData, "filtersJson"), formData)),
        cadence,
      }),
    {
      getSuccessMessage: () => "Scheduled report created.",
      fallbackErrorMessage: "Unable to create scheduled report",
    },
  );

  redirectToExports(formData, workspaceId, query, redirectOptions);
}

export async function triggerScheduledReportAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const kind = getExportKind(getOptionalString(formData, "kind"));
  const query = {
    returnTo: getSafeReturnTo(getOptionalString(formData, "returnTo")) ?? undefined,
    kind,
    reportTemplate: getOptionalString(formData, "reportTemplate"),
    reportCadence: getOptionalString(formData, "reportCadence"),
    jobKind: getOptionalString(formData, "jobKind"),
    jobStatus: getOptionalString(formData, "jobStatus"),
    jobQuery: getOptionalString(formData, "jobQuery"),
  };

  const redirectOptions = await resolveExportActionRedirect(
    async () => triggerScheduledReportRequest(getRequiredString(formData, "scheduledReportId")),
    {
      getSuccessMessage: ({ scheduledReport, exportJob }) => `Queued "${scheduledReport.name}" as ${exportJob.fileName}.`,
      fallbackErrorMessage: "Unable to trigger scheduled report",
    },
  );

  redirectToExports(formData, workspaceId, query, redirectOptions);
}

export async function retryExportJobAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const query = {
    returnTo: getSafeReturnTo(getOptionalString(formData, "returnTo")) ?? undefined,
    kind: getOptionalString(formData, "kind"),
    reportTemplate: getOptionalString(formData, "reportTemplate"),
    reportCadence: getOptionalString(formData, "reportCadence"),
    jobKind: getOptionalString(formData, "jobKind"),
    jobStatus: getOptionalString(formData, "jobStatus"),
    jobQuery: getOptionalString(formData, "jobQuery"),
    projectId: getOptionalString(formData, "projectId"),
    environmentId: getOptionalString(formData, "environmentId"),
    provider: getOptionalString(formData, "provider"),
    outcome: getOptionalString(formData, "outcome"),
    surface: getOptionalString(formData, "surface"),
    minLatencyMs: getOptionalString(formData, "minLatencyMs"),
    sortBy: getOptionalString(formData, "sortBy"),
    virtualKeyId: getOptionalString(formData, "virtualKeyId"),
    providerConnectionId: getOptionalString(formData, "providerConnectionId"),
    budgetPolicyId: getOptionalString(formData, "budgetPolicyId"),
    model: getOptionalString(formData, "model"),
    requestId: getOptionalString(formData, "requestId"),
    providerRequestId: getOptionalString(formData, "providerRequestId"),
    from: getOptionalString(formData, "from"),
    to: getOptionalString(formData, "to"),
    actorType: getOptionalString(formData, "actorType"),
    actorId: getOptionalString(formData, "actorId"),
    action: getOptionalString(formData, "action"),
    subjectType: getOptionalString(formData, "subjectType"),
    subjectId: getOptionalString(formData, "subjectId"),
    usageFormat: getOptionalString(formData, "usageFormat"),
    auditFormat: getOptionalString(formData, "auditFormat"),
  };

  const redirectOptions = await resolveExportActionRedirect(
    async () => retryExportJobRequest(getRequiredString(formData, "exportJobId")),
    {
      getSuccessMessage: (job) => `Re-queued ${job.fileName}.`,
      fallbackErrorMessage: "Unable to retry export job",
    },
  );

  redirectToExports(formData, workspaceId, query, redirectOptions);
}

export async function retryVisibleFailedExportJobsAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const query = buildExportsQueueQuery(formData);
  const exportJobIds = [...new Set(getRepeatedStrings(formData, "exportJobId"))];

  if (!exportJobIds.length) {
    redirectToExports(formData, workspaceId, query, {
      notice: "error",
      message: "No failed export jobs were selected to retry.",
    });
  }

  const results = await Promise.allSettled(exportJobIds.map((exportJobId) => retryExportJobRequest(exportJobId)));
  const successCount = results.filter((result) => result.status === "fulfilled").length;
  const failureCount = results.length - successCount;

  if (!successCount) {
    const firstFailure = results.find((result) => result.status === "rejected");
    const message =
      firstFailure && "reason" in firstFailure && firstFailure.reason instanceof Error
        ? firstFailure.reason.message
        : "Unable to retry the selected export jobs";

    redirectToExports(formData, workspaceId, query, {
      notice: "error",
      message,
    });
  }

  redirectToExports(formData, workspaceId, query, {
    notice: failureCount ? "error" : "created",
    message: failureCount
      ? `Re-queued ${successCount} failed export job${successCount === 1 ? "" : "s"}; ${failureCount} still need review.`
      : `Re-queued ${successCount} failed export job${successCount === 1 ? "" : "s"}.`,
  });
}

export async function updateExportJobFollowupAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const exportJobId = getRequiredString(formData, "exportJobId");
  const query = buildExportsQueueQuery(formData);
  const workflowPatch =
    formData.has("workflowOwnerLabel") ||
    formData.has("workflowStatus") ||
    formData.has("workflowNote") ||
    formData.has("workflowSlaDueAt")
      ? {
          ownerLabel: getNullableString(formData, "workflowOwnerLabel"),
          status: getWorkflowStatus(getOptionalString(formData, "workflowStatus")),
          note: getNullableString(formData, "workflowNote"),
          slaDueAt: getNullableString(formData, "workflowSlaDueAt"),
          updatedAt: new Date().toISOString(),
        }
      : undefined;
  const governanceApprovalMode: "required" | "none" =
    getOptionalString(formData, "governanceApprovalMode") === "required" ? "required" : "none";
  const governanceApprovalStatus: "pending" | "approved" | "not_required" =
    governanceApprovalMode === "required"
      ? getApprovalStatus(getOptionalString(formData, "governanceApprovalStatus"))
      : "not_required";
  const governancePatch =
    formData.has("governanceApprovalMode") || formData.has("governanceApprovalStatus") || formData.has("governanceApproverLabel")
      ? {
          approvalMode: governanceApprovalMode,
          approvalStatus: governanceApprovalStatus,
          approverLabel:
            governanceApprovalStatus === "approved" ? (getNullableString(formData, "governanceApproverLabel") ?? "web-admin") : null,
          approvedAt: governanceApprovalStatus === "approved" ? new Date().toISOString() : null,
        }
      : undefined;

  if (!workflowPatch && !governancePatch) {
    redirectToExports(formData, workspaceId, query, {
      notice: "error",
      message: "No follow-up fields were provided for this export job.",
    });
  }

  const redirectOptions = await resolveExportActionRedirect(
    async () =>
      updateExportJob(exportJobId, {
        filtersPatch: {
          ...(workflowPatch ? { workflow: workflowPatch } : {}),
          ...(governancePatch ? { governance: governancePatch } : {}),
        },
      }),
    {
      getSuccessMessage: () => "Export follow-up updated.",
      fallbackErrorMessage: "Unable to update export follow-up",
    },
  );

  redirectToExports(formData, workspaceId, query, redirectOptions);
}

export async function saveScheduledReportAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const scheduledReportId = getRequiredString(formData, "scheduledReportId");
  const kind = getExportKind(getOptionalString(formData, "kind"));
  const cadence = getScheduledCadence(getOptionalString(formData, "cadence"));
  const query = {
    returnTo: getSafeReturnTo(getOptionalString(formData, "returnTo")) ?? undefined,
    kind,
    reportTemplate: getOptionalString(formData, "reportTemplate"),
    reportCadence: cadence,
  };
  const filterSource = getOptionalString(formData, "filterSource") === "current" ? "current" : "existing";
  const filters =
    filterSource === "current"
      ? kind === "audit-logs"
        ? applyReportSettings(getRequiredFiltersJson(formData, "auditFiltersJson"), formData)
        : applyReportSettings(getRequiredFiltersJson(formData, "usageFiltersJson"), formData)
      : applyReportSettings(getRequiredFiltersJson(formData, "existingFiltersJson"), formData);
  const previousKind = getExportKind(getOptionalString(formData, "previousKind"));
  const previousFormat = getOptionalString(formData, "previousFormat") === "xlsx" ? "xlsx" : "csv";
  const previousName = getRequiredString(formData, "previousName");
  const previousFilters = getRequiredFiltersJson(formData, "previousFiltersJson");
  const previousCadence = getScheduledCadence(getOptionalString(formData, "previousCadence"));

  const redirectOptions = await resolveExportActionRedirect(
    async () =>
      updateScheduledReport(scheduledReportId, {
        kind,
        format: getFormat(formData),
        name: getRequiredString(formData, "name"),
        filters: cleanScheduledReportFilters(filters),
        cadence,
      }),
    {
      getSuccessMessage: () => "Scheduled report updated.",
      fallbackErrorMessage: "Unable to update scheduled report",
      getErrorMessage: (error) => {
        const previousSummary = `${previousName} · ${previousKind} · ${previousFormat} · ${previousCadence}`;
        const previousFilterCount = Object.keys(previousFilters).length;

        return `${getActionErrorMessage(error, "Unable to update scheduled report")}. Original object was left unchanged (${previousSummary}, ${previousFilterCount} stored filter${
          previousFilterCount === 1 ? "" : "s"
        }).`;
      },
    },
  );

  redirectToExports(formData, workspaceId, query, redirectOptions);
}

export async function deleteScheduledReportAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const kind = getExportKind(getOptionalString(formData, "kind"));
  const query = {
    returnTo: getSafeReturnTo(getOptionalString(formData, "returnTo")) ?? undefined,
    kind,
    reportTemplate: getOptionalString(formData, "reportTemplate"),
    reportCadence: getOptionalString(formData, "reportCadence"),
  };

  const redirectOptions = await resolveExportActionRedirect(
    async () => deleteScheduledReport(getRequiredString(formData, "scheduledReportId")),
    {
      getSuccessMessage: () => "Scheduled report removed.",
      fallbackErrorMessage: "Unable to remove scheduled report",
    },
  );

  redirectToExports(formData, workspaceId, query, redirectOptions);
}
