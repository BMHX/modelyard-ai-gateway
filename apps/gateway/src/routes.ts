import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  GatewayRequestStubSchema,
  getProviderConfiguredModelCatalogItems,
  getProviderModelPricingCoverageStatus,
  normalizeProviderModel,
  providerConnectionSupportsProtocol,
  providerMetadataMatchesRequestedModel,
  type BudgetPolicySummary,
  type RecordUsageEventInput,
  type VirtualKey,
} from "@teamops/contracts";
import {
  appendAuditLog,
  appendUsageEvent,
  buildBudgetAlertDedupeKey,
  evaluateApplicableBudgetPolicies,
  findProviderConnectionCandidateById,
  getBudgetSoftLimitUsd,
  getCurrentBudgetPeriod,
  listAssignedCatalogModelsForWorkspace,
  listProviderConnectionCandidatesForWorkspace,
  pingDatabase,
  resolveBudgetPricingUnavailableAlerts,
  resolveVirtualKey,
  syncBudgetPolicyAlerts,
  touchVirtualKeyUsage,
  triggerEventDrivenScheduledReports,
  upsertAlert,
  type ProviderConnectionCandidate,
} from "@teamops/database";

import type { GatewayContext } from "./context.js";
import { buildGatewayErrorBody } from "./error-response.js";
import { GatewayHttpError, isGatewayHttpError } from "./errors.js";
import { getBearerToken, isVirtualKeyTokenCandidate } from "./auth.js";
import { getDecryptedProviderCredential } from "./provider-credentials-cache.js";
import { createUpstreamAbortSignal, isClientDisconnectAbortReason } from "./request-abort.js";
import { selectProviderForProtocol, type ResolvedProviderCredentials } from "./provider-selection.js";
import { buildGatewayResponseHeaders, buildUpstreamResponseHeaders, mergeResponseHeaders } from "./response-headers.js";
import {
  getProtocolForPath,
  isMetadataRequestPath,
  providerSupportsProtocol,
  type GatewayProtocol,
  type GatewayRequestPath,
} from "./protocol.js";
import { invokeProvider } from "./providers/index.js";
import { resolveModelPricing } from "./pricing.js";
import { estimateRequestCost } from "./request-estimation.js";
import { finalizeStreamUsageEvent } from "./stream-usage.js";
import { evaluateVirtualKeyScopes } from "./virtual-key-scopes.js";

function getRequestedModel(path: GatewayRequestPath, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    if (path.startsWith("/v1/models/")) {
      try {
        return decodeURIComponent(path.slice("/v1/models/".length)) || null;
      } catch {
        return path.slice("/v1/models/".length) || null;
      }
    }

    return null;
  }

  const model = (body as Record<string, unknown>).model;
  return typeof model === "string" ? model : null;
}

function getConfiguredProviderModelIdSet(
  metadata: Record<string, string>,
  pricingConfig?: ProviderConnectionCandidate["connection"]["pricingConfig"] | null,
) {
  return new Set(
    getProviderConfiguredModelCatalogItems(metadata, pricingConfig).map((item) =>
      normalizeProviderModel(item.id),
    ),
  );
}

function isConfiguredProviderModelAllowed(
  metadata: Record<string, string>,
  pricingConfig: ProviderConnectionCandidate["connection"]["pricingConfig"] | null | undefined,
  requestedModel: string,
) {
  const configuredModelIds = getConfiguredProviderModelIdSet(metadata, pricingConfig);
  if (configuredModelIds.size === 0) {
    return true;
  }

  return configuredModelIds.has(normalizeProviderModel(requestedModel));
}

function filterConfiguredModelCatalogResponse(
  metadata: Record<string, string>,
  pricingConfig: ProviderConnectionCandidate["connection"]["pricingConfig"] | null | undefined,
  responseBody: Record<string, unknown> | string | Readable,
) {
  if (typeof responseBody === "string" || responseBody instanceof Readable) {
    return responseBody;
  }

  const configuredModelIds = getConfiguredProviderModelIdSet(metadata, pricingConfig);
  if (configuredModelIds.size === 0) {
    return responseBody;
  }

  const rawItems = Array.isArray(responseBody.data) ? responseBody.data : null;
  if (!rawItems) {
    return responseBody;
  }

  return {
    ...responseBody,
    data: rawItems.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }

      const modelId = typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : "";
      return configuredModelIds.has(normalizeProviderModel(modelId));
    }),
  };
}

async function listReadyWorkspaceModels(args: {
  db: GatewayContext["db"];
  workspaceId: string;
  protocol: GatewayProtocol;
}) {
  const [assignedModels, providerCandidates] = await Promise.all([
    listAssignedCatalogModelsForWorkspace(args.db, args.workspaceId, args.protocol),
    listProviderConnectionCandidatesForWorkspace(args.db, args.workspaceId),
  ]);

  const configuredModels =
    assignedModels.length > 0
      ? assignedModels
      : providerCandidates
          .filter((candidate) =>
            providerConnectionSupportsProtocol(candidate.connection.provider, args.protocol),
          )
          .flatMap((candidate) =>
            getProviderConfiguredModelCatalogItems(
              candidate.metadata,
              candidate.connection.pricingConfig,
            ).map((item) => ({
              modelId: item.id,
            })),
          )
          .filter(
            (model, index, currentModels) =>
              currentModels.findIndex(
                (candidateModel) =>
                  normalizeProviderModel(candidateModel.modelId) ===
                  normalizeProviderModel(model.modelId),
              ) === index,
          );

  return configuredModels.filter((model) => {
    const matchingCandidates = providerCandidates.filter(
      (candidate) =>
        providerConnectionSupportsProtocol(candidate.connection.provider, args.protocol) &&
        providerMetadataMatchesRequestedModel(
          candidate.metadata,
          model.modelId,
          candidate.connection.pricingConfig,
        ),
    );
    if (matchingCandidates.length === 0) {
      return false;
    }

    const pricingReadyCandidates = matchingCandidates.filter(
      (candidate) =>
        getProviderModelPricingCoverageStatus({
          provider: candidate.connection.provider,
          model: model.modelId,
          pricingConfig: candidate.connection.pricingConfig,
          metadata: candidate.metadata,
        }) !== "uncovered",
    );
    if (pricingReadyCandidates.length === 0) {
      return false;
    }

    return analyzeWorkspaceProviderSelection({
      providers: pricingReadyCandidates,
      protocol: args.protocol,
      requestedModel: model.modelId,
      headers: {},
    }).ok;
  });
}

function analyzeWorkspaceProviderSelection(args: {
  providers: ProviderConnectionCandidate[];
  protocol: GatewayProtocol;
  requestedModel: string;
  headers: Record<string, string>;
}) {
  try {
    const candidate = selectProviderForProtocol({
      providers: args.providers,
      protocol: args.protocol,
      headers: args.headers,
      requestedModel: args.requestedModel,
    });

    return {
      ok: true as const,
      candidate,
    };
  } catch (error) {
    if (isGatewayHttpError(error)) {
      return {
        ok: false as const,
        error,
      };
    }

    throw error;
  }
}

function normalizeRequestHeaders(headers: FastifyRequest["headers"]) {
  const normalized: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[name.toLowerCase()] = value;
      continue;
    }

    if (Array.isArray(value)) {
      normalized[name.toLowerCase()] = value.join(", ");
    }
  }

  return normalized;
}

function extractRequestSearch(rawUrl?: string) {
  if (!rawUrl) {
    return "";
  }

  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex < 0) {
    return "";
  }

  return rawUrl.slice(queryIndex);
}

function resolveUpstreamTimeoutMs(metadata: Record<string, string>) {
  const rawTimeout = metadata.upstreamTimeoutMs ?? metadata.timeoutMs;
  const parsed = rawTimeout ? Number(rawTimeout) : NaN;

  if (Number.isFinite(parsed) && parsed >= 1_000) {
    return Math.min(Math.trunc(parsed), 30 * 60_000);
  }

  return 10 * 60_000;
}

function isVirtualKeyExpired(virtualKey: VirtualKey, now = new Date()) {
  if (!virtualKey.expiresAt) {
    return false;
  }

  return Date.parse(virtualKey.expiresAt) <= now.getTime();
}

function applyReplyHeaders(reply: FastifyReply, headers: Record<string, string>) {
  for (const [name, value] of Object.entries(headers)) {
    reply.header(name, value);
  }
}

function applyRawReplyHeaders(reply: FastifyReply, headers: Record<string, string>) {
  for (const [name, value] of Object.entries(headers)) {
    reply.raw.setHeader(name, value);
  }
}

function createGatewayErrorReply(args: {
  protocol: GatewayProtocol;
  statusCode: number;
  message: string;
  requestId: string;
  reason?: string;
}) {
  return buildGatewayErrorBody({
    protocol: args.protocol,
    statusCode: args.statusCode,
    message: args.message,
    requestId: args.requestId,
    reason: args.reason,
  });
}

async function appendUsageEventSafely(
  app: FastifyInstance,
  context: GatewayContext,
  input: RecordUsageEventInput,
) {
  try {
    await appendUsageEvent(context.db, input);
  } catch (error) {
    app.log.error(
      {
        err: error,
        requestId: input.requestId,
        workspaceId: input.workspaceId,
        provider: input.provider,
        model: input.model,
      },
      "Failed to persist usage event",
    );
  }
}

async function upsertAlertSafely(
  app: FastifyInstance,
  context: GatewayContext,
  input: Parameters<typeof upsertAlert>[1],
) {
  try {
    return await upsertAlert(context.db, input);
  } catch (error) {
    app.log.error(
      {
        err: error,
        workspaceId: input.workspaceId,
        code: input.code,
      },
      "Failed to upsert alert",
    );
    return null;
  }
}

function getAlertEventScope(alert: Awaited<ReturnType<typeof upsertAlert>>) {
  const metadata =
    alert?.metadata && typeof alert.metadata === "object" && !Array.isArray(alert.metadata)
      ? (alert.metadata as Record<string, unknown>)
      : {};

  return {
    projectId: typeof metadata.projectId === "string" ? metadata.projectId : null,
    environmentId: typeof metadata.environmentId === "string" ? metadata.environmentId : null,
    budgetPolicyId: typeof metadata.budgetPolicyId === "string" ? metadata.budgetPolicyId : null,
  };
}

async function triggerBudgetAlertReportsSafely(
  app: FastifyInstance,
  context: GatewayContext,
  alert: Awaited<ReturnType<typeof upsertAlertSafely>>,
) {
  if (!alert || alert.status !== "open" || !alert.code.startsWith("budget.")) {
    return;
  }

  try {
    const triggeredReports = await triggerEventDrivenScheduledReports(context.db, {
      workspaceId: alert.workspaceId,
      eventType: "budget-alert-opened",
      eventEntityId: alert.id,
      scope: getAlertEventScope(alert),
      payload: {
        alertCode: alert.code,
        alertSeverity: alert.severity,
        alertTitle: alert.title,
      },
    });

    await Promise.all(
      triggeredReports.map(({ scheduledReport, exportJob }) =>
        appendAuditLog(context.db, {
          workspaceId: scheduledReport.workspaceId,
          actorType: "system",
          actorId: "gateway",
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
            triggerEvent: "budget-alert-opened",
            triggerEntityId: alert.id,
            alertCode: alert.code,
          },
        }),
      ),
    );
  } catch (error) {
    app.log.error(
      {
        err: error,
        workspaceId: alert.workspaceId,
        alertId: alert.id,
        code: alert.code,
      },
      "Failed to trigger event-driven reports for alert",
    );
  }
}

async function syncBudgetPolicyAlertsSafely(
  app: FastifyInstance,
  context: GatewayContext,
  summaries: BudgetPolicySummary[],
  now = new Date(),
) {
  await Promise.all(
    summaries.map(async (summary) => {
      try {
        await syncBudgetPolicyAlerts(context.db, {
          budgetPolicyId: summary.id,
          summary,
          now,
        });
      } catch (error) {
        app.log.error(
          {
            err: error,
            workspaceId: summary.workspaceId,
            budgetPolicyId: summary.id,
          },
          "Failed to sync budget alert statuses",
        );
      }
    }),
  );
}

function formatUsd(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function formatBudgetScopeLabel(summary: BudgetPolicySummary) {
  if (summary.scopeKind === "environment") {
    if (summary.environmentId) {
      return `environment ${summary.environmentId}`;
    }
    if (summary.environment) {
      return `environment ${summary.environment}`;
    }
  }

  if (summary.scopeKind === "project" && summary.projectId) {
    return `project ${summary.projectId}`;
  }

  return "workspace";
}

function getBudgetScopePriority(summary: Pick<BudgetPolicySummary, "scopeKind">) {
  switch (summary.scopeKind) {
    case "environment":
      return 3;
    case "project":
      return 2;
    default:
      return 1;
  }
}

function orderBudgetSummariesForEvidence(summaries: BudgetPolicySummary[]) {
  return [...summaries].sort((left, right) => {
    const priorityDifference = getBudgetScopePriority(right) - getBudgetScopePriority(left);
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    if (left.remainingUsd !== right.remainingUsd) {
      return left.remainingUsd - right.remainingUsd;
    }

    return left.id.localeCompare(right.id);
  });
}

function getPrimaryBudgetSummaryForEvidence(summaries: BudgetPolicySummary[]) {
  return orderBudgetSummariesForEvidence(summaries)[0] ?? null;
}

function buildBudgetEvidenceMetadata(
  summaries: BudgetPolicySummary[],
  args?: {
    periodKey?: string | null;
    policyIdsKey?: "blockedBudgetPolicyIds" | "exhaustedBudgetPolicyIds";
  },
) {
  const orderedSummaries = orderBudgetSummariesForEvidence(summaries);
  const primaryBudget = orderedSummaries[0] ?? null;
  const budgetPolicyIds = orderedSummaries.map((summary) => summary.id);
  const metadata: Record<string, unknown> = {};

  if (primaryBudget) {
    metadata.budgetPolicyId = primaryBudget.id;
    metadata.budgetScopeKind = primaryBudget.scopeKind;

    if (primaryBudget.projectId) {
      metadata.budgetProjectId = primaryBudget.projectId;
    }

    if (primaryBudget.environmentId) {
      metadata.budgetEnvironmentId = primaryBudget.environmentId;
    }

    if (primaryBudget.environment) {
      metadata.budgetEnvironment = primaryBudget.environment;
    }
  }

  if (budgetPolicyIds.length > 0) {
    metadata.budgetPolicyIds = budgetPolicyIds;

    if (args?.policyIdsKey) {
      metadata[args.policyIdsKey] = budgetPolicyIds;
    }
  }

  if (args?.periodKey) {
    metadata.periodKey = args.periodKey;
  }

  return metadata;
}

function applyUsageCostToBudget(summary: BudgetPolicySummary, costUsd: number): BudgetPolicySummary {
  const currentMonthSpendUsd = Number((summary.currentMonthSpendUsd + costUsd).toFixed(6));
  const softLimitUsd = getBudgetSoftLimitUsd(summary);

  return {
    ...summary,
    currentMonthSpendUsd,
    remainingUsd: Number(Math.max(summary.monthlyUsdLimit - currentMonthSpendUsd, 0).toFixed(6)),
    softLimitUsd,
    softLimitReached: currentMonthSpendUsd >= softLimitUsd,
    hardLimitReached: currentMonthSpendUsd >= summary.monthlyUsdLimit,
  };
}

async function upsertBudgetThresholdAlerts(
  app: FastifyInstance,
  context: GatewayContext,
  summaries: BudgetPolicySummary[],
  requestContext?: {
    requestId?: string;
    providerRequestId?: string | null;
    provider?: string | null;
    model?: string | null;
  },
  now = new Date(),
) {
  const period = getCurrentBudgetPeriod(now);

  for (const summary of summaries) {
    const scopeLabel = formatBudgetScopeLabel(summary);

    if (summary.softLimitReached) {
      const alert = await upsertAlertSafely(app, context, {
        workspaceId: summary.workspaceId,
        severity: "warning",
        code: "budget.soft-limit",
        title: `${scopeLabel} reached ${summary.softLimitPercent}% of its monthly budget`,
        body: `${scopeLabel} has spent ${formatUsd(summary.currentMonthSpendUsd)} out of ${formatUsd(summary.monthlyUsdLimit)} in ${period.key}.`,
        dedupeKey: buildBudgetAlertDedupeKey({
          budgetPolicyId: summary.id,
          kind: "soft-limit",
          periodKey: period.key,
        }),
        metadata: {
          budgetPolicyId: summary.id,
          scopeKind: summary.scopeKind,
          projectId: summary.projectId,
          environmentId: summary.environmentId,
          environment: summary.environment,
          periodKey: period.key,
          currentMonthSpendUsd: summary.currentMonthSpendUsd,
          monthlyUsdLimit: summary.monthlyUsdLimit,
          softLimitPercent: summary.softLimitPercent,
          requestId: requestContext?.requestId ?? null,
          providerRequestId: requestContext?.providerRequestId ?? null,
          provider: requestContext?.provider ?? null,
          model: requestContext?.model ?? null,
        },
      });
      await triggerBudgetAlertReportsSafely(app, context, alert);
    }

    if (summary.hardLimitReached) {
      const alert = await upsertAlertSafely(app, context, {
        workspaceId: summary.workspaceId,
        severity: "critical",
        code: "budget.hard-limit",
        title: `${scopeLabel} exhausted its monthly budget`,
        body: `${scopeLabel} has spent ${formatUsd(summary.currentMonthSpendUsd)} and is now past the ${formatUsd(summary.monthlyUsdLimit)} hard limit for ${period.key}.`,
        dedupeKey: buildBudgetAlertDedupeKey({
          budgetPolicyId: summary.id,
          kind: "hard-limit",
          periodKey: period.key,
        }),
        metadata: {
          budgetPolicyId: summary.id,
          scopeKind: summary.scopeKind,
          projectId: summary.projectId,
          environmentId: summary.environmentId,
          environment: summary.environment,
          periodKey: period.key,
          currentMonthSpendUsd: summary.currentMonthSpendUsd,
          monthlyUsdLimit: summary.monthlyUsdLimit,
          requestId: requestContext?.requestId ?? null,
          providerRequestId: requestContext?.providerRequestId ?? null,
          provider: requestContext?.provider ?? null,
          model: requestContext?.model ?? null,
        },
      });
      await triggerBudgetAlertReportsSafely(app, context, alert);
    }
  }
}

async function upsertBudgetPreflightBlockAlerts(
  app: FastifyInstance,
  context: GatewayContext,
  summaries: BudgetPolicySummary[],
  args: {
    model: string;
    requestId: string;
    provider: string | null;
    estimatedCostUsd: number;
    estimatedPromptTokens: number;
    estimatedCompletionTokens: number;
    completionSource: string;
  },
  now = new Date(),
) {
  const period = getCurrentBudgetPeriod(now);

  for (const summary of summaries) {
    const scopeLabel = formatBudgetScopeLabel(summary);
    const alert = await upsertAlertSafely(app, context, {
      workspaceId: summary.workspaceId,
      severity: "critical",
      code: "budget.preflight-block",
      title: `${scopeLabel} blocked a request before budget headroom was exceeded`,
      body: `${scopeLabel} only has ${formatUsd(summary.remainingUsd)} remaining for ${period.key}, but the incoming ${args.model} request is estimated at ${formatUsd(args.estimatedCostUsd)}.`,
      dedupeKey: buildBudgetAlertDedupeKey({
        budgetPolicyId: summary.id,
        kind: "preflight-block",
        periodKey: period.key,
        model: args.model,
      }),
      metadata: {
        budgetPolicyId: summary.id,
        scopeKind: summary.scopeKind,
        projectId: summary.projectId,
        environmentId: summary.environmentId,
        environment: summary.environment,
        periodKey: period.key,
        remainingUsd: summary.remainingUsd,
        estimatedCostUsd: args.estimatedCostUsd,
        estimatedPromptTokens: args.estimatedPromptTokens,
        estimatedCompletionTokens: args.estimatedCompletionTokens,
        estimatedCompletionSource: args.completionSource,
        requestId: args.requestId,
        providerRequestId: null,
        provider: args.provider,
        model: args.model,
      },
    });
    await triggerBudgetAlertReportsSafely(app, context, alert);
  }
}

async function upsertBudgetPricingUnavailableAlerts(
  app: FastifyInstance,
  context: GatewayContext,
  summaries: BudgetPolicySummary[],
  args: {
    model: string;
    requestId: string;
    provider: string;
  },
) {
  for (const summary of summaries) {
    const scopeLabel = formatBudgetScopeLabel(summary);
    const alert = await upsertAlertSafely(app, context, {
      workspaceId: summary.workspaceId,
      severity: "critical",
      code: "budget.pricing-unavailable",
      title: `${scopeLabel} blocked ${args.model} because pricing is not configured`,
      body: `${scopeLabel} has active budget enforcement, but pricing data is missing for ${args.model} on ${args.provider}. Requests cannot proceed safely until pricing is configured.`,
      dedupeKey: buildBudgetAlertDedupeKey({
        budgetPolicyId: summary.id,
        kind: "pricing-unavailable",
        provider: args.provider,
        model: args.model,
      }),
      metadata: {
        budgetPolicyId: summary.id,
        scopeKind: summary.scopeKind,
        projectId: summary.projectId,
        environmentId: summary.environmentId,
        environment: summary.environment,
        currentMonthSpendUsd: summary.currentMonthSpendUsd,
        monthlyUsdLimit: summary.monthlyUsdLimit,
        remainingUsd: summary.remainingUsd,
        softLimitPercent: summary.softLimitPercent,
        softLimitReached: summary.softLimitReached,
        hardLimitReached: summary.hardLimitReached,
        requestId: args.requestId,
        providerRequestId: null,
        provider: args.provider,
        model: args.model,
      },
    });
    await triggerBudgetAlertReportsSafely(app, context, alert);
  }
}

async function resolveBudgetPricingUnavailableAlertsSafely(
  app: FastifyInstance,
  context: GatewayContext,
  summaries: BudgetPolicySummary[],
  args: {
    provider: string;
    model: string;
  },
) {
  await Promise.all(
    summaries.map(async (summary) => {
      try {
        await resolveBudgetPricingUnavailableAlerts(context.db, {
          budgetPolicyId: summary.id,
          provider: args.provider,
          model: args.model,
        });
      } catch (error) {
        app.log.error(
          {
            err: error,
            workspaceId: summary.workspaceId,
            budgetPolicyId: summary.id,
            provider: args.provider,
            model: args.model,
          },
          "Failed to resolve pricing-unavailable budget alerts",
        );
      }
    }),
  );
}

async function recordResolvedProviderUsage(args: {
  app: FastifyInstance;
  context: GatewayContext;
  requestId: string;
  path: GatewayRequestPath;
  virtualKey: VirtualKey;
  provider: ResolvedProviderCredentials;
  latencyMs: number | null;
  usageEvent: Omit<RecordUsageEventInput, "workspaceId" | "projectId" | "environmentId" | "virtualKeyId" | "providerConnectionId" | "requestId" | "latencyMs">;
}) {
  await appendUsageEventSafely(args.app, args.context, {
    ...args.usageEvent,
    workspaceId: args.virtualKey.workspaceId,
    projectId: args.virtualKey.projectId,
    environmentId: args.virtualKey.environmentId,
    virtualKeyId: args.virtualKey.id,
    providerConnectionId: args.provider.connection.id,
    requestId: args.requestId,
    latencyMs: args.latencyMs,
    metadata: {
      path: args.path,
      httpStatusCode: (args.usageEvent.metadata.httpStatusCode as number | undefined) ?? null,
      ...args.usageEvent.metadata,
    },
  });
}

async function handleGatewayRequest(
  app: FastifyInstance,
  context: GatewayContext,
  request: FastifyRequest,
  reply: FastifyReply,
  path: GatewayRequestPath,
  method: "GET" | "POST" = "POST",
) {
  const requestedModel = getRequestedModel(path, request.body);
  const protocol = getProtocolForPath(path);
  const isMetadataRoute = isMetadataRequestPath(path);
  const demoMode = context.env.DEMO_MODE === "1";
  let gatewayResponseHeaders = buildGatewayResponseHeaders({
    requestId: request.id,
    protocol,
    demoMode,
  });
  const token = getBearerToken(request.headers.authorization);
  if (!token) {
    await appendUsageEventSafely(app, context, {
      workspaceId: null,
      projectId: null,
      environmentId: null,
      virtualKeyId: null,
      providerConnectionId: null,
      requestId: request.id,
      providerRequestId: null,
      provider: null,
      model: requestedModel,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: null,
      status: "blocked",
      metadata: {
        path,
        httpStatusCode: 401,
        reason: "missing_bearer_token",
      },
    });

    applyReplyHeaders(reply, gatewayResponseHeaders);
    reply.code(401);
    return createGatewayErrorReply({
      protocol,
      statusCode: 401,
      message: "Missing bearer token",
      requestId: request.id,
      reason: "missing_bearer_token",
    });
  }

  if (!isVirtualKeyTokenCandidate(token)) {
    await appendUsageEventSafely(app, context, {
      workspaceId: null,
      projectId: null,
      environmentId: null,
      virtualKeyId: null,
      providerConnectionId: null,
      requestId: request.id,
      providerRequestId: null,
      provider: null,
      model: requestedModel,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: null,
      status: "blocked",
      metadata: {
        path,
        httpStatusCode: 401,
        reason: "invalid_virtual_key",
      },
    });

    applyReplyHeaders(reply, gatewayResponseHeaders);
    reply.code(401);
    return createGatewayErrorReply({
      protocol,
      statusCode: 401,
      message: "Invalid virtual key",
      requestId: request.id,
      reason: "invalid_virtual_key",
    });
  }

  const virtualKey = await resolveVirtualKey(context.db, token);
  if (!virtualKey) {
    await appendUsageEventSafely(app, context, {
      workspaceId: null,
      projectId: null,
      environmentId: null,
      virtualKeyId: null,
      providerConnectionId: null,
      requestId: request.id,
      providerRequestId: null,
      provider: null,
      model: requestedModel,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: null,
      status: "blocked",
      metadata: {
        path,
        httpStatusCode: 401,
        reason: "invalid_virtual_key",
      },
    });

    applyReplyHeaders(reply, gatewayResponseHeaders);
    reply.code(401);
    return createGatewayErrorReply({
      protocol,
      statusCode: 401,
      message: "Invalid virtual key",
      requestId: request.id,
      reason: "invalid_virtual_key",
    });
  }

  if (virtualKey.status !== "active") {
    await appendUsageEventSafely(app, context, {
      workspaceId: virtualKey.workspaceId,
      projectId: virtualKey.projectId,
      environmentId: virtualKey.environmentId,
      virtualKeyId: virtualKey.id,
      providerConnectionId: null,
      requestId: request.id,
      providerRequestId: null,
      provider: null,
      model: requestedModel,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: null,
      status: "blocked",
      metadata: {
        path,
        httpStatusCode: 401,
        reason: "virtual_key_not_active",
        virtualKeyStatus: virtualKey.status,
      },
    });

    applyReplyHeaders(reply, gatewayResponseHeaders);
    reply.code(401);
    return createGatewayErrorReply({
      protocol,
      statusCode: 401,
      message: "Invalid virtual key",
      requestId: request.id,
      reason: "virtual_key_not_active",
    });
  }

  if (isVirtualKeyExpired(virtualKey)) {
    await appendUsageEventSafely(app, context, {
      workspaceId: virtualKey.workspaceId,
      projectId: virtualKey.projectId,
      environmentId: virtualKey.environmentId,
      virtualKeyId: virtualKey.id,
      providerConnectionId: virtualKey.providerConnectionId,
      requestId: request.id,
      providerRequestId: null,
      provider: null,
      model: requestedModel,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: null,
      status: "blocked",
      metadata: {
        path,
        httpStatusCode: 401,
        reason: "virtual_key_expired",
        expiresAt: virtualKey.expiresAt,
      },
    });

    applyReplyHeaders(reply, gatewayResponseHeaders);
    reply.code(401);
    return createGatewayErrorReply({
      protocol,
      statusCode: 401,
      message: "Invalid virtual key",
      requestId: request.id,
      reason: "virtual_key_expired",
    });
  }

  const scopeEvaluation = evaluateVirtualKeyScopes(virtualKey, path);
  if (scopeEvaluation.enforced && !scopeEvaluation.allowed) {
    await appendUsageEventSafely(app, context, {
      workspaceId: virtualKey.workspaceId,
      projectId: virtualKey.projectId,
      environmentId: virtualKey.environmentId,
      virtualKeyId: virtualKey.id,
      providerConnectionId: virtualKey.providerConnectionId,
      requestId: request.id,
      providerRequestId: null,
      provider: null,
      model: requestedModel,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: null,
      status: "blocked",
      metadata: {
        path,
        httpStatusCode: 403,
        reason: "virtual_key_scope_denied",
        requiredScope: scopeEvaluation.requiredScope,
        grantedScopes: scopeEvaluation.reservedScopes,
      },
    });

    applyReplyHeaders(reply, gatewayResponseHeaders);
    reply.code(403);
    return createGatewayErrorReply({
      protocol,
      statusCode: 403,
      message: "This virtual key is not allowed to access the requested route",
      requestId: request.id,
      reason: "virtual_key_scope_denied",
    });
  }

  let payload: typeof GatewayRequestStubSchema._type | null = null;
  if (!isMetadataRoute) {
    const parsedPayload = GatewayRequestStubSchema.safeParse(request.body);
    if (!parsedPayload.success) {
      await appendUsageEventSafely(app, context, {
        workspaceId: virtualKey.workspaceId,
        projectId: virtualKey.projectId,
        environmentId: virtualKey.environmentId,
        virtualKeyId: virtualKey.id,
        providerConnectionId: null,
        requestId: request.id,
        providerRequestId: null,
        provider: null,
        model: requestedModel,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        latencyMs: null,
        status: "blocked",
        metadata: {
          path,
          httpStatusCode: 400,
          reason: "invalid_request_body",
          issues: parsedPayload.error.flatten(),
        },
      });

      applyReplyHeaders(reply, gatewayResponseHeaders);
      reply.code(400);
      return createGatewayErrorReply({
        protocol,
        statusCode: 400,
        message: "Invalid request body",
        requestId: request.id,
        reason: "invalid_request_body",
      });
    }

    payload = parsedPayload.data;
  }
  const requestHeaders = normalizeRequestHeaders(request.headers);
  const requestSearch = extractRequestSearch(request.raw.url);
  const startedAt = Date.now();
  let resolvedProvider: ResolvedProviderCredentials | null = null;
  let selectedProvider: ProviderConnectionCandidate | null = null;
  let cleanupUpstreamAbort = () => {};

  try {
    const assignedModels = await listReadyWorkspaceModels({
      db: context.db,
      workspaceId: virtualKey.workspaceId,
      protocol,
    });
    const useLegacyProviderBinding =
      virtualKey.providerConnectionId !== null || assignedModels.length === 0;
    const assignedModelById = new Map(
      assignedModels.map((model) => [normalizeProviderModel(model.modelId), model] as const),
    );

    if (useLegacyProviderBinding) {
      if (virtualKey.providerConnectionId) {
        selectedProvider = await findProviderConnectionCandidateById(
          context.db,
          virtualKey.providerConnectionId,
        );

        if (!selectedProvider) {
          throw new GatewayHttpError(424, "The provider connection bound to this virtual key is not active", {
            reason: "virtual_key_provider_connection_unavailable",
            providerConnectionId: virtualKey.providerConnectionId,
          });
        }

        if (!providerSupportsProtocol(selectedProvider.connection.provider, protocol)) {
          throw new GatewayHttpError(
            409,
            "This virtual key is bound to a provider connection that does not support the requested protocol",
            {
              reason: "virtual_key_provider_protocol_mismatch",
              providerConnectionId: virtualKey.providerConnectionId,
              provider: selectedProvider.connection.provider,
              protocol,
            },
          );
        }

        gatewayResponseHeaders = buildGatewayResponseHeaders({
          requestId: request.id,
          protocol,
          provider: selectedProvider.connection.provider,
          providerConnectionId: selectedProvider.connection.id,
          demoMode,
        });

        if (
          requestedModel &&
          !isConfiguredProviderModelAllowed(
            selectedProvider.metadata,
            selectedProvider.connection.pricingConfig,
            requestedModel,
          )
        ) {
          throw new GatewayHttpError(
            403,
            `The model '${requestedModel}' is not approved for this provider connection`,
            {
              reason: "model_not_allowed_for_provider_connection",
              providerConnectionId: selectedProvider.connection.id,
              requestedModel,
            },
          );
        }
      } else {
        throw new GatewayHttpError(
          409,
          "This virtual key is not bound to an access target. Reissue or update it from Virtual Keys or Access before retrying.",
          {
            reason: "virtual_key_provider_binding_required",
            virtualKeyId: virtualKey.id,
          },
        );
      }
    }

    if (!useLegacyProviderBinding && isMetadataRoute && !requestedModel) {
      await touchVirtualKeyUsage(context.db, virtualKey.id);
      await appendUsageEventSafely(app, context, {
        workspaceId: virtualKey.workspaceId,
        projectId: virtualKey.projectId,
        environmentId: virtualKey.environmentId,
        virtualKeyId: virtualKey.id,
        providerConnectionId: null,
        requestId: request.id,
        providerRequestId: null,
        provider: null,
        model: null,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        status: "success",
        metadata: {
          path,
          protocol,
          httpStatusCode: 200,
          routeMode: "workspace-unified",
        },
      });
      applyReplyHeaders(reply, gatewayResponseHeaders);
      reply.code(200);
      return {
        object: "list",
        data: assignedModels.map((model) => ({
          id: model.modelId,
          object: "model",
          owned_by: "teamops-workspace",
        })),
      };
    }

    if (!useLegacyProviderBinding && requestedModel && !assignedModelById.has(normalizeProviderModel(requestedModel))) {
      throw new GatewayHttpError(
        403,
        `The model '${requestedModel}' is not assigned to this workspace`,
        {
          reason: "workspace_model_not_assigned",
          requestedModel,
          workspaceId: virtualKey.workspaceId,
        },
      );
    }

    if (!useLegacyProviderBinding && isMetadataRoute && requestedModel) {
      const matchedModel = assignedModels.find(
        (model) => normalizeProviderModel(model.modelId) === normalizeProviderModel(requestedModel),
      );
      if (!matchedModel) {
        throw new GatewayHttpError(
          404,
          `The model '${requestedModel}' does not exist`,
          {
            reason: "workspace_model_not_ready",
            requestedModel,
          },
        );
      }

      await touchVirtualKeyUsage(context.db, virtualKey.id);
      await appendUsageEventSafely(app, context, {
        workspaceId: virtualKey.workspaceId,
        projectId: virtualKey.projectId,
        environmentId: virtualKey.environmentId,
        virtualKeyId: virtualKey.id,
        providerConnectionId: null,
        requestId: request.id,
        providerRequestId: null,
        provider: null,
        model: requestedModel,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        status: "success",
        metadata: {
          path,
          protocol,
          httpStatusCode: 200,
          routeMode: "workspace-unified",
        },
      });
      applyReplyHeaders(reply, gatewayResponseHeaders);
      reply.code(200);
      return {
        id: matchedModel.modelId,
        object: "model",
        owned_by: "teamops-workspace",
      };
    }

    if (!useLegacyProviderBinding) {
      const providerCandidates = await listProviderConnectionCandidatesForWorkspace(
        context.db,
        virtualKey.workspaceId,
      );
      const matchingCandidates = providerCandidates.filter(
        (candidate) =>
          providerSupportsProtocol(candidate.connection.provider, protocol) &&
          Boolean(requestedModel) &&
          providerMetadataMatchesRequestedModel(
            candidate.metadata,
            requestedModel,
            candidate.connection.pricingConfig,
          ),
      );
      if (matchingCandidates.length === 0) {
        throw new GatewayHttpError(
          409,
          `No active provider connection in this workspace can route model ${requestedModel}`,
          {
            reason: "workspace_model_no_provider",
            requestedModel,
            workspaceId: virtualKey.workspaceId,
          },
        );
      }

      const pricingReadyCandidates = matchingCandidates.filter(
        (candidate) =>
          getProviderModelPricingCoverageStatus({
            provider: candidate.connection.provider,
            model: requestedModel ?? "",
            pricingConfig: candidate.connection.pricingConfig,
            metadata: candidate.metadata,
          }) !== "uncovered",
      );
      if (pricingReadyCandidates.length === 0) {
        throw new GatewayHttpError(
          403,
          `Pricing for model ${requestedModel} is not configured, so budget enforcement cannot safely proceed`,
          {
            reason: "pricing_not_configured_for_budget_enforcement",
            requestedModel,
            workspaceId: virtualKey.workspaceId,
          },
        );
      }

      const selection = analyzeWorkspaceProviderSelection({
        providers: pricingReadyCandidates,
        protocol,
        requestedModel: requestedModel ?? "",
        headers: requestHeaders,
      });
      if (!selection.ok) {
        throw selection.error;
      }
      selectedProvider = selection.candidate;
    }

    if (!selectedProvider) {
      throw new GatewayHttpError(
        424,
        "No provider connection could be resolved for this request",
        {
          reason: "workspace_model_no_provider",
          requestedModel,
          workspaceId: virtualKey.workspaceId,
        },
      );
    }

    gatewayResponseHeaders = buildGatewayResponseHeaders({
      requestId: request.id,
      protocol,
      provider: selectedProvider.connection.provider,
      providerConnectionId: selectedProvider.connection.id,
      demoMode,
    });

    let applicableBudgets: BudgetPolicySummary[] = [];
    let requestEstimate: ReturnType<typeof estimateRequestCost> | null = null;
    if (!isMetadataRoute) {
      const requestPayload = payload as typeof GatewayRequestStubSchema._type;
      const currentBudgetPeriod = getCurrentBudgetPeriod();
      applicableBudgets = await evaluateApplicableBudgetPolicies(context.db, {
        workspaceId: virtualKey.workspaceId,
        projectId: virtualKey.projectId,
        environmentId: virtualKey.environmentId,
        environment: virtualKey.environment,
      });

      if (applicableBudgets.length > 0) {
        await syncBudgetPolicyAlertsSafely(app, context, applicableBudgets);
      }

      const pricing = resolveModelPricing(
        selectedProvider.connection.provider,
        requestPayload.model,
        selectedProvider.connection.pricingConfig,
        selectedProvider.metadata,
      );
      if (applicableBudgets.length > 0 && !pricing) {
        await upsertBudgetPricingUnavailableAlerts(app, context, applicableBudgets, {
          model: requestPayload.model,
          requestId: request.id,
          provider: selectedProvider.connection.provider,
        });
        const primaryApplicableBudget = getPrimaryBudgetSummaryForEvidence(applicableBudgets);
        const budgetAlertDedupeKey =
          primaryApplicableBudget
            ? buildBudgetAlertDedupeKey({
                budgetPolicyId: primaryApplicableBudget.id,
                kind: "pricing-unavailable",
                provider: selectedProvider.connection.provider,
                model: requestPayload.model,
              })
            : null;

        throw new GatewayHttpError(
          403,
          `Pricing for model ${requestPayload.model} is not configured, so budget enforcement cannot safely proceed`,
          {
            ...(budgetAlertDedupeKey ? { budgetAlertDedupeKey } : {}),
            budgetAlertCode: "budget.pricing-unavailable",
            reason: "pricing_not_configured_for_budget_enforcement",
            ...buildBudgetEvidenceMetadata(applicableBudgets, {
              periodKey: currentBudgetPeriod.key,
              policyIdsKey: "blockedBudgetPolicyIds",
            }),
          },
        );
      }

      if (applicableBudgets.length > 0 && pricing) {
        await resolveBudgetPricingUnavailableAlertsSafely(app, context, applicableBudgets, {
          provider: selectedProvider.connection.provider,
          model: requestPayload.model,
        });
        const estimatedRequest = estimateRequestCost({
          body: request.body as Record<string, unknown>,
          protocol,
          metadata: selectedProvider.metadata,
          pricing,
        });
        requestEstimate = estimatedRequest;
        const preflightBlockedBudgets = applicableBudgets.filter(
          (summary) => summary.remainingUsd > 0 && estimatedRequest.costUsd > summary.remainingUsd,
        );

        if (preflightBlockedBudgets.length > 0) {
          await upsertBudgetPreflightBlockAlerts(app, context, preflightBlockedBudgets, {
            model: requestPayload.model,
            requestId: request.id,
            provider: selectedProvider.connection.provider,
            estimatedCostUsd: estimatedRequest.costUsd,
            estimatedPromptTokens: estimatedRequest.promptTokens,
            estimatedCompletionTokens: estimatedRequest.completionTokens,
            completionSource: estimatedRequest.completionSource,
          });
          const primaryBlockedBudget = getPrimaryBudgetSummaryForEvidence(preflightBlockedBudgets);
          const budgetAlertDedupeKey =
            primaryBlockedBudget
              ? buildBudgetAlertDedupeKey({
                  budgetPolicyId: primaryBlockedBudget.id,
                  kind: "preflight-block",
                  periodKey: currentBudgetPeriod.key,
                  model: requestPayload.model,
                })
              : null;

          throw new GatewayHttpError(403, "Estimated request cost exceeds remaining monthly budget headroom", {
            ...(budgetAlertDedupeKey ? { budgetAlertDedupeKey } : {}),
            budgetAlertCode: "budget.preflight-block",
            reason: "budget_preflight_estimate_exceeds_remaining_headroom",
            ...buildBudgetEvidenceMetadata(preflightBlockedBudgets, {
              periodKey: currentBudgetPeriod.key,
              policyIdsKey: "blockedBudgetPolicyIds",
            }),
            estimatedRequestCostUsd: requestEstimate.costUsd,
            estimatedPromptTokens: requestEstimate.promptTokens,
            estimatedCompletionTokens: requestEstimate.completionTokens,
            estimatedCompletionSource: requestEstimate.completionSource,
          });
        }
      }

      const exhaustedBudgets = applicableBudgets.filter((summary) => summary.hardLimitReached);
      if (exhaustedBudgets.length > 0) {
        await upsertBudgetThresholdAlerts(
          app,
          context,
          exhaustedBudgets,
          {
            requestId: request.id,
            provider: selectedProvider.connection.provider,
            model: requestPayload.model,
          },
        );
        const primaryExhaustedBudget = getPrimaryBudgetSummaryForEvidence(exhaustedBudgets);
        const budgetAlertDedupeKey =
          primaryExhaustedBudget
            ? buildBudgetAlertDedupeKey({
                budgetPolicyId: primaryExhaustedBudget.id,
                kind: "hard-limit",
                periodKey: currentBudgetPeriod.key,
              })
            : null;

        throw new GatewayHttpError(403, "Monthly budget hard limit exceeded for this workspace scope", {
          ...(budgetAlertDedupeKey ? { budgetAlertDedupeKey } : {}),
          budgetAlertCode: "budget.hard-limit",
          reason: "budget_hard_limit_exceeded",
          ...buildBudgetEvidenceMetadata(exhaustedBudgets, {
            periodKey: currentBudgetPeriod.key,
            policyIdsKey: "exhaustedBudgetPolicyIds",
          }),
          estimatedRequestCostUsd: requestEstimate?.costUsd,
          estimatedPromptTokens: requestEstimate?.promptTokens,
          estimatedCompletionTokens: requestEstimate?.completionTokens,
          estimatedCompletionSource: requestEstimate?.completionSource,
        });
      }
    }

    if (!resolvedProvider) {
      resolvedProvider = getDecryptedProviderCredential(selectedProvider, context.env.ENCRYPTION_KEY_BASE64);
    }
    await touchVirtualKeyUsage(context.db, virtualKey.id);

    const upstreamAbort = createUpstreamAbortSignal({
      requestRaw: request.raw,
      replyRaw: reply.raw,
      timeoutMs: resolveUpstreamTimeoutMs(resolvedProvider.metadata),
    });
    cleanupUpstreamAbort = upstreamAbort.cleanup;

    const upstream = await invokeProvider({
      method,
      path,
      search: requestSearch,
      protocol,
      body:
        method === "GET"
          ? requestedModel
            ? { model: requestedModel }
            : {}
          : (request.body as Record<string, unknown>),
      providerConnection: resolvedProvider.connection,
      apiKey: resolvedProvider.apiKey,
      metadata: resolvedProvider.metadata,
      demoMode,
      requestHeaders,
      signal: upstreamAbort.signal,
    });

    if (upstream.responseKind === "stream") {
      reply.hijack();
      reply.raw.statusCode = upstream.statusCode;
      applyRawReplyHeaders(
        reply,
        mergeResponseHeaders(
          upstream.responseHeaders,
          gatewayResponseHeaders,
          buildUpstreamResponseHeaders({
            upstreamStatusCode: upstream.statusCode,
            upstreamRequestId: upstream.upstreamDebug.upstreamRequestId,
            providerRequestId: upstream.upstreamDebug.providerRequestId,
            upstreamContentType: upstream.upstreamDebug.contentType,
          }),
        ),
      );

      let streamError: unknown | null = null;
      let clientDisconnected = false;
      try {
        await pipeline(upstream.responseBody as Readable, reply.raw);
      } catch (error) {
        streamError = error;
        clientDisconnected =
          upstreamAbort.signal.aborted && isClientDisconnectAbortReason(upstreamAbort.signal.reason);

        const logPayload = {
          err: error,
          requestId: request.id,
          provider: resolvedProvider.connection.provider,
        };
        if (clientDisconnected) {
          app.log.info(logPayload, "Gateway stream pipeline ended after client disconnect");
        } else {
          app.log.warn(logPayload, "Gateway stream pipeline terminated early");
        }
      }

      const usageEvent = finalizeStreamUsageEvent({
        usageEvent: await upstream.usageEventPromise,
        streamError,
        clientDisconnected,
      });
      await recordResolvedProviderUsage({
        app,
        context,
        requestId: request.id,
        path,
        virtualKey,
        provider: resolvedProvider,
        latencyMs: Date.now() - startedAt,
        usageEvent: {
          ...usageEvent,
          metadata: {
            path,
            protocol,
            httpStatusCode: upstream.statusCode,
            ...usageEvent.metadata,
          },
        },
      });

      if (applicableBudgets.length > 0) {
        const postUsageBudgets = applicableBudgets.map((summary) => applyUsageCostToBudget(summary, usageEvent.costUsd));
        await syncBudgetPolicyAlertsSafely(app, context, postUsageBudgets);
        await upsertBudgetThresholdAlerts(
          app,
          context,
          postUsageBudgets,
          {
            requestId: request.id,
            providerRequestId: usageEvent.providerRequestId,
            provider: resolvedProvider.connection.provider,
            model: usageEvent.model,
          },
        );
      }

      return;
    }

    const usageEvent = await upstream.usageEventPromise;
    await recordResolvedProviderUsage({
      app,
      context,
      requestId: request.id,
      path,
      virtualKey,
      provider: resolvedProvider,
      latencyMs: Date.now() - startedAt,
      usageEvent: {
        ...usageEvent,
        metadata: {
          path,
          protocol,
          httpStatusCode: upstream.statusCode,
          ...usageEvent.metadata,
        },
      },
    });

    if (applicableBudgets.length > 0) {
      const postUsageBudgets = applicableBudgets.map((summary) => applyUsageCostToBudget(summary, usageEvent.costUsd));
      await syncBudgetPolicyAlertsSafely(app, context, postUsageBudgets);
      await upsertBudgetThresholdAlerts(
        app,
        context,
        postUsageBudgets,
        {
          requestId: request.id,
          providerRequestId: usageEvent.providerRequestId,
          provider: resolvedProvider.connection.provider,
          model: usageEvent.model,
        },
      );
    }

    applyReplyHeaders(
      reply,
      mergeResponseHeaders(
        upstream.responseHeaders,
        gatewayResponseHeaders,
        buildUpstreamResponseHeaders({
          upstreamStatusCode: upstream.statusCode,
          upstreamRequestId: upstream.upstreamDebug.upstreamRequestId,
          providerRequestId: usageEvent.providerRequestId ?? upstream.upstreamDebug.providerRequestId,
          upstreamContentType: upstream.upstreamDebug.contentType,
        }),
      ),
    );
    reply.code(upstream.statusCode);
    return useLegacyProviderBinding && selectedProvider && path === "/v1/models"
      ? filterConfiguredModelCatalogResponse(
          selectedProvider.metadata,
          selectedProvider.connection.pricingConfig,
          upstream.responseBody,
        )
      : upstream.responseBody;
  } catch (error) {
    const statusCode = isGatewayHttpError(error) ? error.statusCode : 500;
    const responseMessage = error instanceof Error ? error.message : "Gateway request failed";
    const failureStatus = isGatewayHttpError(error) && statusCode < 500 && statusCode !== 499 ? "blocked" : "error";

    await appendUsageEventSafely(app, context, {
      workspaceId: virtualKey.workspaceId,
      projectId: virtualKey.projectId,
      environmentId: virtualKey.environmentId,
      virtualKeyId: virtualKey.id,
      providerConnectionId: resolvedProvider?.connection.id ?? null,
      requestId: request.id,
      providerRequestId: null,
      provider: resolvedProvider?.connection.provider ?? selectedProvider?.connection.provider ?? null,
      model: payload?.model ?? null,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      status: failureStatus,
      metadata: {
        path,
        protocol,
        httpStatusCode: statusCode,
        reason:
          statusCode === 499
            ? "client_disconnected"
            : isGatewayHttpError(error) && statusCode < 500
            ? "gateway_request_blocked"
            : statusCode >= 500
              ? "gateway_request_failed"
              : "gateway_request_rejected",
        ...(isGatewayHttpError(error) ? error.metadata : {}),
        error: responseMessage,
      },
    });

    const logPayload = {
      err: error,
      requestId: request.id,
      path,
      protocol,
      provider: resolvedProvider?.connection.provider ?? selectedProvider?.connection.provider ?? null,
    };
    if (statusCode === 499) {
      app.log.info(
        logPayload,
        "Gateway request ended after client disconnect",
      );
    } else {
      app.log.error(
        logPayload,
        "Gateway request failed",
      );
    }

    if (statusCode === 499 || reply.raw.destroyed) {
      return;
    }

    applyReplyHeaders(reply, gatewayResponseHeaders);
    reply.code(statusCode);
    return createGatewayErrorReply({
      protocol,
      statusCode,
      message: responseMessage,
      requestId: request.id,
      reason:
        typeof (isGatewayHttpError(error) ? error.metadata.reason : undefined) === "string"
          ? String((isGatewayHttpError(error) ? error.metadata.reason : undefined) as string)
          : undefined,
    });
  } finally {
    cleanupUpstreamAbort();
  }
}

export async function registerGatewayRoutes(app: FastifyInstance, context: GatewayContext) {
  app.get("/healthz", async () => {
    await pingDatabase(context.db);
    return {
      service: "gateway",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  });

  app.post("/v1/messages", async (request, reply) => {
    return handleGatewayRequest(app, context, request, reply, "/v1/messages");
  });

  app.post("/v1/chat/completions", async (request, reply) => {
    return handleGatewayRequest(app, context, request, reply, "/v1/chat/completions");
  });

  app.post("/v1/responses", async (request, reply) => {
    return handleGatewayRequest(app, context, request, reply, "/v1/responses");
  });

  app.get("/v1/models", async (request, reply) => {
    return handleGatewayRequest(app, context, request, reply, "/v1/models", "GET");
  });

  app.get<{ Params: { modelId: string } }>("/v1/models/:modelId", async (request, reply) => {
    const modelPath = `/v1/models/${encodeURIComponent(request.params.modelId)}` as const;
    return handleGatewayRequest(app, context, request, reply, modelPath, "GET");
  });
}
