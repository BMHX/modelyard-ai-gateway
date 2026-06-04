import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";

import type { Alert } from "@teamops/contracts";

import { AlertCollaborationPanel } from "../../components/alert-collaboration-panel";
import { AppShell } from "../../components/app-shell";
import { buildAlertHref, buildUsageEventHref } from "../../lib/navigation";
import {
  buildAlertAuditHref,
  buildAlertBudgetsHref,
  buildAlertUsageFilters,
  buildAlertUsageHref,
  describeAlertUsageFilters,
  getAlertMetadataBoolean,
  getAlertMetadataNumber,
  getAlertMetadataRecord,
  getAlertMetadataString,
  getAlertScopeInfo,
} from "../presentation";
import { buildAlertCollaborationState } from "../collaboration";
import { reopenAlertAction, resolveAlertAction, updateAlertCollaborationAction } from "../actions";
import {
  getAlert,
  listAuditLogs,
  listBudgetSummaries,
  listProjects,
  listUsageEvents,
  listWorkspaceEnvironments,
} from "../../lib/control-api";
import enAlertsMessages from "../../messages/en/alerts.json";
import zhAlertsMessages from "../../messages/zh/alerts.json";
import { type AppLocale, translateInlineText } from "../../lib/i18n";
import { formatAuditActorLabel } from "../../lib/audit-display";
import { getCurrentLocale } from "../../lib/i18n-server";

export const dynamic = "force-dynamic";

type AlertDetailPageProps = {
  params: Promise<{
    alertId: string;
  }>;
  searchParams?: Promise<{
    returnTo?: string;
  }>;
};

type TranslationValues = Record<string, string | number>

function formatMessage(template: string, values?: TranslationValues) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function createAlertsTranslator(locale: AppLocale) {
  const messages = locale === "zh" ? zhAlertsMessages : enAlertsMessages;
  return (text: string, values?: TranslationValues) => {
    const maybeTemplate = (messages as Record<string, unknown>)[text];
    const template = typeof maybeTemplate === "string" ? maybeTemplate : translateInlineText(locale, text);
    return formatMessage(template, values);
  };
}

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

function createFormatters(locale: AppLocale) {
  const intlLocale = getIntlLocale(locale);

  return {
    formatDateTime(value: string) {
      return new Intl.DateTimeFormat(intlLocale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    },
    formatInteger(value: number | null) {
      if (value === null) {
        return "n/a";
      }

      return new Intl.NumberFormat(intlLocale).format(value);
    },
    formatUsd(value: number | null) {
      if (value === null) {
        return "n/a";
      }

      const formatted = new Intl.NumberFormat(intlLocale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
      return locale === "zh" ? formatted.replace(/^US\$/, "美元 ") : formatted;
    },
    formatUsd4(value: number) {
      const formatted = new Intl.NumberFormat(intlLocale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }).format(value);
      return locale === "zh" ? formatted.replace(/^US\$/, "美元 ") : formatted;
    },
  };
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

function buildBackHref(alert: Alert, requestedReturnTo?: string) {
  if (requestedReturnTo && requestedReturnTo.startsWith("/")) {
    return requestedReturnTo;
  }

  return `/alerts?workspaceId=${alert.workspaceId}`;
}

function getMonthProgress(now = new Date()) {
  const elapsedDays = now.getDate();
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  return {
    elapsedDays,
    totalDays,
  };
}

function getProjectedMonthlySpend(currentMonthSpendUsd: number, now = new Date()) {
  const { elapsedDays, totalDays } = getMonthProgress(now);
  if (elapsedDays <= 0) {
    return currentMonthSpendUsd;
  }

  return Number(((currentMonthSpendUsd / elapsedDays) * totalDays).toFixed(2));
}

function getDailyBurnRate(currentMonthSpendUsd: number, now = new Date()) {
  const { elapsedDays } = getMonthProgress(now);
  if (elapsedDays <= 0) {
    return 0;
  }

  return Number((currentMonthSpendUsd / elapsedDays).toFixed(2));
}

function getDaysUntilThreshold(currentMonthSpendUsd: number, thresholdUsd: number, now = new Date()) {
  const burnRate = getDailyBurnRate(currentMonthSpendUsd, now);
  if (burnRate <= 0 || thresholdUsd <= currentMonthSpendUsd) {
    return null;
  }

  return Math.ceil((thresholdUsd - currentMonthSpendUsd) / burnRate);
}

function formatDaysLabel(value: number | null, tr: ReturnType<typeof createAlertsTranslator>) {
  if (value === null) {
    return tr("n/a");
  }

  if (value <= 0) {
    return tr("days.today");
  }

  if (value === 1) {
    return tr("days.oneDay");
  }

  return tr("days.multiple", { count: value });
}

function buildImpactSummary(args: {
  alert: Alert;
  metadata: Record<string, unknown>;
  relatedUsageCount: number;
  blockedUsageCount: number;
  formatUsd: (value: number | null) => string;
  tr: ReturnType<typeof createAlertsTranslator>;
}) {
  const spend = getAlertMetadataNumber(args.metadata, "currentMonthSpendUsd");
  const limit = getAlertMetadataNumber(args.metadata, "monthlyUsdLimit");
  const remaining = getAlertMetadataNumber(args.metadata, "remainingUsd");
  const blockedText =
    args.blockedUsageCount > 0 ?
      args.tr("detail.impact.blockedUsage", { blocked: args.blockedUsageCount, total: args.relatedUsageCount })
    : args.relatedUsageCount > 0 ?
      args.tr("detail.impact.recentUsage", { count: args.relatedUsageCount })
    : args.tr("detail.impact.noRecentUsage");
  const spendText =
    spend !== null && limit !== null ?
      args.tr("detail.impact.spendSummary", { spend: args.formatUsd(spend), limit: args.formatUsd(limit), remaining: args.formatUsd(remaining) })
    : args.tr("detail.impact.budgetIncomplete");

  if (args.alert.code === "budget.hard-limit" || args.alert.code === "budget.preflight-block") {
    return {
      className: "notice notice--error",
      title: args.tr("detail.impact.blockedTitle"),
      body: `${blockedText} ${spendText}`,
    };
  }

  if (args.alert.code === "budget.pricing-unavailable") {
    return {
      className: "notice notice--error",
      title: args.tr("detail.impact.pricingUnavailableTitle"),
      body: `${blockedText} ${args.tr("detail.impact.pricingUnavailableBody")} ${spendText}`,
    };
  }

  return {
    className: "notice",
    title: args.tr("detail.impact.warningTitle"),
    body: `${blockedText} ${spendText}`,
  };
}

function buildSuggestedActions(args: {
  alert: Alert;
  hasStoredOwner: boolean;
  hasStoredRunbook: boolean;
  hasStoredTicket: boolean;
  ackState: "needs-ack" | "acknowledged" | "resolved";
  relatedBudgetDaysToHardLimit: number | null;
  relatedBudgetProjectedSpend: number | null;
  relatedBudgetLimit: number | null;
  tr: ReturnType<typeof createAlertsTranslator>;
}) {
  const actions: string[] = [];

  if (args.alert.status === "open" && args.ackState === "needs-ack") {
    actions.push("detail.actions.acknowledgeNow");
  }

  if (!args.hasStoredOwner) {
    actions.push("detail.actions.assignOwner");
  }

  if (args.alert.code === "budget.pricing-unavailable") {
    actions.push("detail.actions.restorePricing");
  } else if (
    args.relatedBudgetProjectedSpend !== null &&
    args.relatedBudgetLimit !== null &&
    args.relatedBudgetProjectedSpend >= args.relatedBudgetLimit
  ) {
    actions.push(
      args.tr("detail.actions.projectedSpendBreach", { eta: formatDaysLabel(args.relatedBudgetDaysToHardLimit, args.tr) }),
    );
  } else {
    actions.push("detail.actions.openUsage");
  }

  if (!args.hasStoredRunbook) {
    actions.push("detail.actions.attachRunbook");
  }

  if (!args.hasStoredTicket) {
    actions.push("detail.actions.attachTicket");
  }

  return actions.slice(0, 4);
}

function formatAuditActionLabel(action: string, tr: ReturnType<typeof createAlertsTranslator>) {
  if (action === "alert.resolved") {
    return tr("detail.audit.action.resolved");
  }

  if (action === "alert.reopened") {
    return tr("detail.audit.action.reopened");
  }

  if (action === "alert.collaboration_updated") {
    return tr("detail.audit.action.handoffUpdated");
  }

  if (action === "alert.updated") {
    return tr("detail.audit.action.updated");
  }

  return tr("detail.audit.action.other", { action: action.replaceAll(".", " ") });
}

function buildAuditActionSummary(payload: unknown, tr: ReturnType<typeof createAlertsTranslator>) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return tr("detail.audit.summary.generic");
  }

  const record = payload as Record<string, unknown>;
  const previousStatus = typeof record.previousStatus === "string" ? record.previousStatus : null;
  const newStatus = typeof record.newStatus === "string" ? record.newStatus : null;
  const metadataPatch =
    record.metadataPatch && typeof record.metadataPatch === "object" && !Array.isArray(record.metadataPatch) ?
      (record.metadataPatch as Record<string, unknown>)
    : null;

  if (metadataPatch) {
    type ChangedField = "owner" | "ack" | "note" | "sla" | "runbook" | "ticket";
    const changedFields = [
      "collaborationOwnerLabel" in metadataPatch ? "owner" : null,
      "collaborationAckState" in metadataPatch ? "ack" : null,
      "collaborationNote" in metadataPatch ? "note" : null,
      "collaborationSlaDueAt" in metadataPatch ? "sla" : null,
      "collaborationRunbookHref" in metadataPatch ? "runbook" : null,
      "collaborationTicketHref" in metadataPatch ? "ticket" : null,
    ].filter((field): field is ChangedField => Boolean(field));

    if (changedFields.length) {
      const fieldLabelMap: Record<string, string> = {
        owner: tr("Owner"),
        ack: tr("Ack state"),
        note: tr("Operator note"),
        sla: tr("SLA due"),
        runbook: tr("Runbook"),
        ticket: tr("Ticket"),
      };

      const fieldLabels = changedFields.map((field) => fieldLabelMap[field] ?? field);
      return tr("detail.audit.summary.fieldsUpdated", { fields: fieldLabels.join(", ") });
    }
  }

  if (previousStatus && newStatus && previousStatus !== newStatus) {
    return tr("detail.audit.summary.statusChanged", {
      previous: tr(previousStatus),
      next: tr(newStatus),
    });
  }

  return tr("detail.audit.summary.generic");
}

function buildWorkflowTimeline(args: {
  alert: Alert;
  auditTrail: Array<{
    id: string;
    action: string;
    actorId: string;
    actorType: string;
    payload: unknown;
    createdAt: string;
  }>;
  locale: AppLocale;
  tr: ReturnType<typeof createAlertsTranslator>;
}) {
  const items = [
    {
      key: `created-${args.alert.id}`,
      title: args.tr("detail.timeline.detected.title"),
      body: args.tr("detail.timeline.detected.body", { severity: args.tr(args.alert.severity) }),
      createdAt: args.alert.createdAt,
      current: false,
      actor: args.tr("detail.timeline.actor.system"),
    },
    ...[...args.auditTrail]
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map((entry) => ({
        key: entry.id,
        title: formatAuditActionLabel(entry.action, args.tr),
        body: buildAuditActionSummary(entry.payload, args.tr),
        createdAt: entry.createdAt,
        current: false,
        actor: `${formatAuditActorLabel(entry.actorId, args.locale)} · ${entry.actorType}`,
      })),
  ];

  if (!items.length) {
    return [];
  }

  items[items.length - 1] = {
    ...items[items.length - 1],
    current: true,
  };

  return items.slice(-6);
}

export default async function AlertDetailPage({ params, searchParams }: AlertDetailPageProps) {
  const locale = await getCurrentLocale();
  const tr = createAlertsTranslator(locale);
  const { formatDateTime, formatInteger, formatUsd, formatUsd4 } = createFormatters(locale);
  const { alertId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const alert = await getAlert(alertId);

  if (!alert) {
    notFound();
  }

  const [projects, environments, budgets] = await Promise.all([
    listProjects(alert.workspaceId),
    listWorkspaceEnvironments(alert.workspaceId),
    listBudgetSummaries(alert.workspaceId),
  ]);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const environmentsById = new Map(environments.map((environment) => [environment.id, environment]));
  const metadata = getAlertMetadataRecord(alert.metadata);
  const scopeInfo = getAlertScopeInfo({
    alert,
    projectsById,
    environmentsById,
  });
  const backHref = buildBackHref(alert, resolvedSearchParams.returnTo);
  const alertDetailHref = buildAlertHref(alert.id, resolvedSearchParams.returnTo);
  const relatedUsageFilters = buildAlertUsageFilters(alert);
  const [relatedUsage, auditTrail] = await Promise.all([
    listUsageEvents(alert.workspaceId, {
      limit: 5,
      projectId: relatedUsageFilters.projectId,
      environmentId: relatedUsageFilters.environmentId,
      model: relatedUsageFilters.model,
      requestId: relatedUsageFilters.requestId,
      providerRequestId: relatedUsageFilters.providerRequestId,
      status: relatedUsageFilters.status ?? undefined,
    }),
    listAuditLogs({
      workspaceId: alert.workspaceId,
      subjectType: "alert",
      subjectId: alert.id,
      limit: 10,
      offset: 0,
    }),
  ]);

  const collaborationState = buildAlertCollaborationState({
    alert,
    scopeInfo,
    returnTo: alertDetailHref,
    locale,
  });
  const relatedBudget = scopeInfo.budgetPolicyId ? budgets.find((budget) => budget.id === scopeInfo.budgetPolicyId) ?? null : null;
  const relatedBudgetProjectedSpend = relatedBudget ? getProjectedMonthlySpend(relatedBudget.currentMonthSpendUsd) : null;
  const relatedBudgetBurnRate = relatedBudget ? getDailyBurnRate(relatedBudget.currentMonthSpendUsd) : null;
  const relatedBudgetDaysToSoftLimit = relatedBudget ? getDaysUntilThreshold(relatedBudget.currentMonthSpendUsd, relatedBudget.softLimitUsd) : null;
  const relatedBudgetDaysToHardLimit = relatedBudget ? getDaysUntilThreshold(relatedBudget.currentMonthSpendUsd, relatedBudget.monthlyUsdLimit) : null;
  const relatedUsageBlockedCount = relatedUsage.items.filter((event) => event.status === "blocked").length;
  const relatedUsageErrorCount = relatedUsage.items.filter((event) => event.status === "error").length;
  const latestUsageEvent = relatedUsage.items[0] ?? null;
  const impactSummary = buildImpactSummary({
    alert,
    metadata,
    relatedUsageCount: relatedUsage.items.length,
    blockedUsageCount: relatedUsageBlockedCount,
    formatUsd,
    tr,
  });
  const hasStoredOwner = Boolean(getAlertMetadataString(metadata, "collaborationOwnerLabel"));
  const hasStoredRunbook = Boolean(getAlertMetadataString(metadata, "collaborationRunbookHref"));
  const hasStoredTicket = Boolean(getAlertMetadataString(metadata, "collaborationTicketHref"));
  const suggestedActions = buildSuggestedActions({
    alert,
    hasStoredOwner,
    hasStoredRunbook,
    hasStoredTicket,
    ackState: collaborationState.ackState,
    relatedBudgetDaysToHardLimit,
    relatedBudgetProjectedSpend,
    relatedBudgetLimit: relatedBudget?.monthlyUsdLimit ?? null,
    tr,
  });
  const workflowTimeline = buildWorkflowTimeline({
    alert,
    auditTrail: auditTrail.items,
    locale,
    tr,
  });

  return (
    <AppShell
      headerMode="compact"
      sidebarVariant="minimal"
      showOperatorContextCards={false}
      showSupportPanels={false}
      title={tr("Alert Detail")}
      subtitle=""
      workspaceId={alert.workspaceId}
    >
      <section className="legacy-grid">
        <article className="card span-12">
          <div className="resource-card__header">
            <div className="cell-stack">
              <Link className="detail-link" href={backHref}>
                {tr("Back to alerts")}
              </Link>
              <h2>{alert.title}</h2>
              <span className="meta">
                {alert.code} · {formatDateTime(alert.createdAt)} · {scopeInfo.label}
              </span>
            </div>
            <div className="badge-row">
              <span className={`tag${alert.severity === "critical" ? " tag--critical" : alert.severity === "warning" ? " tag--warning" : ""}`}>
                {tr(alert.severity)}
              </span>
              <span className={`tag${alert.status === "resolved" ? " tag--resolved" : ""}`}>{tr(alert.status)}</span>
              <span className={`tag${collaborationState.ackState === "resolved" ? " tag--resolved" : collaborationState.ackState === "needs-ack" ? " tag--critical" : " tag--warning"}`}>
                {collaborationState.ackState}
              </span>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
            <div className="stack stack--tight">
              <div className={impactSummary.className}>
                <div className="cell-stack">
                  <strong>{impactSummary.title}</strong>
                  <span className="meta">{impactSummary.body}</span>
                </div>
              </div>

              <div className="metric-grid metric-grid--compact">
                <div className="metric-card">
                  <span className="meta">{tr("Scope")}</span>
                  <strong>{scopeInfo.label}</strong>
                </div>
                <div className="metric-card">
                  <span className="meta">{tr("Spend")}</span>
                  <strong>{formatUsd(getAlertMetadataNumber(metadata, "currentMonthSpendUsd"))}</strong>
                </div>
                <div className="metric-card">
                  <span className="meta">{tr("Blocked usage")}</span>
                  <strong>{relatedUsageBlockedCount}</strong>
                </div>
              </div>

              <div className="inline-actions">
                {alert.status === "open" && collaborationState.ackState === "needs-ack" ? (
                  <form action={updateAlertCollaborationAction}>
                    <input type="hidden" name="alertId" value={alert.id} />
                    <input type="hidden" name="redirectPath" value={alertDetailHref} />
                    <input type="hidden" name="ackState" value="acknowledged" />
                    <input type="hidden" name="ownerLabel" value={collaborationState.ownerLabel} />
                    <input type="hidden" name="note" value={collaborationState.latestNote ?? ""} />
                    <input type="hidden" name="slaDueAt" value={getAlertMetadataString(metadata, "collaborationSlaDueAt") ?? ""} />
                    <input type="hidden" name="runbookHref" value={collaborationState.runbookHref} />
                    <input type="hidden" name="runbookLabel" value={collaborationState.runbookLabel} />
                    <input type="hidden" name="ticketHref" value={collaborationState.ticketHref} />
                    <input type="hidden" name="ticketLabel" value={collaborationState.ticketLabel} />
                    <button className="button" type="submit">
                      {tr("Acknowledge alert")}
                    </button>
                  </form>
                ) : null}
                <form action={alert.status === "open" ? resolveAlertAction : reopenAlertAction}>
                  <input type="hidden" name="alertId" value={alert.id} />
                  <input type="hidden" name="redirectPath" value={alertDetailHref} />
                  <button className="button button--ghost" type="submit">
                    {alert.status === "open" ? tr("Resolve alert") : tr("Reopen alert")}
                  </button>
                </form>
                <Link className="button button--ghost" href={buildAlertUsageHref(alert, alertDetailHref)}>{tr("Usage")}</Link>
                <Link className="button button--ghost" href={buildAlertBudgetsHref(alert, alertDetailHref)}>{tr("Budget")}</Link>
                <Link className="button button--ghost" href={buildAlertAuditHref(alert, alertDetailHref)}>{tr("Audit")}</Link>
              </div>
            </div>

            <div className="stack stack--tight">
              <AlertCollaborationPanel collaboration={collaborationState} />
              <div className="notice">
                <p>{suggestedActions[0] ? tr(suggestedActions[0]) : tr("Keep collaboration details compact and edit them only when handoff changes.")}</p>
              </div>
            </div>
          </div>
        </article>

        <article className="card span-12">
          <div className="resource-card__header">
            <div className="cell-stack">
              <h2>{tr("Related pivots")}</h2>
              <span className="meta">{describeAlertUsageFilters(alert, { projectsById, environmentsById })}</span>
            </div>
          </div>
          <div className="inline-actions">
            <Link className="button button--ghost" href={buildAlertUsageHref(alert, alertDetailHref)}>
              {tr("Open filtered usage")}
            </Link>
            <Link className="button button--ghost" href={buildAlertBudgetsHref(alert, alertDetailHref)}>
              {tr("Open budget context")}
            </Link>
            <Link className="button button--ghost" href={buildAlertAuditHref(alert, alertDetailHref)}>
              {tr("Open filtered audit logs")}
            </Link>
          </div>
          <div className="metric-grid metric-grid--compact">
            <div className="metric-card">
              <span className="meta">{tr("Related usage")}</span>
              <strong>{relatedUsage.items.length}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Blocked / errored")}</span>
              <strong>
                {relatedUsageBlockedCount} / {relatedUsageErrorCount}
              </strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Latest model")}</span>
              <strong>{latestUsageEvent?.model ?? getAlertMetadataString(metadata, "model") ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Budget policy")}</span>
              <strong>{scopeInfo.budgetPolicyId ?? tr("n/a")}</strong>
            </div>
            {relatedBudget ? (
              <>
                <div className="metric-card">
                  <span className="meta">{tr("Burn rate")}</span>
                  <strong>{formatUsd(relatedBudgetBurnRate)}</strong>
                </div>
                <div className="metric-card">
                  <span className="meta">{tr("Soft ETA")}</span>
                  <strong>{formatDaysLabel(relatedBudgetDaysToSoftLimit, tr)}</strong>
                </div>
              </>
            ) : null}
          </div>
        </article>

        <details className="metadata-disclosure">
          <summary>{tr("Supporting context")}</summary>
          <div className="metric-grid metric-grid--compact">
            <div className="metric-card">
              <span className="meta">{tr("Workspace")}</span>
              <strong className="mono mono--wrap">{alert.workspaceId}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Project")}</span>
              <strong>{scopeInfo.projectName ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Environment")}</span>
              <strong>{scopeInfo.environmentName ?? scopeInfo.environmentRuntime ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Budget policy")}</span>
              <strong className="mono mono--wrap">{scopeInfo.budgetPolicyId ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Period")}</span>
              <strong>{getAlertMetadataString(metadata, "periodKey") ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Resolved at")}</span>
              <strong>{alert.resolvedAt ? formatDateTime(alert.resolvedAt) : tr("Not resolved")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Dedupe key")}</span>
              <strong className="mono mono--wrap">{getAlertMetadataString(metadata, "dedupeKey") ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Request ID")}</span>
              <strong className="mono mono--wrap">{getAlertMetadataString(metadata, "requestId") ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Provider request")}</span>
              <strong className="mono mono--wrap">{getAlertMetadataString(metadata, "providerRequestId") ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Model")}</span>
              <strong>{getAlertMetadataString(metadata, "model") ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Provider")}</span>
              <strong>{getAlertMetadataString(metadata, "provider") ?? tr("n/a")}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Estimated cost")}</span>
              <strong>{formatUsd(getAlertMetadataNumber(metadata, "estimatedCostUsd"))}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Prompt tokens")}</span>
              <strong>{formatInteger(getAlertMetadataNumber(metadata, "estimatedPromptTokens"))}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Completion tokens")}</span>
              <strong>{formatInteger(getAlertMetadataNumber(metadata, "estimatedCompletionTokens"))}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Soft / hard limit")}</span>
              <strong>
                {getAlertMetadataBoolean(metadata, "softLimitReached") === null
                  ? tr("n/a")
                  : getAlertMetadataBoolean(metadata, "softLimitReached")
                    ? tr("soft reached")
                    : tr("soft clear")}
                {" · "}
                {getAlertMetadataBoolean(metadata, "hardLimitReached") === null
                  ? tr("n/a")
                  : getAlertMetadataBoolean(metadata, "hardLimitReached")
                    ? tr("hard reached")
                    : tr("hard clear")}
              </strong>
            </div>
          </div>
        </details>

        <details className="metadata-disclosure">
          <summary>{tr("Suggested actions")}</summary>
          <div className="readiness-list">
            {suggestedActions.map((item) => (
              <div key={item} className="readiness-item">
                <strong>{tr(item)}</strong>
              </div>
            ))}
          </div>
        </details>

        <details className="metadata-disclosure">
          <summary>{tr("Edit handoff")}</summary>
          <div className="notice">
            <p>{tr("Keep collaboration edits here so the record stays quiet by default.")}</p>
          </div>
          <form className="form-grid" action={updateAlertCollaborationAction}>
            <input type="hidden" name="alertId" value={alert.id} />
            <input type="hidden" name="redirectPath" value={alertDetailHref} />
            <div className="form-grid form-grid--inline">
              <div className="field">
                <label htmlFor="alert-owner-label">{tr("Owner")}</label>
                <input id="alert-owner-label" name="ownerLabel" defaultValue={collaborationState.ownerLabel} />
              </div>
              <div className="field">
                <label htmlFor="alert-ack-state">{tr("Acknowledge state")}</label>
                <select id="alert-ack-state" name="ackState" defaultValue={collaborationState.ackState}>
                  <option value="needs-ack">{tr("needs-ack")}</option>
                  <option value="acknowledged">{tr("acknowledged")}</option>
                  <option value="resolved">{tr("resolved")}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="alert-sla-due-at">{tr("SLA due")}</label>
                <input
                  id="alert-sla-due-at"
                  name="slaDueAt"
                  type="datetime-local"
                  defaultValue={formatDateTimeLocalInput(getAlertMetadataString(metadata, "collaborationSlaDueAt"))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="alert-note">{tr("Operator note")}</label>
              <textarea id="alert-note" name="note" defaultValue={collaborationState.latestNote ?? ""} rows={4} />
            </div>
            <div className="form-grid form-grid--inline">
              <div className="field">
                <label htmlFor="alert-runbook-href">{tr("Runbook URL")}</label>
                <input id="alert-runbook-href" name="runbookHref" defaultValue={collaborationState.runbookHref} />
              </div>
              <div className="field">
                <label htmlFor="alert-runbook-label">{tr("Runbook label")}</label>
                <input id="alert-runbook-label" name="runbookLabel" defaultValue={collaborationState.runbookLabel} />
              </div>
            </div>
            <div className="form-grid form-grid--inline">
              <div className="field">
                <label htmlFor="alert-ticket-href">{tr("Ticket URL")}</label>
                <input id="alert-ticket-href" name="ticketHref" defaultValue={collaborationState.ticketHref} />
              </div>
              <div className="field">
                <label htmlFor="alert-ticket-label">{tr("Ticket label")}</label>
                <input id="alert-ticket-label" name="ticketLabel" defaultValue={collaborationState.ticketLabel} />
              </div>
            </div>
            <div className="inline-actions">
              <button className="button" type="submit">
                {tr("Save handoff")}
              </button>
              <Link className="button button--ghost" href={collaborationState.runbookHref}>
                {tr("Open runbook")}
              </Link>
              <Link className="button button--ghost" href={collaborationState.ticketHref}>
                {tr("Open ticket")}
              </Link>
            </div>
          </form>
        </details>

        <details className="metadata-disclosure">
          <summary>{tr("Workflow history")}</summary>
          <div className="timeline">
            {workflowTimeline.map((item) => (
              <div key={item.key} className={`timeline__item${item.current ? " timeline__item--current" : ""}`}>
                <div className="timeline__marker" />
                <div className="timeline__content">
                  <div className="resource-card__header">
                    <div className="cell-stack">
                      <strong>{item.title}</strong>
                      <span className="meta">{item.body}</span>
                    </div>
                    <div className="cell-stack">
                      <strong>{formatDateTime(item.createdAt)}</strong>
                      <span className="meta">{item.actor}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </details>

        <details className="metadata-disclosure">
          <summary>{tr("Recent usage")}</summary>
          {relatedUsage.items.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>{tr("Time")}</th>
                  <th>{tr("Model")}</th>
                  <th>{tr("Status")}</th>
                  <th>{tr("Cost")}</th>
                  <th>{tr("Tokens")}</th>
                </tr>
              </thead>
              <tbody>
                {relatedUsage.items.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.createdAt)}</td>
                    <td>
                      <Link className="detail-link" href={buildUsageEventHref(event.id, alertDetailHref)}>
                        {event.model ?? tr("unknown")}
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`tag${
                          event.status === "blocked" ? " tag--critical" : event.status === "error" ? " tag--warning" : ""
                        }`}
                      >
                        {tr(event.status)}
                      </span>
                    </td>
                    <td>{formatUsd4(event.costUsd)}</td>
                    <td>{formatInteger(event.totalTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">{tr("No recent usage events matched this alert context.")}</div>
          )}
        </details>

        <details className="metadata-disclosure">
          <summary>{tr("Audit trail")}</summary>
          {auditTrail.items.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>{tr("Time")}</th>
                  <th>{tr("Action")}</th>
                  <th>{tr("Actor")}</th>
                  <th>{tr("Payload")}</th>
                </tr>
              </thead>
              <tbody>
                {auditTrail.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.action}</td>
                    <td>
                      <div className="cell-stack">
                        <strong>{formatAuditActorLabel(entry.actorId, locale)}</strong>
                        <span className="meta">{tr(entry.actorType)}</span>
                      </div>
                    </td>
                    <td className="mono mono--wrap">{JSON.stringify(entry.payload)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">{tr("No audit entries were recorded for this alert yet.")}</div>
          )}
        </details>

        <details className="metadata-disclosure">
          <summary>{tr("Raw metadata")}</summary>
          <pre className="metadata-pre">{JSON.stringify(metadata, null, 2)}</pre>
        </details>
      </section>
    </AppShell>
  );
}
