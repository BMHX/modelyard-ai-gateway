import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

import { ActionCenter, type ActionCenterItem } from "./action-center";
import { ControlApiStatusCard } from "./control-api-status-card";
import {
  HomeRiskBand,
  ManagementKpiRow,
  ManagementSummaryBand,
  type HomeRiskCard,
  type ManagementKpiCard,
  type ManagementSummaryProvider,
  type ManagementSummaryStatus,
  type ManagementTrendPoint,
  ManagementTrendPanel,
  type Tone,
} from "./home-management-overview";
import { formatUsd, formatInteger } from "./home-formatters";
import {
  diagnoseControlApiIssue,
  getWorkspaceHomeSnapshot,
} from "../lib/control-api";
import {
  buildBudgetPostureSummary,
  getBudgetPolicyAlertStatsById,
} from "../lib/budget-posture";
import {
  getDailyBurnRate,
  getProjectedMonthlySpend,
} from "../lib/budget-forecast";
import { formatAuditActorLabel } from "../lib/audit-display";
import { type AppLocale } from "../lib/i18n";
import {
  buildContextualHref,
  buildUsageEventHref,
} from "../lib/navigation";
import { getT } from "../lib/i18n-server";

const workspaceActivationActions = [
  "workspace.onboarding.first_provider_connected",
  "workspace.onboarding.first_provider_tested",
  "workspace.onboarding.first_virtual_key_created",
  "workspace.onboarding.first_export_requested",
] as const;


function formatAuditAction(action: string) {
  const normalized = action.replaceAll(".", " / ").replaceAll("_", " ").trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getDaysUntil(value: string | null, now = new Date()) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.ceil((parsed - now.getTime()) / (24 * 60 * 60 * 1000));
}

function isExpired(value: string | null, now = new Date()) {
  if (!value) {
    return false;
  }

  return Date.parse(value) <= now.getTime();
}

function isExpiringSoon(value: string | null, now = new Date()) {
  const daysUntil = getDaysUntil(value, now);
  return daysUntil !== null && daysUntil >= 0 && daysUntil <= 14;
}

function formatTrendLabel(value: string, locale: AppLocale) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function buildTrendPoints(args: {
  locale: AppLocale;
  rawItems: Awaited<ReturnType<typeof getWorkspaceHomeSnapshot>>["dailyUsage"]["items"];
  window: number;
}) {
  const today = new Date();
  const pointsByDate = new Map(args.rawItems.map((item) => [item.bucketDate, item]));
  const points: ManagementTrendPoint[] = [];

  for (let offset = args.window - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    date.setUTCDate(date.getUTCDate() - offset);
    const bucketDate = date.toISOString().slice(0, 10);
    const existing = pointsByDate.get(bucketDate);

    points.push({
      bucketDate,
      label: formatTrendLabel(bucketDate, args.locale),
      requestCount: existing?.requestCount ?? 0,
      totalCostUsd: existing?.totalCostUsd ?? 0,
      blockedCount: existing?.blockedCount ?? 0,
      errorCount: existing?.errorCount ?? 0,
    });
  }

  return points;
}

function buildAuditLogHref(
  workspaceId: string,
  returnTo?: string | null,
  subjectType?: string | null,
  subjectId?: string | null,
) {
  const params = new URLSearchParams();
  params.set("workspaceId", workspaceId);

  if (subjectType) {
    params.set("subjectType", subjectType);
  }

  if (subjectId) {
    params.set("subjectId", subjectId);
  }

  return buildContextualHref(`/audit-logs?${params.toString()}`, returnTo);
}

type RecentActionItem = {
  title: string;
  description: string;
  href: string;
  sortAt: number;
  badgeLabel: string;
  ctaLabel: string;
  tone: "critical" | "warning" | "neutral";
};

export async function HomeWorkspaceSecondarySections({
  locale,
  workspaceId,
  dashboardHref,
}: {
  locale: AppLocale;
  workspaceId: string;
  dashboardHref: string;
}) {
  const t = await getT("home");
  const providersHref = buildContextualHref(
    `/providers?workspaceId=${workspaceId}`,
    dashboardHref,
  );
  const providerCreateHref = `${providersHref}#provider-create-panel`;
  const attentionProvidersHref = buildContextualHref(
    `/providers?workspaceId=${workspaceId}&view=attention`,
    dashboardHref,
  );
  const virtualKeysHref = buildContextualHref(
    `/virtual-keys?workspaceId=${workspaceId}`,
    dashboardHref,
  );
  const usageAttentionHref = buildContextualHref(
    `/usage-events?workspaceId=${workspaceId}&statusGroup=attention`,
    dashboardHref,
  );
  const exportsHref = buildContextualHref(
    `/exports?workspaceId=${workspaceId}`,
    dashboardHref,
  );
  const auditHref = buildAuditLogHref(workspaceId, dashboardHref);
  const workspacesHref = buildContextualHref("/workspaces", dashboardHref);

  let snapshot: Awaited<ReturnType<typeof getWorkspaceHomeSnapshot>>;

  try {
    snapshot = await getWorkspaceHomeSnapshot(workspaceId);
  } catch (error) {
    const issue = diagnoseControlApiIssue(error) ?? {
      kind: "unexpected" as const,
      resource: "control-api" as const,
      message: "Can't load this right now.",
      path: `/v1/workspaces/${workspaceId}/home-snapshot`,
      status: null,
    };

    return (
      <div className="space-y-6">
        <ControlApiStatusCard
          detailsDefaultOpen
          footer={
            <>
              <Button asChild size="sm" variant="outline">
                <Link href={dashboardHref}>
                  {t("serviceStatus.refresh")}
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href={workspacesHref}>{t("changeWorkspace")}</Link>
              </Button>
            </>
          }
          heading={t("serviceStatus.degradedDescription")}
          issue={issue}
          mode="inline"
        />
      </div>
    );
  }

  const {
    providerConnections,
    virtualKeys: virtualKeyRecords,
    recentUsage: usage,
    recentAudit: auditLogResult,
    overview,
    dailyUsage: dailyUsageResponse,
    activationAuditEntries: rawActivationAuditEntries,
    budgetSummaries,
    openAlerts,
  } = snapshot;

  const activeProviderConnections = providerConnections.filter(
    (connection) => connection.status === "active",
  );
  const readyProviderConnections = activeProviderConnections.filter(
    (connection) => connection.lastTestStatus === "passed",
  );
  const revokedProviderCount = providerConnections.filter(
    (connection) => connection.status !== "active",
  ).length;
  const providerConnectionsNeedingAttention = activeProviderConnections.filter(
    (connection) => connection.lastTestStatus !== "passed",
  ).length;
  const expiringSoonKeyCount = virtualKeyRecords.items.filter(
    (virtualKey) =>
      virtualKey.status === "active" &&
      !isExpired(virtualKey.expiresAt) &&
      isExpiringSoon(virtualKey.expiresAt),
  ).length;
  const dormantWideAccessCount = virtualKeyRecords.items.filter(
    (virtualKey) =>
      virtualKey.status === "active" &&
      !virtualKey.lastUsedAt &&
      !virtualKey.expiresAt &&
      !virtualKey.projectId &&
      !virtualKey.environmentId,
  ).length;
  const activationAuditEntries = Object.fromEntries(
    rawActivationAuditEntries.map((entry) => [entry.action, entry.entry]),
  ) as Partial<
    Record<
      (typeof workspaceActivationActions)[number],
      (typeof rawActivationAuditEntries)[number]["entry"]
    >
  >;

  const usageSummary = overview?.usageSummary ?? null;
  const budgetSummary = overview?.budgetSummary ?? null;
  const alertStatsByBudgetPolicyId = getBudgetPolicyAlertStatsById(openAlerts);
  const budgetPosture = buildBudgetPostureSummary(budgetSummaries, alertStatsByBudgetPolicyId);
  const forecastBreaches = budgetSummaries.filter(
    (budget) =>
      budget.status === "active" &&
      getProjectedMonthlySpend(budget.currentMonthSpendUsd) >= budget.monthlyUsdLimit,
  ).length;
  const burnRateUsd = usageSummary ? getDailyBurnRate(usageSummary.totalCostUsd) : 0;
  const projectedSpendUsd = usageSummary ? getProjectedMonthlySpend(usageSummary.totalCostUsd) : 0;
  const forecastTone: Tone =
    budgetPosture.blockingBudgetAlertCount
      ? "critical"
      : budgetPosture.openBudgetAlertCount || forecastBreaches > 0
        ? "warning"
        : "neutral";
  const dailyTrendPoints = buildTrendPoints({
    locale,
    rawItems: dailyUsageResponse.items,
    window: dailyUsageResponse.window,
  });

  const statusBreakdown = usageSummary?.statusBreakdown ?? [];
  const totalStatusEvents = statusBreakdown.reduce((sum, item) => sum + item.eventCount, 0);
  const blockedUsageEventCount = statusBreakdown.find((item) => item.status === "blocked")?.eventCount ?? 0;
  const erroredUsageEventCount = statusBreakdown.find((item) => item.status === "error")?.eventCount ?? 0;
  const statusLabelMap: Record<string, string> = {
    blocked: t("management.summary.status.blocked"),
    error: t("management.summary.status.error"),
    success: t("management.summary.status.success"),
    interrupted: t("management.summary.status.other"),
  };
  const getPrimaryActionBadgeLabel = (tone: ActionCenterItem["tone"]) => {
    if (tone === "critical") {
      return t("inbox.badge.critical");
    }

    if (tone === "warning") {
      return t("inbox.badge.warning");
    }

    return t("inbox.badge.neutral");
  };
  const getRecentActionBadgeLabel = (status?: string) =>
    (status && statusLabelMap[status]) ?? t("management.summary.status.other");
  const statusItems: ManagementSummaryStatus[] =
    statusBreakdown.length > 0
      ? statusBreakdown.map((status) => ({
          key: status.status,
          label: statusLabelMap[status.status] ?? status.status,
          count: status.eventCount,
          total: Math.max(totalStatusEvents, 1),
          tone:
            status.status === "blocked"
              ? "critical"
              : status.status === "error"
                ? "warning"
                : "neutral",
        }))
      : [
          {
            key: "none",
            label: t("management.summary.status.none"),
            count: 0,
            total: 1,
            tone: "neutral",
          },
        ];

  const providerBreakdown = usageSummary?.providerBreakdown ?? [];
  const totalProviderCost = providerBreakdown.reduce((sum, item) => sum + item.totalCostUsd, 0);
  const sortedProviders = providerBreakdown
    .slice()
    .sort((left, right) => right.totalCostUsd - left.totalCostUsd);
  const topProviders = sortedProviders.filter((provider) => provider.totalCostUsd > 0).slice(0, 3);
  const topCost = topProviders.reduce((sum, provider) => sum + provider.totalCostUsd, 0);
  const otherCostUsd = Math.max(totalProviderCost - topCost, 0);
  const providerItems: ManagementSummaryProvider[] = topProviders.map((provider) => ({
    key: `${provider.provider ?? "provider"}-${provider.totalCostUsd}`,
    label: provider.provider ?? t("management.summary.provider.unknown"),
    costUsd: provider.totalCostUsd,
    totalCostUsd: Math.max(totalProviderCost, provider.totalCostUsd, 1),
    valueLabel: formatUsd(provider.totalCostUsd, locale),
    tone: "neutral",
  }));

  if (otherCostUsd > 0) {
    providerItems.push({
      key: "others",
      label: t("management.summary.provider.others"),
      costUsd: otherCostUsd,
      totalCostUsd: Math.max(totalProviderCost, otherCostUsd, 1),
      valueLabel: formatUsd(otherCostUsd, locale),
      tone: "neutral",
    });
  }

  if (!providerItems.length) {
    providerItems.push({
      key: "none",
      label: t("management.summary.provider.none"),
      costUsd: 0,
      totalCostUsd: 1,
      valueLabel: "—",
      tone: "neutral",
    });
  }

  const managementKpis: ManagementKpiCard[] = [
    {
      key: "monthlySpend",
      label: t("management.kpi.monthlySpend.label"),
      value: usageSummary
        ? formatUsd(usageSummary.totalCostUsd, locale)
        : t("management.kpi.monthlySpend.unavailable"),
      hint: usageSummary
        ? `${formatInteger(usageSummary.totalEvents, locale)} ${t("overview.eventsLabel")}`
        : t("management.kpi.monthlySpend.noTrafficHint"),
    },
    {
      key: "forecast",
      label: t("management.kpi.forecast.label"),
      value: usageSummary
        ? formatUsd(projectedSpendUsd, locale)
        : t("management.kpi.forecast.unavailable"),
      hint: usageSummary
        ? `${formatUsd(burnRateUsd, locale)} / ${t("management.kpi.forecast.perDay")}`
        : t("management.kpi.forecast.noTrafficHint"),
      tone: forecastTone,
    },
    {
      key: "successRate",
      label: t("management.kpi.success.label"),
      value:
        usageSummary?.successRate == null
          ? t("management.kpi.success.na")
          : `${Math.round(usageSummary.successRate * 100)}%`,
      hint:
        usageSummary?.averageLatencyMs == null
          ? t("management.kpi.success.noTrafficHint")
          : `${Math.round(usageSummary.averageLatencyMs)} ms`,
    },
    {
      key: "providerHealth",
      label: t("management.kpi.providerHealth.label"),
      value: `${readyProviderConnections.length} / ${activeProviderConnections.length}`,
      hint:
        providerConnectionsNeedingAttention > 0 || revokedProviderCount > 0
          ? `${providerConnectionsNeedingAttention} ${t("management.kpi.providerHealth.attention")} · ${
              revokedProviderCount
            } ${t("management.kpi.providerHealth.revoked")}`
          : t("management.kpi.providerHealth.allClear"),
      tone: providerConnectionsNeedingAttention > 0 ? "warning" : "neutral",
    },
    {
      key: "keyGovernance",
      label: t("management.kpi.keyGovernance.label"),
      value: `${virtualKeyRecords.summary.active} ${t("management.kpi.keyGovernance.active")}`,
      hint:
        expiringSoonKeyCount > 0 || dormantWideAccessCount > 0
          ? [
              expiringSoonKeyCount > 0
                ? `${expiringSoonKeyCount} ${t("management.kpi.keyGovernance.expiring")}`
                : null,
              dormantWideAccessCount > 0
                ? `${dormantWideAccessCount} ${t("management.kpi.keyGovernance.dormant")}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : t("management.kpi.keyGovernance.clear"),
      tone: expiringSoonKeyCount > 0 || dormantWideAccessCount > 0 ? "warning" : "neutral",
    },
    {
      key: "resourceFootprint",
      label: t("management.kpi.resourceFootprint.label"),
      value: `${formatInteger(overview?.projectCount ?? 0, locale)} / ${formatInteger(
        overview?.environmentCount ?? 0,
        locale,
      )}`,
      hint: `${formatInteger(budgetSummary?.activeBudgetCount ?? 0, locale)} ${t(
        "management.kpi.resourceFootprint.activeBudgets",
      )}`,
      tone: budgetSummary?.activeBudgetCount ? "neutral" : "warning",
    },
  ];

  const riskCards: HomeRiskCard[] = [
    {
      key: "budget",
      label: t("risk.budgetRisk.title"),
      value:
        budgetSummary && budgetSummary.activeBudgetCount > 0
          ? `${formatInteger(budgetSummary.activeBudgetCount, locale)} ${t("risk.budgetRisk.budgetsLabel")}`
          : t("risk.budgetRisk.empty"),
      hint: budgetSummary
        ? budgetPosture.blockingBudgetAlertCount > 0
          ? `${budgetPosture.blockingBudgetAlertCount} ${t("risk.budgetRisk.blockingAlerts")}`
          : forecastBreaches > 0
            ? t("risk.budgetRisk.forecastBreaches", {
                count: forecastBreaches,
              })
            : budgetPosture.openBudgetAlertCount > 0
              ? `${budgetPosture.openBudgetAlertCount} ${t("risk.budgetRisk.openAlerts")}`
            : t("risk.budgetRisk.stable")
        : t("risk.budgetRisk.unavailable"),
      ctaLabel: t("risk.budgetRisk.cta"),
      href: buildContextualHref(`/budgets?workspaceId=${workspaceId}#budget-summary`, dashboardHref),
      tone: budgetPosture.blockingBudgetAlertCount
        ? "critical"
        : budgetPosture.openBudgetAlertCount || forecastBreaches > 0
          ? "warning"
          : "neutral",
    },
    {
      key: "usage",
      label: t("risk.usageExceptions.title"),
      value: `${blockedUsageEventCount + erroredUsageEventCount} ${t("risk.usageExceptions.requestsLabel")}`,
      hint: t("risk.usageExceptions.hint", {
        blocked: blockedUsageEventCount,
        errored: erroredUsageEventCount,
      }),
      ctaLabel: t("risk.usageExceptions.cta"),
      href: usageAttentionHref,
      tone: blockedUsageEventCount > 0 ? "critical" : erroredUsageEventCount > 0 ? "warning" : "neutral",
    },
    {
      key: "providers",
      label: t("risk.providerReadiness.title"),
      value: `${readyProviderConnections.length} / ${activeProviderConnections.length}`,
      hint: t("risk.providerReadiness.hint", {
        attention: providerConnectionsNeedingAttention,
        revoked: revokedProviderCount,
      }),
      ctaLabel: t("risk.providerReadiness.cta"),
      href: attentionProvidersHref,
      tone: providerConnectionsNeedingAttention > 0 ? "warning" : "neutral",
    },
    {
      key: "keys",
      label: t("risk.keyGovernance.title"),
      value: `${virtualKeyRecords.summary.active} ${t("risk.keyGovernance.active")}`,
      hint: [
        expiringSoonKeyCount > 0 ? `${expiringSoonKeyCount} ${t("risk.keyGovernance.expiring")}` : null,
        dormantWideAccessCount > 0 ? `${dormantWideAccessCount} ${t("risk.keyGovernance.dormant")}` : null,
        virtualKeyRecords.summary.neverUsed > 0
          ? `${virtualKeyRecords.summary.neverUsed} ${t("risk.keyGovernance.neverUsed")}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || t("risk.keyGovernance.stable"),
      ctaLabel: t("risk.keyGovernance.cta"),
      href: virtualKeysHref,
      tone: expiringSoonKeyCount > 0 || dormantWideAccessCount > 0 ? "warning" : "neutral",
    },
  ];


  const primaryActionItem: ActionCenterItem = (() => {
    const item: ActionCenterItem =
      activeProviderConnections.length === 0
        ? {
            title: t("primaryAction.connectProvider.title"),
            description: t("primaryAction.connectProvider.description"),
            href: providerCreateHref,
            ctaLabel: t("primaryAction.connectProvider.cta"),
            tone: "warning",
          }
        : providerConnectionsNeedingAttention > 0
          ? {
              title: t("primaryAction.retestRoutes.title", {
                count: providerConnectionsNeedingAttention,
              }),
              description: t("primaryAction.retestRoutes.description"),
              href: attentionProvidersHref,
              ctaLabel: t("primaryAction.retestRoutes.cta"),
              tone: "warning",
            }
          : virtualKeyRecords.summary.active === 0
            ? {
                title: t("primaryAction.issueFirstKey.title"),
                description: t("primaryAction.issueFirstKey.description"),
                href: virtualKeysHref,
                ctaLabel: t("primaryAction.issueFirstKey.cta"),
                tone: "warning",
              }
            : expiringSoonKeyCount > 0 || dormantWideAccessCount > 0
              ? {
                  title:
                    expiringSoonKeyCount > 0
                      ? t("primaryAction.reviewExpiringKeys.title", {
                          count: expiringSoonKeyCount,
                        })
                      : t("primaryAction.reviewDormantKeys.title", {
                          count: dormantWideAccessCount,
                        }),
                  description:
                    expiringSoonKeyCount > 0
                      ? t("primaryAction.reviewExpiringKeys.description")
                      : t("primaryAction.reviewDormantKeys.description"),
                  href: virtualKeysHref,
                  ctaLabel: t("primaryAction.reviewExpiringKeys.cta"),
                  tone: expiringSoonKeyCount > 0 ? "warning" : "neutral",
                }
              : blockedUsageEventCount > 0 || erroredUsageEventCount > 0
                ? {
                    title:
                      blockedUsageEventCount > 0
                        ? t("primaryAction.reviewBlockedRequests.title", {
                            count: blockedUsageEventCount,
                          })
                        : t("primaryAction.reviewErroredRequests.title", {
                            count: erroredUsageEventCount,
                          }),
                    description:
                      blockedUsageEventCount > 0
                        ? t("primaryAction.reviewBlockedRequests.description")
                        : t("primaryAction.reviewErroredRequests.description"),
                    href: usageAttentionHref,
                    ctaLabel:
                      blockedUsageEventCount > 0
                        ? t("primaryAction.reviewBlockedRequests.cta")
                        : t("primaryAction.reviewErroredRequests.cta"),
                    tone: blockedUsageEventCount > 0 ? "critical" : "warning",
                  }
                : {
                    title: t("primaryAction.reviewAuditTrail.title"),
                    description: t("primaryAction.reviewAuditTrail.description"),
                    href: auditHref,
                    ctaLabel: t("primaryAction.reviewAuditTrail.cta"),
                    tone: "neutral",
                  };

    return {
      ...item,
      badgeLabel: getPrimaryActionBadgeLabel(item.tone),
    };
  })();

  const recentActions: RecentActionItem[] = [
    ...auditLogResult.items.map((entry) => ({
      title: formatAuditAction(entry.action),
      description: `${formatAuditActorLabel(entry.actorId, locale)} · ${entry.subjectType}`,
      href: buildAuditLogHref(
        workspaceId,
        dashboardHref,
        entry.subjectType,
        entry.subjectId,
      ),
      sortAt: Date.parse(entry.createdAt),
      badgeLabel: t("inbox.badge.audit"),
      ctaLabel: t("inbox.open"),
      tone: "neutral" as const,
    })),
    ...usage.items.map((event) => ({
      title:
        event.status === "blocked"
          ? t("recent.blockedRequest")
          : event.status === "error"
            ? t("recent.erroredRequest")
            : `${t("recent.usageLabel")} · ${event.model ?? t("recent.unknownModel")}`,
      description: `${event.provider ?? t("recent.unknownProvider")} · ${formatInteger(event.totalTokens, locale)} ${t("recent.tokens")} · ${formatUsd(event.costUsd, locale)}`,
      href: buildUsageEventHref(event.id, dashboardHref),
      sortAt: Date.parse(event.createdAt),
      badgeLabel: getRecentActionBadgeLabel(event.status),
      ctaLabel: t("inbox.open"),
      tone:
        event.status === "blocked"
          ? ("critical" as const)
          : event.status === "error"
            ? ("warning" as const)
            : ("neutral" as const),
    })),
  ]
    .sort((left, right) => right.sortAt - left.sortAt)
    .slice(0, 3);
  const prioritizedRecentActions = recentActions.filter((action) => action.tone !== "neutral");
  const completedActivationCount = workspaceActivationActions.filter(
    (action) => Boolean(activationAuditEntries[action]),
  ).length;
  const inboxFooterAction =
    completedActivationCount === workspaceActivationActions.length
      ? {
          label: t("primaryAction.footerActionLabel"),
          href: exportsHref,
        }
      : null;
  const attentionRiskCount =
    budgetPosture.openBudgetAlertCount +
    providerConnectionsNeedingAttention +
    expiringSoonKeyCount +
    dormantWideAccessCount;
  const actionCenterStats = [
    {
      label: t("actionItems.stats.riskQueue.label"),
      value: formatInteger(attentionRiskCount, locale),
      hint: t("actionItems.stats.riskQueue.hint"),
      tone: attentionRiskCount > 0 ? ("warning" as const) : ("neutral" as const),
    },
    {
      label: t("actionItems.stats.usageAttention.label"),
      value: formatInteger(blockedUsageEventCount + erroredUsageEventCount, locale),
      hint: t("actionItems.stats.usageAttention.hint", {
        blocked: blockedUsageEventCount,
        errored: erroredUsageEventCount,
      }),
      tone:
        blockedUsageEventCount > 0
          ? ("critical" as const)
          : erroredUsageEventCount > 0
            ? ("warning" as const)
            : ("neutral" as const),
    },
    {
      label: t("actionItems.stats.recentChanges.label"),
      value: formatInteger(recentActions.length, locale),
      hint: t("actionItems.stats.recentChanges.hint"),
      tone: "neutral" as const,
    },
  ];
  const visibleRecentActions = prioritizedRecentActions.length > 0 ? prioritizedRecentActions : recentActions;

  return (
    <div className="space-y-6">
      <ManagementKpiRow items={managementKpis} />
      <ManagementTrendPanel
        chips={[
          t("management.trend.chips.window"),
          t("management.trend.chips.spend", {
            value: usageSummary ? formatUsd(usageSummary.totalCostUsd, locale) : formatUsd(0, locale),
          }),
          t("management.trend.chips.requests", {
            count: usageSummary ? formatInteger(usageSummary.totalEvents, locale) : formatInteger(0, locale),
          }),
        ]}
        blockedLegend={t("management.trend.legend.blocked")}
        description={t("management.trend.description")}
        emptyLabel={t("management.trend.empty")}
        errorLegend={t("management.trend.legend.error")}
        items={dailyTrendPoints}
        requestLegend={t("management.trend.legend.requests")}
        spendLegend={t("management.trend.legend.spend")}
        title={t("management.trend.title")}
      />
      <ManagementSummaryBand
        budgetLabel={t("management.summary.labels.budget")}
        budgetValue={usageSummary ? formatUsd(projectedSpendUsd, locale) : t("management.summary.budgetValue.unavailable")}
        budgetHint={
          budgetPosture.activeBudgetCount > 0
            ? `${formatInteger(budgetPosture.activeBudgetCount, locale)} ${t("management.summary.budgetHint.activeBudgets")}`
            : t("management.summary.budgetHint.noBudgets")
        }
        budgetPills={[
          t("management.summary.pills.burnRate", {
            value: formatUsd(burnRateUsd, locale),
          }),
          t("management.summary.pills.forecastBreaches", {
            count: formatInteger(forecastBreaches, locale),
          }),
          t("management.summary.pills.openAlerts", {
            count: formatInteger(budgetPosture.openBudgetAlertCount, locale),
          }),
          t("management.summary.pills.blockingAlerts", {
            count: formatInteger(budgetPosture.blockingBudgetAlertCount, locale),
          }),
        ]}
        providerLabel={t("management.summary.labels.providers")}
        providerMeta={t("management.summary.providerMeta", {
          count: formatInteger(providerItems.length, locale),
        })}
        statusItems={statusItems}
        providerItems={providerItems}
        requestLabel={t("management.summary.labels.requests")}
        requestMeta={t("management.summary.requestMeta", {
          count: formatInteger(totalStatusEvents, locale),
        })}
      />
      <HomeRiskBand cards={riskCards} />
      <ActionCenter
        footerAction={inboxFooterAction}
        description={t("inbox.description")}
        items={[primaryActionItem]}
        primaryItemsTitle={t("inbox.primaryItemsTitle")}
        secondaryItems={visibleRecentActions}
        secondaryItemsTitle={t("inbox.secondaryItemsTitle")}
        stats={actionCenterStats}
        statsLayout="inline"
        title={t("inbox.title")}
      />
    </div>
  );
}

export function HomeWorkspaceSecondaryFallback() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`kpi-${index}`}
            className="h-24 rounded-2xl border border-border/40 bg-foreground/[0.04]"
          />
        ))}
      </div>

      <div className="rounded-2xl border border-border/40 bg-foreground/[0.04] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-4 w-40 rounded bg-foreground/[0.06]" />
            <div className="h-3 w-72 rounded bg-foreground/[0.05]" />
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`trend-chip-${index}`} className="h-7 w-24 rounded-full bg-foreground/[0.05]" />
            ))}
          </div>
        </div>
        <div className="mt-4 h-[206px] rounded-xl border border-border/40 bg-foreground/[0.03]" />
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">
        <div className="rounded-2xl border border-border/40 bg-foreground/[0.04] p-4">
          <div className="h-6 rounded bg-foreground/[0.06]" />
          <div className="mt-4 space-y-2">
            <div className="h-4 rounded bg-foreground/[0.06]" />
            <div className="h-4 rounded bg-foreground/[0.06]" />
            <div className="h-4 rounded bg-foreground/[0.06]" />
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-border/40 bg-foreground/[0.04] p-4">
          <div className="flex items-center justify-between">
            <div className="h-4 w-24 rounded bg-foreground/[0.06]" />
            <div className="h-3 w-12 rounded bg-foreground/[0.06]" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`status-${index}`} className="space-y-1">
                <div className="h-3 rounded bg-foreground/[0.05]" />
                <div className="h-1 rounded bg-foreground/[0.06]" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-border/40 bg-foreground/[0.04] p-4">
          <div className="flex items-center justify-between">
            <div className="h-4 w-24 rounded bg-foreground/[0.06]" />
            <div className="h-3 w-12 rounded bg-foreground/[0.06]" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`provider-${index}`} className="space-y-1">
                <div className="h-3 rounded bg-foreground/[0.05]" />
                <div className="h-1 rounded bg-foreground/[0.06]" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`risk-${index}`}
            className="h-28 rounded-2xl border border-border/40 bg-foreground/[0.04] p-4"
          />
        ))}
      </div>

      <div className="space-y-3 rounded-2xl border border-border/40 bg-foreground/[0.04] p-4">
        <div className="h-4 w-32 rounded bg-foreground/[0.05]" />
        <div className="h-3 w-20 rounded bg-foreground/[0.05]" />
        <div className="h-40 rounded bg-foreground/[0.03]" />
      </div>
    </div>
  );
}
