import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";

import type { Alert, UsageEvent } from "@teamops/contracts";

import { AppShell } from "../../components/app-shell";
import { CopyButton } from "../../components/copy-button";
import { NavigationContextNotice } from "../../components/navigation-context-notice";
import { getUsageEvent, listAlerts, listProjects, listUsageEvents, listWorkspaceEnvironments } from "../../lib/control-api";
import enUsageMessages from "../../messages/en/usage.json";
import zhUsageMessages from "../../messages/zh/usage.json";
import { type AppLocale, translateInlineText } from "../../lib/i18n";
import { getCurrentLocale } from "../../lib/i18n-server";
import {
  buildAlertHref,
  buildContextualHref,
  buildUsageEventHref,
  buildUsageEventsBackHref,
  buildUsageEventsScopedHref,
} from "../../lib/navigation";
import {
  describeUsageEventOutcome,
  getUsageEventBudgetPolicyId,
  getMetadataRecord,
  getTagClassName,
  getUsageEventStatusTone,
  getUsageEventSurface,
} from "../presentation";

export const dynamic = "force-dynamic";

type UsageEventDetailPageProps = {
  params: Promise<{
    usageEventId: string;
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

function createUsageTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhUsageMessages : enUsageMessages) as unknown as Record<string, string>;
  return (text: string, values?: TranslationValues) => {
    const template = messages[text] ?? translateInlineText(locale, text);
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
    formatUsd(amount: number) {
      const formatted = new Intl.NumberFormat(intlLocale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }).format(amount);
      return locale === "zh" ? formatted.replace(/^US\$/, "美元 ") : formatted;
    },
    formatInteger(value: number | null) {
      if (value === null) {
        return locale === "zh" ? "无" : "n/a";
      }

      return new Intl.NumberFormat(intlLocale).format(value);
    },
  };
}

function buildBudgetHref(workspaceId: string, budgetPolicyId: string, returnTo?: string | null) {
  return buildContextualHref(
    `/budgets?workspaceId=${workspaceId}&budgetPolicyId=${budgetPolicyId}#budget-${budgetPolicyId}`,
    returnTo,
  );
}

function buildBudgetAlertsHref(workspaceId: string, budgetPolicyId: string, returnTo?: string | null) {
  return buildContextualHref(`/alerts?workspaceId=${workspaceId}&budgetPolicyId=${budgetPolicyId}&status=open`, returnTo);
}

function buildBudgetAuditHref(workspaceId: string, budgetPolicyId: string, returnTo?: string | null) {
  return buildContextualHref(
    `/audit-logs?workspaceId=${workspaceId}&subjectType=budget-policy&subjectId=${budgetPolicyId}`,
    returnTo,
  );
}

function getMetadataStringArray(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getUsageEventBudgetEvidence(event: UsageEvent) {
  const metadata = getMetadataRecord(event.metadata);
  const orderedBudgetPolicyIds = [
    getUsageEventBudgetPolicyId(event),
    ...getMetadataStringArray(metadata, "budgetPolicyIds"),
    ...getMetadataStringArray(metadata, "blockedBudgetPolicyIds"),
    ...getMetadataStringArray(metadata, "exhaustedBudgetPolicyIds"),
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const periodKey = typeof metadata.periodKey === "string" && metadata.periodKey.trim().length ? metadata.periodKey : null;

  return {
    budgetPolicyId: orderedBudgetPolicyIds[0] ?? null,
    budgetPolicyIds: orderedBudgetPolicyIds,
    periodKey,
  };
}

function getUsageEventBudgetAlertCode(event: UsageEvent) {
  const metadata = getMetadataRecord(event.metadata);
  const budgetAlertCode = typeof metadata.budgetAlertCode === "string" ? metadata.budgetAlertCode.trim() : "";

  if (budgetAlertCode) {
    return budgetAlertCode;
  }

  const reason = typeof metadata.reason === "string" ? metadata.reason : null;
  switch (reason) {
    case "budget_hard_limit_exceeded":
      return "budget.hard-limit";
    case "budget_preflight_estimate_exceeds_remaining_headroom":
      return "budget.preflight-block";
    case "pricing_not_configured_for_budget_enforcement":
      return "budget.pricing-unavailable";
    default:
      return null;
  }
}

function getUsageEventBudgetAlertDedupeKey(event: UsageEvent) {
  const metadata = getMetadataRecord(event.metadata);
  const dedupeKey = typeof metadata.budgetAlertDedupeKey === "string" ? metadata.budgetAlertDedupeKey.trim() : "";
  return dedupeKey || null;
}

function getAlertDedupeKey(alert: Alert) {
  const metadata = getMetadataRecord(alert.metadata);
  const dedupeKey = typeof metadata.dedupeKey === "string" ? metadata.dedupeKey.trim() : "";
  return dedupeKey || null;
}

function getAlertPeriodKey(alert: Alert) {
  const metadata = getMetadataRecord(alert.metadata);
  return typeof metadata.periodKey === "string" && metadata.periodKey.trim().length ? metadata.periodKey : null;
}

function selectRelatedBudgetAlert(
  alerts: Alert[],
  args: { periodKey: string | null; code: string | null; dedupeKey: string | null },
) {
  return [...alerts].sort((left, right) => {
    const leftDedupeMatches = args.dedupeKey !== null && getAlertDedupeKey(left) === args.dedupeKey;
    const rightDedupeMatches = args.dedupeKey !== null && getAlertDedupeKey(right) === args.dedupeKey;

    if (leftDedupeMatches !== rightDedupeMatches) {
      return rightDedupeMatches ? 1 : -1;
    }

    const leftCodeMatches = args.code !== null && left.code === args.code;
    const rightCodeMatches = args.code !== null && right.code === args.code;

    if (leftCodeMatches !== rightCodeMatches) {
      return rightCodeMatches ? 1 : -1;
    }

    const leftPeriodMatches = args.periodKey !== null && getAlertPeriodKey(left) === args.periodKey;
    const rightPeriodMatches = args.periodKey !== null && getAlertPeriodKey(right) === args.periodKey;

    if (leftPeriodMatches !== rightPeriodMatches) {
      return rightPeriodMatches ? 1 : -1;
    }

    if (left.status !== right.status) {
      return left.status === "open" ? -1 : 1;
    }

    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  })[0] ?? null;
}

function buildUsageEventTimeline(events: UsageEvent[], currentEventId: string) {
  const deduped = new Map(events.map((event) => [event.id, event]));

  return Array.from(deduped.values()).sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();

    if (leftTime === rightTime) {
      if (left.id === currentEventId) {
        return -1;
      }
      if (right.id === currentEventId) {
        return 1;
      }
      return left.id.localeCompare(right.id);
    }

    return leftTime - rightTime;
  });
}

function buildRelationLabels(baseEvent: UsageEvent, comparedEvent: UsageEvent) {
  const labels: string[] = [];

  if (comparedEvent.id === baseEvent.id) {
    labels.push("current");
  }
  if (baseEvent.requestId && comparedEvent.requestId === baseEvent.requestId) {
    labels.push("gateway");
  }
  if (baseEvent.providerRequestId && comparedEvent.providerRequestId === baseEvent.providerRequestId) {
    labels.push("upstream");
  }

  return labels;
}

function buildReasonBreakdown(events: UsageEvent[]) {
  const reasonMap = new Map<
    string,
    {
      label: string;
      count: number;
      statuses: Set<UsageEvent["status"]>;
    }
  >();

  for (const usageEvent of events) {
    const outcome = describeUsageEventOutcome(usageEvent);
    const existing = reasonMap.get(outcome.reasonKey);
    if (existing) {
      existing.count += 1;
      existing.statuses.add(usageEvent.status);
      continue;
    }

    reasonMap.set(outcome.reasonKey, {
      label: outcome.reasonLabel,
      count: 1,
      statuses: new Set([usageEvent.status]),
    });
  }

  return Array.from(reasonMap.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
      statuses: Array.from(value.statuses).sort(),
    }))
    .sort((left, right) => {
      if (right.count === left.count) {
        return left.label.localeCompare(right.label);
      }

      return right.count - left.count;
    });
}

export default async function UsageEventDetailPage({ params, searchParams }: UsageEventDetailPageProps) {
  const locale = await getCurrentLocale();
  const tr = createUsageTranslator(locale);
  const { formatDateTime, formatInteger, formatUsd } = createFormatters(locale);
  const { usageEventId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const event = await getUsageEvent(usageEventId);
  if (!event) {
    notFound();
  }

  const backHref = buildUsageEventsBackHref(event, resolvedSearchParams.returnTo);
  const activeSavedViewId = (() => {
    try {
      return new URL(backHref, "http://localhost").searchParams.get("savedViewId");
    } catch {
      return null;
    }
  })();
  const currentDetailHref = buildUsageEventHref(event.id, backHref);
  const metadata = getMetadataRecord(event.metadata);
  const promptInspectionId =
    typeof metadata.inspectionId === "string" && metadata.inspectionId.trim().length
      ? metadata.inspectionId
      : null;
  const budgetEvidence = getUsageEventBudgetEvidence(event);
  const budgetAlertCode = getUsageEventBudgetAlertCode(event);
  const budgetAlertDedupeKey = getUsageEventBudgetAlertDedupeKey(event);
  const budgetPolicyId = budgetEvidence.budgetPolicyId;
  const budgetHref = event.workspaceId && budgetPolicyId ? buildBudgetHref(event.workspaceId, budgetPolicyId, currentDetailHref) : null;
  const alertsHref =
    event.workspaceId && budgetPolicyId ? buildBudgetAlertsHref(event.workspaceId, budgetPolicyId, currentDetailHref) : null;
  const auditHref =
    event.workspaceId && budgetPolicyId ? buildBudgetAuditHref(event.workspaceId, budgetPolicyId, currentDetailHref) : null;

  const [projects, environments, relatedBudgetAlerts, sameRequestEvents, sameProviderRequestEvents] = event.workspaceId
    ? await Promise.all([
        listProjects(event.workspaceId),
        listWorkspaceEnvironments(event.workspaceId),
        budgetPolicyId
          ? listAlerts({
              workspaceId: event.workspaceId,
              budgetPolicyId,
            })
          : Promise.resolve([]),
        event.requestId
          ? listUsageEvents(event.workspaceId, {
              requestId: event.requestId,
              limit: 10,
              offset: 0,
            })
          : Promise.resolve({ items: [], total: 0 }),
        event.providerRequestId
          ? listUsageEvents(event.workspaceId, {
              providerRequestId: event.providerRequestId,
              limit: 10,
              offset: 0,
            })
          : Promise.resolve({ items: [], total: 0 }),
      ])
    : [[], [], [], { items: [], total: 0 }, { items: [], total: 0 }];
  const relatedBudgetAlert = selectRelatedBudgetAlert(relatedBudgetAlerts, {
    periodKey: budgetEvidence.periodKey,
    code: budgetAlertCode,
    dedupeKey: budgetAlertDedupeKey,
  });
  const relatedBudgetAlertHref = relatedBudgetAlert ? buildAlertHref(relatedBudgetAlert.id, currentDetailHref) : null;
  const project = event.projectId ? projects.find((item) => item.id === event.projectId) ?? null : null;
  const environment = event.environmentId ? environments.find((item) => item.id === event.environmentId) ?? null : null;
  const surface = getUsageEventSurface(event);
  const outcome = describeUsageEventOutcome(event);
  const relatedGatewayEvents = sameRequestEvents.items.filter((item) => item.id !== event.id);
  const relatedProviderEvents = sameProviderRequestEvents.items.filter((item) => item.id !== event.id);
  const requestTimeline = buildUsageEventTimeline(
    [event, ...relatedGatewayEvents, ...relatedProviderEvents],
    event.id,
  );
  const familyReasonBreakdown = buildReasonBreakdown(requestTimeline);
  const familyTotalTokens = requestTimeline.reduce((sum, item) => sum + item.totalTokens, 0);
  const familyTotalCost = requestTimeline.reduce((sum, item) => sum + item.costUsd, 0);
  const familyLatencyValues = requestTimeline
    .map((item) => item.latencyMs)
    .filter((value): value is number => value !== null);
  const familyAverageLatency =
    familyLatencyValues.length > 0
      ? Number((familyLatencyValues.reduce((sum, value) => sum + value, 0) / familyLatencyValues.length).toFixed(1))
      : null;
  const familyStatusCounts = requestTimeline.reduce(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    {
      success: 0,
      error: 0,
      blocked: 0,
    },
  );

  return (
    <AppShell
      headerMode="compact"
      sidebarVariant="minimal"
      showOperatorContextCards={false}
      showSupportPanels={false}
      title={tr("Usage Event Detail")}
      subtitle=""
      workspaceId={event.workspaceId}
    >
      <section className="legacy-grid">
        <article className="card span-12">
          <div className="toolbar__actions">
            <Link className="button button--ghost" href={backHref}>
              {tr("Back to usage events")}
            </Link>
          </div>
          <NavigationContextNotice returnTo={backHref} headingPrefix={tr("Drilled in from")} detailSuffix="" />
        </article>

        <article className="card span-12">
          <div className="resource-card__header">
            <div className="cell-stack">
              <h2>{tr(surface.displayName)}</h2>
              <span className="meta">
                {tr(event.provider ?? "unknown provider")} · {tr(event.status)} · {formatDateTime(event.createdAt)}
              </span>
              {surface.path ? <span className="meta mono mono--wrap">{surface.path}</span> : null}
              <div className="badge-row">
                {surface.protocol ? <span className="tag">{surface.protocol}</span> : null}
                {surface.tags.map((tag) => (
                  <span key={`surface-${tr(tag.label)}`} className={getTagClassName(tag.tone)}>
                    {tr(tag.label)}
                  </span>
                ))}
              </div>
            </div>
            <span className={getTagClassName(getUsageEventStatusTone(event.status))}>
              {tr(event.status)}
            </span>
          </div>
        </article>

          <article className="card span-12">
            <div className="resource-card__header">
              <div className="cell-stack">
                <h2>{tr("Recorded Context")}</h2>
              </div>
            </div>
          <div className="metric-grid metric-grid--compact">
            <div className="resource-card">
              <div className="cell-stack">
                <span className="meta">{tr("Gateway path")}</span>
                <span className="mono mono--wrap">{surface.path ?? tr("n/a")}</span>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <span className="meta">{tr("Protocol")}</span>
                <span>{surface.protocol ?? tr("n/a")}</span>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <span className="meta">{tr("HTTP result")}</span>
                <span>{surface.httpStatus === null ? tr("n/a") : `HTTP ${surface.httpStatus}`}</span>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <span className="meta">{tr("Delivery")}</span>
                <span>
                  {surface.streamInterrupted
                    ? tr("stream interrupted")
                    : surface.streamed
                      ? tr("streamed response")
                      : surface.metadataRequest
                        ? tr("metadata lookup")
                        : tr("non-stream response")}
                </span>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <span className="meta">{tr("Primary cause")}</span>
                <span>{tr(outcome.reasonLabel)}</span>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <span className="meta">{tr("Detail")}</span>
                <span>{outcome.detail ? tr(outcome.detail) : surface.streamError ?? tr("No additional detail")}</span>
              </div>
            </div>
          </div>
        </article>

        <article className="card span-12">
          <div className="metric-grid">
            <div className="metric-card">
              <span className="meta">{tr("Prompt tokens")}</span>
              <strong>{formatInteger(event.promptTokens)}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Completion tokens")}</span>
              <strong>{formatInteger(event.completionTokens)}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Total tokens")}</span>
              <strong>{formatInteger(event.totalTokens)}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Latency")}</span>
              <strong>{event.latencyMs === null ? tr("n/a") : tr("{count} ms", { count: event.latencyMs })}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Cost")}</span>
              <strong>{formatUsd(event.costUsd)}</strong>
            </div>
          </div>
        </article>

        <article className="card span-12">
          <div className="metric-grid">
            <div className="metric-card">
              <span className="meta">{tr("Request family events")}</span>
              <strong>{requestTimeline.length}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Family total tokens")}</span>
              <strong>{formatInteger(familyTotalTokens)}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Family total cost")}</span>
              <strong>{formatUsd(familyTotalCost)}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Family avg latency")}</span>
              <strong>{familyAverageLatency === null ? tr("n/a") : tr("{count} ms", { count: familyAverageLatency })}</strong>
            </div>
            <div className="metric-card">
              <span className="meta">{tr("Distinct causes")}</span>
              <strong>{familyReasonBreakdown.length}</strong>
            </div>
          </div>
          <div className="badge-row">
            <span className={getTagClassName("resolved")}>{tr("{count} success", { count: familyStatusCounts.success })}</span>
            <span className={getTagClassName(familyStatusCounts.error ? "warning" : "default")}>
              {tr("{count} error", { count: familyStatusCounts.error })}
            </span>
            <span className={getTagClassName(familyStatusCounts.blocked ? "critical" : "default")}>
              {tr("{count} blocked", { count: familyStatusCounts.blocked })}
            </span>
          </div>
        </article>

        <article className="card span-12">
          <h2>{tr("Family Cause Breakdown")}</h2>
          {familyReasonBreakdown.length ? (
            <div className="stack stack--tight">
              {familyReasonBreakdown.map((item) => (
                <div key={item.key} className="resource-card">
                  <div className="resource-card__header">
                    <div className="cell-stack">
                      <strong>{tr(item.label)}</strong>
                      <span className="meta">{tr("{count} events", { count: item.count })}</span>
                    </div>
                    <div className="badge-row">
                      {item.statuses.map((status) => (
                        <span key={`${item.key}-${status}`} className={getTagClassName(getUsageEventStatusTone(status))}>
                          {tr(status)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">{tr("No cause breakdown is available for this request family.")}</div>
          )}
        </article>

        <article className="card span-6">
          <h2>{tr("Request IDs")}</h2>
          <div className="stack stack--tight">
            <div className="resource-card">
              <div className="cell-stack">
                <strong>{tr("Gateway request ID")}</strong>
                <div className="inline-actions">
                  <span className="mono mono--wrap">{event.requestId ?? tr("n/a")}</span>
                  {event.requestId ? <CopyButton label={tr("Copy")} value={event.requestId} /> : null}
                  {event.requestId ? (
                    <Link className="button button--ghost button--micro" href={buildUsageEventsScopedHref({
                      workspaceId: event.workspaceId,
                      requestId: event.requestId,
                      savedViewId: activeSavedViewId,
                      returnTo: currentDetailHref,
                    })}>
                      {tr("View same request")}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <strong>{tr("Provider request ID")}</strong>
                <div className="inline-actions">
                  <span className="mono mono--wrap">{event.providerRequestId ?? tr("n/a")}</span>
                  {event.providerRequestId ? <CopyButton label={tr("Copy")} value={event.providerRequestId} /> : null}
                  {event.providerRequestId ? (
                    <Link className="button button--ghost button--micro" href={buildUsageEventsScopedHref({
                      workspaceId: event.workspaceId,
                      providerRequestId: event.providerRequestId,
                      savedViewId: activeSavedViewId,
                      returnTo: currentDetailHref,
                    })}>
                      {tr("View same upstream")}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <strong>{tr("Usage event ID")}</strong>
                <div className="inline-actions">
                  <span className="mono mono--wrap">{event.id}</span>
                  <CopyButton label={tr("Copy")} value={event.id} />
                </div>
              </div>
            </div>
            {event.workspaceId && promptInspectionId ? (
              <div className="resource-card">
                <div className="cell-stack">
                  <strong>{locale === "zh" ? "内容审查" : "Content review"}</strong>
                  <div className="inline-actions">
                    <span className="mono mono--wrap">{promptInspectionId}</span>
                    <CopyButton label={tr("Copy")} value={promptInspectionId} />
                    <Link
                      className="button button--ghost button--micro"
                      href={`/prompt-inspections?workspaceId=${event.workspaceId}&inspectionId=${promptInspectionId}`}
                    >
                      {locale === "zh" ? "打开内容审查" : "Open content review"}
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className="card span-6">
          <h2>{tr("Scope")}</h2>
          <div className="stack stack--tight">
            <div className="resource-card">
              <div className="cell-stack">
                <strong>{tr("Workspace")}</strong>
                <span className="mono mono--wrap">{event.workspaceId ?? tr("usage.detail.globalUnscoped")}</span>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <strong>{tr("Project")}</strong>
                <span>{project?.name ?? event.projectId ?? tr("n/a")}</span>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <strong>{tr("Environment")}</strong>
                <span>
                  {environment ? `${environment.name} (${environment.runtime})` : event.environmentId ?? tr("n/a")}
                </span>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <strong>{tr("Virtual key")}</strong>
                <div className="inline-actions">
                  <span className="mono mono--wrap">{event.virtualKeyId ?? tr("n/a")}</span>
                  {event.virtualKeyId ? (
                    <Link
                      className="button button--ghost button--micro"
                      href={buildUsageEventsScopedHref({
                        workspaceId: event.workspaceId,
                        virtualKeyId: event.virtualKeyId,
                        savedViewId: activeSavedViewId,
                        returnTo: currentDetailHref,
                      })}
                    >
                      {tr("usage.detail.viewKeyEvents")}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="resource-card">
              <div className="cell-stack">
                <strong>{tr("Provider connection")}</strong>
                <div className="inline-actions">
                  <span className="mono mono--wrap">{event.providerConnectionId ?? tr("n/a")}</span>
                  {event.providerConnectionId ? (
                    <Link
                      className="button button--ghost button--micro"
                      href={buildUsageEventsScopedHref({
                        workspaceId: event.workspaceId,
                        providerConnectionId: event.providerConnectionId,
                        savedViewId: activeSavedViewId,
                        returnTo: currentDetailHref,
                      })}
                    >
                      {tr("usage.detail.viewProviderEvents")}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </article>

        <article className="card span-12">
          <div className="resource-card__header">
            <div className="cell-stack">
              <h2>{tr("usage.detail.evidenceChain")}</h2>
              <span className="meta">{tr("usage.detail.evidenceChainSummary")}</span>
            </div>
          </div>
          {budgetPolicyId && alertsHref && budgetHref && auditHref ? (
            <div className="stack">
              <div className="action-grid">
                <Link className="action-card" href={relatedBudgetAlertHref ?? alertsHref}>
                  <div className="action-card__header">
                    <div className="action-card__title">
                      <strong>{relatedBudgetAlert ? tr("Alert") : tr("Alerts")}</strong>
                      <span className="meta">
                        {relatedBudgetAlert
                          ? tr("usage.detail.relatedAlertSummary", { status: relatedBudgetAlert.status, code: relatedBudgetAlert.code, budget: budgetPolicyId })
                          : tr("usage.detail.alertQueueSummary", { budget: budgetPolicyId })}
                      </span>
                    </div>
                    <span className="tag tag--warning"> {tr("usage.detail.investigateTag")} </span>
                  </div>
                  <span className="action-card__cta">{relatedBudgetAlert ? tr("usage.detail.openRelatedAlert") : tr("usage.detail.openAlertQueue")}</span>
                </Link>
                <Link className="action-card" href={budgetHref}>
                  <div className="action-card__header">
                    <div className="action-card__title">
                      <strong>{tr("Budget")}</strong>
                      <span className="meta">{tr("usage.detail.budgetSummary")}</span>
                    </div>
                    <span className="tag"> {tr("usage.detail.policyTag")} </span>
                  </div>
                  <span className="action-card__cta">{tr("usage.detail.openBudgetPolicy")}</span>
                </Link>
                <Link className="action-card" href={auditHref}>
                  <div className="action-card__header">
                    <div className="action-card__title">
                      <strong>{tr("Audit")}</strong>
                      <span className="meta">{tr("usage.detail.auditSummary")}</span>
                    </div>
                    <span className="tag"> {tr("usage.detail.evidenceTag")} </span>
                  </div>
                  <span className="action-card__cta">{tr("usage.detail.openAuditTrail")}</span>
                </Link>
              </div>
              <div className="badge-row">
                {budgetEvidence.periodKey ? <span className="tag">{tr("usage.detail.periodTag", { period: budgetEvidence.periodKey })}</span> : null}
                {budgetAlertCode ? <span className="tag">{budgetAlertCode}</span> : null}
                {budgetAlertDedupeKey ? <span className="tag tag--resolved">{tr("usage.detail.exactIncident")}</span> : null}
                {budgetEvidence.budgetPolicyIds.map((linkedBudgetPolicyId) => (
                  <span
                    key={`linked-budget-${linkedBudgetPolicyId}`}
                    className={getTagClassName(linkedBudgetPolicyId === budgetPolicyId ? "warning" : "default")}
                  >
                    {linkedBudgetPolicyId === budgetPolicyId
                      ? tr("usage.detail.primaryBudget", { id: linkedBudgetPolicyId })
                      : tr("usage.detail.relatedBudget", { id: linkedBudgetPolicyId })}
                  </span>
                ))}
              </div>
              {budgetEvidence.budgetPolicyIds.length > 1 ? (
                <div className="notice">
                  {tr("usage.detail.multipleBudgetsNotice")}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty">{tr("usage.detail.noBudgetEvidence")}</div>
          )}
        </article>

        <article className="card span-12">
          <h2>{tr("usage.detail.metadata")}</h2>
          {Object.keys(metadata).length ? (
            <pre className="metadata-pre">{JSON.stringify(metadata, null, 2)}</pre>
          ) : (
            <div className="empty">{tr("usage.detail.noMetadata")}</div>
          )}
        </article>

        <article className="card span-12">
          <h2>{tr("usage.detail.requestTimeline")}</h2>
          <div className="timeline">
            {requestTimeline.map((timelineEvent) => {
              const isCurrent = timelineEvent.id === event.id;
              const timelineSurface = getUsageEventSurface(timelineEvent);
              return (
                <div
                  key={timelineEvent.id}
                  className={`timeline__item${isCurrent ? " timeline__item--current" : ""}`}
                >
                  <div className="timeline__marker" />
                  <div className="timeline__content">
                    <div className="resource-card__header">
                      <div className="cell-stack">
                        <strong>{tr(timelineSurface.displayName)}</strong>
                        <span className="meta">
                          {tr(timelineEvent.provider ?? "unknown provider")} · {formatDateTime(timelineEvent.createdAt)}
                        </span>
                        {timelineSurface.path ? <span className="meta mono mono--wrap">{timelineSurface.path}</span> : null}
                      </div>
                      <div className="inline-actions">
                        <span className={getTagClassName(getUsageEventStatusTone(timelineEvent.status))}>
                          {tr(timelineEvent.status)}
                        </span>
                        {isCurrent ? (
                          <span className="tag">{tr("usage.detail.current")}</span>
                        ) : (
                          <Link className="button button--ghost button--micro" href={buildUsageEventHref(timelineEvent.id, currentDetailHref)}>
                            {tr("Open event")}
                          </Link>
                        )}
                      </div>
                    </div>
                    <div className="inline-actions">
                      {timelineSurface.protocol ? <span className="tag">{timelineSurface.protocol}</span> : null}
                      {timelineSurface.tags
                        .filter((tag) => tag.label !== "HTTP 200")
                        .map((tag) => (
                          <span key={`${timelineEvent.id}-${tr(tag.label)}`} className={getTagClassName(tag.tone)}>
                            {tr(tag.label)}
                          </span>
                        ))}
                    </div>
                    <div className="inline-actions">
                      <span className="meta">{tr("{count} tokens", { count: formatInteger(timelineEvent.totalTokens) })}</span>
                      <span className="meta">
                        {timelineEvent.latencyMs === null ? tr("usage.detail.noLatency") : tr("{count} ms", { count: timelineEvent.latencyMs })}
                      </span>
                      <span className="meta">{formatUsd(timelineEvent.costUsd)}</span>
                    </div>
                    <div className="inline-actions">
                      {timelineEvent.requestId ? (
                        <span className="mono mono--wrap">{tr("usage.detail.gatewayId", { id: timelineEvent.requestId })}</span>
                      ) : null}
                      {timelineEvent.providerRequestId ? (
                        <span className="mono mono--wrap">{tr("usage.detail.upstreamId", { id: timelineEvent.providerRequestId })}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="card span-12">
          <h2>{tr("usage.detail.requestFamilyCompare")}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{tr("Time")}</th>
                  <th>{tr("usage.detail.relation")}</th>
                  <th>{tr("Model")}</th>
                  <th>{tr("Provider")}</th>
                  <th>{tr("Status")}</th>
                  <th>{tr("usage.detail.cause")}</th>
                  <th className="numeric">{tr("Tokens")}</th>
                  <th className="numeric">{tr("Latency")}</th>
                  <th className="numeric">{tr("Cost")}</th>
                  <th>{tr("Open")}</th>
                </tr>
              </thead>
              <tbody>
                {requestTimeline.map((timelineEvent) => {
                  const relationLabels = buildRelationLabels(event, timelineEvent);
                  const compareOutcome = describeUsageEventOutcome(timelineEvent);
                  const compareSurface = getUsageEventSurface(timelineEvent);
                  return (
                    <tr key={timelineEvent.id}>
                      <td>{formatDateTime(timelineEvent.createdAt)}</td>
                      <td>
                        <div className="badge-row">
                          {relationLabels.map((label) => (
                            <span
                              key={`${timelineEvent.id}-${label}`}
                              className={`tag${
                                label === "current"
                                  ? ""
                                  : label === "upstream"
                                    ? " tag--warning"
                                    : " tag--critical"
                              }`}
                            >
                              {tr(`usage.detail.relation.${label}`)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <strong>{tr(compareSurface.displayName)}</strong>
                          {compareSurface.path ? <span className="meta mono mono--wrap">{compareSurface.path}</span> : null}
                        </div>
                      </td>
                      <td>{tr(timelineEvent.provider ?? "unknown")}</td>
                      <td>
                        <span className={getTagClassName(getUsageEventStatusTone(timelineEvent.status))}>
                          {tr(timelineEvent.status)}
                        </span>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <strong>{tr(compareOutcome.reasonLabel)}</strong>
                          {compareOutcome.detail ? <span className="meta">{compareOutcome.detail}</span> : null}
                        </div>
                      </td>
                      <td className="numeric">{formatInteger(timelineEvent.totalTokens)}</td>
                      <td className="numeric">{timelineEvent.latencyMs === null ? tr("n/a") : tr("{count} ms", { count: timelineEvent.latencyMs })}</td>
                      <td className="numeric">{formatUsd(timelineEvent.costUsd)}</td>
                      <td>
                        {timelineEvent.id === event.id ? (
                          <span className="meta-strong">{tr("usage.detail.current")}</span>
                        ) : (
                          <Link className="button button--ghost button--micro" href={buildUsageEventHref(timelineEvent.id, currentDetailHref)}>
                            {tr("Open")}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
