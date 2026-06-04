import { Link } from "@/i18n/navigation";

import { MotionDiv } from "./client-motion";
import { HomeSetupReminder } from "./home-setup-reminder";
import { ActionCenter, type ActionCenterItem } from "./action-center";
import { formatInteger, formatUsd } from "./home-formatters";
import {
  HomeRiskBand,
  ManagementKpiRow,
  ManagementSummaryBand,
  ManagementTrendPanel,
  type HomeRiskCard,
  type ManagementKpiCard,
  type ManagementSummaryProvider,
  type ManagementSummaryStatus,
  type ManagementTrendPoint,
} from "./home-management-overview";
import { getDailyBurnRate, getProjectedMonthlySpend } from "../lib/budget-forecast";
import { formatAuditActorLabel } from "../lib/audit-display";
import type { AppLocale } from "../lib/i18n";
import { getT } from "../lib/i18n-server";
import {
  buildContextualHref,
  buildUsageEventHref,
} from "../lib/navigation";
import type {
  GlobalHomeDashboardData,
  GlobalHomeBreakdownItem,
  GlobalHomeProjectBreakdownItem,
  GlobalHomeWorkspaceBreakdownItem,
} from "../lib/control-api";

function formatTrendLabel(value: string, locale: AppLocale) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatAuditAction(action: string) {
  const normalized = action.replaceAll(".", " / ").replaceAll("_", " ").trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getScopeLabel(locale: AppLocale, status: GlobalHomeProjectBreakdownItem["status"]) {
  if (locale === "zh") {
    return status === "archived" ? "已归档" : "活跃";
  }

  return status === "archived" ? "Archived" : "Active";
}

function getHomeCopy(locale: AppLocale) {
  if (locale === "zh") {
    return {
      setupReminderTitle: "当前工作区仍有未完成设置",
      setupReminderActiveLabel: "引导",
      setupReminderOpen: "打开设置",
      setupRemaining: (count: number) => `还剩 ${count} 项未完成。`,
      setupNext: (nextTitle: string | null) =>
        nextTitle ? `下一步：${nextTitle}` : "继续完成接入与分配步骤。",
      resourceBreakdownTitle: "资源使用拆解",
      resourceBreakdownDescription: "按组织、工作区与项目查看当前周期的请求与消耗分布。",
      organizationsPanelTitle: "组织",
      organizationsPanelDescription: "按组织汇总本周期的使用强度。",
      workspacesPanelTitle: "工作区",
      workspacesPanelDescription: "查看当前最活跃的工作区。",
      projectsPanelTitle: "项目",
      projectsPanelDescription: "识别当前周期消耗最高的项目。",
      openOrganizations: "打开组织",
      openWorkspaces: "打开工作区",
      openProjects: "打开项目",
      spendLabel: "消耗",
      requestsLabel: "请求",
      noBreakdownData: "当前周期还没有可拆解的流量。",
      globalActionTitle: "运营待处理",
      globalActionDescription: "全局异常、风险与最近变化。",
      selectWorkspaceTitle: "先选择一个工作区",
      selectWorkspaceDescription: "资源页与治理动作仍然围绕具体工作区执行。",
      selectWorkspaceCta: "打开工作区",
      reviewAlertsTitle: (count: number) => `复查 ${count} 条待处理告警`,
      reviewAlertsDescription: "先处理全局风险队列，再回到资源层继续排查。",
      reviewProvidersTitle: (count: number) => `复查 ${count} 条供应商路由`,
      reviewProvidersDescription: "检查失败或未测试的路由，再继续签发与分配。",
      reviewKeysTitle: (count: number) => `处理 ${count} 个密钥治理项`,
      reviewKeysDescription: "收紧即将过期或长期未使用的访问路径。",
      reviewUsageTitle: (count: number) => `复查 ${count} 条使用异常`,
      reviewUsageDescription: "先处理被阻止或报错的请求，再扩大访问。",
      reviewAuditTitle: "复查最近控制面变更",
      reviewAuditDescription: "最近的组织、项目、成员与路由变更已准备好复查。",
      actionOpen: "打开",
      recentChangesTitle: "最近变化",
      recentAuditBadge: "审计",
      recentBlockedLabel: "被阻止的请求",
      recentErrorLabel: "出错的请求",
      recentUsageLabel: "使用事件",
      unknownProvider: "未知供应商",
      unknownModel: "未知模型",
      tokensLabel: "令牌",
      workspaceMeta: (item: GlobalHomeWorkspaceBreakdownItem) =>
        `${item.organizationName} · ${formatInteger(item.projectCount, locale)} 个项目 · ${formatInteger(item.openAlertCount, locale)} 条待处理告警`,
      organizationMeta: (item: GlobalHomeBreakdownItem, organizationIndex: number, organizationItems: GlobalHomeBreakdownItem[]) =>
        organizationItems[organizationIndex]?.meta ?? item.meta,
      projectMeta: (item: GlobalHomeProjectBreakdownItem) =>
        `${item.organizationName} / ${item.workspaceName} · ${getScopeLabel(locale, item.status)}`,
      openQueue: "打开队列",
      globalSectionBadge: "全局总览",
    };
  }

  return {
    setupReminderTitle: "The current workspace still has pending setup",
    setupReminderActiveLabel: "Guide",
    setupReminderOpen: "Open Setup",
    setupRemaining: (count: number) => `${count} setup items remain.`,
    setupNext: (nextTitle: string | null) =>
      nextTitle ? `Next: ${nextTitle}` : "Continue the remaining onboarding and assignment steps.",
    resourceBreakdownTitle: "Resource usage breakdown",
    resourceBreakdownDescription: "Review current-period requests and spend by organization, workspace, and project.",
    organizationsPanelTitle: "Organizations",
    organizationsPanelDescription: "Current-period usage intensity by organization.",
    workspacesPanelTitle: "Workspaces",
    workspacesPanelDescription: "The most active workspaces right now.",
    projectsPanelTitle: "Projects",
    projectsPanelDescription: "Projects driving the most spend this period.",
    openOrganizations: "Open organizations",
    openWorkspaces: "Open workspaces",
    openProjects: "Open projects",
    spendLabel: "Spend",
    requestsLabel: "Requests",
    noBreakdownData: "No routed traffic is available for breakdown yet.",
    globalActionTitle: "Operating queue",
    globalActionDescription: "Global exceptions, risks, and recent changes.",
    selectWorkspaceTitle: "Select a workspace first",
    selectWorkspaceDescription: "Resource pages and governance actions still execute in a concrete workspace context.",
    selectWorkspaceCta: "Open workspaces",
    reviewAlertsTitle: (count: number) => `Review ${count} open alerts`,
    reviewAlertsDescription: "Stabilize the global risk queue before drilling into resources.",
    reviewProvidersTitle: (count: number) => `Review ${count} provider routes`,
    reviewProvidersDescription: "Check failed or untested routes before issuing or widening access.",
    reviewKeysTitle: (count: number) => `Resolve ${count} key governance items`,
    reviewKeysDescription: "Tighten expiring or long-idle access paths before they drift.",
    reviewUsageTitle: (count: number) => `Review ${count} usage exceptions`,
    reviewUsageDescription: "Inspect blocked and errored traffic before expanding access.",
    reviewAuditTitle: "Review recent control-plane changes",
    reviewAuditDescription: "Recent organization, project, member, and routing changes are ready for review.",
    actionOpen: "Open",
    recentChangesTitle: "Recent changes",
    recentAuditBadge: "Audit",
    recentBlockedLabel: "Blocked request",
    recentErrorLabel: "Errored request",
    recentUsageLabel: "Usage event",
    unknownProvider: "unknown provider",
    unknownModel: "unknown model",
    tokensLabel: "tokens",
    workspaceMeta: (item: GlobalHomeWorkspaceBreakdownItem) =>
      `${item.organizationName} · ${formatInteger(item.projectCount, locale)} projects · ${formatInteger(item.openAlertCount, locale)} open alerts`,
    organizationMeta: (item: GlobalHomeBreakdownItem, organizationIndex: number, organizationItems: GlobalHomeBreakdownItem[]) =>
      organizationItems[organizationIndex]?.meta ?? item.meta,
    projectMeta: (item: GlobalHomeProjectBreakdownItem) =>
      `${item.organizationName} / ${item.workspaceName} · ${getScopeLabel(locale, item.status)}`,
    openQueue: "Open queue",
    globalSectionBadge: "Global overview",
  };
}

function BreakdownPanel({
  title,
  description,
  items,
  emptyLabel,
  spendLabel,
  requestsLabel,
  formatSpend,
  footerAction,
}: {
  title: string;
  description: string;
  items: Array<GlobalHomeBreakdownItem & { metaLabel: string }>;
  emptyLabel: string;
  spendLabel: string;
  requestsLabel: string;
  formatSpend: (value: number) => string;
  footerAction: {
    label: string;
    href: string;
  };
}) {
  const maxCost = Math.max(...items.map((item) => item.totalCostUsd), 0);
  const maxEvents = Math.max(...items.map((item) => item.totalEvents), 0);

  return (
    <section className="motion-enter motion-enter-fast rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_84%,var(--surface-1)_16%)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h2>
          <p className="text-[13px] leading-5 text-muted-foreground">{description}</p>
        </div>
        <Link
          className="inline-flex items-center text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          href={footerAction.href}
        >
          {footerAction.label}
        </Link>
      </div>

      {items.length ? (
        <div className="mt-4 space-y-3">
          {items.map((item) => {
            const spendPercent = maxCost > 0 ? (item.totalCostUsd / maxCost) * 100 : 0;
            const requestPercent = maxEvents > 0 ? (item.totalEvents / maxEvents) * 100 : 0;
            const emphasis = Math.max(spendPercent, requestPercent, 4);

            return (
              <div key={item.id} className="space-y-1.5 rounded-xl border border-border/45 bg-background/55 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                      {item.label}
                    </p>
                    <p className="truncate text-[12px] text-muted-foreground">{item.metaLabel}</p>
                  </div>
                  <div className="shrink-0 text-right text-[12px] text-muted-foreground">
                    <p>{spendLabel}</p>
                    <p className="font-medium text-foreground">{item.totalCostUsd <= 0 ? "—" : formatSpend(item.totalCostUsd)}</p>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                  <MotionDiv
                    className="h-full rounded-full bg-foreground"
                    initial={{ width: 0 }}
                    whileInView={{ width: `${Math.min(emphasis, 100)}%` }}
                    viewport={{ once: true, margin: "-40px" }}
                    transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>{requestsLabel}</span>
                  <span>{item.totalEvents.toLocaleString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border/50 bg-background/40 px-4 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

export async function HomeGlobalOverview({
  data,
  dashboardHref,
  initialGuideExitedWorkspaceIds = [],
  locale,
  selectedWorkspaceId,
  setupReminder,
}: {
  data: GlobalHomeDashboardData;
  dashboardHref: string;
  initialGuideExitedWorkspaceIds?: string[];
  locale: AppLocale;
  selectedWorkspaceId: string | null;
  setupReminder?: {
    remainingCount: number;
    href: string;
    nextTitle: string | null;
  } | null;
}) {
  const t = await getT("home");
  const copy = getHomeCopy(locale);
  const monthSpend = data.usageSummary.totalCostUsd;
  const burnRateUsd = getDailyBurnRate(monthSpend);
  const projectedSpendUsd = getProjectedMonthlySpend(monthSpend);
  const blockedUsageEventCount =
    data.usageSummary.statusBreakdown.find((item) => item.status === "blocked")?.eventCount ?? 0;
  const erroredUsageEventCount =
    data.usageSummary.statusBreakdown.find((item) => item.status === "error")?.eventCount ?? 0;
  const totalStatusEvents = data.usageSummary.statusBreakdown.reduce(
    (sum, item) => sum + item.eventCount,
    0,
  );

  const selectedWorkspaceProvidersHref = selectedWorkspaceId
    ? buildContextualHref(`/providers?workspaceId=${selectedWorkspaceId}`, dashboardHref)
    : buildContextualHref("/workspaces", dashboardHref);
  const selectedWorkspaceKeysHref = selectedWorkspaceId
    ? buildContextualHref(`/virtual-keys?workspaceId=${selectedWorkspaceId}`, dashboardHref)
    : buildContextualHref("/workspaces", dashboardHref);
  const selectedWorkspaceBudgetsHref = selectedWorkspaceId
    ? buildContextualHref(`/budgets?workspaceId=${selectedWorkspaceId}`, dashboardHref)
    : buildContextualHref("/workspaces", dashboardHref);
  const selectedWorkspaceUsageHref = selectedWorkspaceId
    ? buildContextualHref(`/usage-events?workspaceId=${selectedWorkspaceId}&statusGroup=attention`, dashboardHref)
    : buildContextualHref("/workspaces", dashboardHref);
  const selectedWorkspaceAuditHref = selectedWorkspaceId
    ? buildContextualHref(`/audit-logs?workspaceId=${selectedWorkspaceId}`, dashboardHref)
    : buildContextualHref("/workspaces", dashboardHref);
  const organizationsHref = buildContextualHref("/organizations", dashboardHref);
  const workspacesHref = buildContextualHref("/workspaces", dashboardHref);
  const projectsHref = selectedWorkspaceId
    ? buildContextualHref(`/projects?workspaceId=${selectedWorkspaceId}`, dashboardHref)
    : buildContextualHref("/workspaces", dashboardHref);
  const exportsHref = selectedWorkspaceId
    ? buildContextualHref(`/exports?workspaceId=${selectedWorkspaceId}`, dashboardHref)
    : buildContextualHref("/workspaces", dashboardHref);

  const managementKpis: ManagementKpiCard[] = [
    {
      key: "monthlySpend",
      label: t("management.kpi.monthlySpend.label"),
      value: monthSpend > 0 ? formatUsd(monthSpend, locale) : t("management.kpi.monthlySpend.unavailable"),
      hint:
        data.usageSummary.totalEvents > 0
          ? `${formatInteger(data.usageSummary.totalEvents, locale)} ${t("overview.eventsLabel")}`
          : t("management.kpi.monthlySpend.noTrafficHint"),
    },
    {
      key: "forecast",
      label: t("management.kpi.forecast.label"),
      value: monthSpend > 0 ? formatUsd(projectedSpendUsd, locale) : t("management.kpi.forecast.unavailable"),
      hint:
        data.usageSummary.totalEvents > 0
          ? `${formatUsd(burnRateUsd, locale)} / ${t("management.kpi.forecast.perDay")}`
          : t("management.kpi.forecast.noTrafficHint"),
      tone:
        data.budgetSummary.blockingAlerts > 0
          ? "critical"
          : data.budgetSummary.openAlerts > 0
            ? "warning"
            : "neutral",
    },
    {
      key: "successRate",
      label: t("management.kpi.success.label"),
      value:
        data.usageSummary.successRate == null
          ? t("management.kpi.success.na")
          : `${Math.round(data.usageSummary.successRate * 100)}%`,
      hint:
        data.usageSummary.averageLatencyMs == null
          ? t("management.kpi.success.noTrafficHint")
          : `${Math.round(data.usageSummary.averageLatencyMs)} ms`,
    },
    {
      key: "providerHealth",
      label: t("management.kpi.providerHealth.label"),
      value: `${formatInteger(data.providerSummary.active, locale)}`,
      hint:
        data.providerSummary.attention > 0 || data.providerSummary.revoked > 0
          ? `${formatInteger(data.providerSummary.attention, locale)} ${t("management.kpi.providerHealth.attention")} · ${formatInteger(data.providerSummary.revoked, locale)} ${t("management.kpi.providerHealth.revoked")}`
          : t("management.kpi.providerHealth.allClear"),
      tone: data.providerSummary.attention > 0 ? "warning" : "neutral",
    },
    {
      key: "keyGovernance",
      label: t("management.kpi.keyGovernance.label"),
      value: `${formatInteger(data.keySummary.active, locale)} ${t("management.kpi.keyGovernance.active")}`,
      hint:
        data.keySummary.expiringSoon > 0 || data.keySummary.dormantWideAccess > 0
          ? [
              data.keySummary.expiringSoon > 0
                ? `${formatInteger(data.keySummary.expiringSoon, locale)} ${t("management.kpi.keyGovernance.expiring")}`
                : null,
              data.keySummary.dormantWideAccess > 0
                ? `${formatInteger(data.keySummary.dormantWideAccess, locale)} ${t("management.kpi.keyGovernance.dormant")}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : t("management.kpi.keyGovernance.clear"),
      tone:
        data.keySummary.expiringSoon > 0 || data.keySummary.dormantWideAccess > 0
          ? "warning"
          : "neutral",
    },
    {
      key: "resourceFootprint",
      label: t("management.kpi.resourceFootprint.label"),
      value: `${formatInteger(data.resourceSummary.projects, locale)} / ${formatInteger(data.resourceSummary.environments, locale)}`,
      hint: `${formatInteger(data.budgetSummary.active, locale)} ${t("management.kpi.resourceFootprint.activeBudgets")}`,
      tone: data.resourceSummary.projects > 0 ? "neutral" : "warning",
    },
  ];

  const dailyTrendPoints: ManagementTrendPoint[] = data.dailyUsage.items.map((item) => ({
    bucketDate: item.bucketDate,
    label: formatTrendLabel(item.bucketDate, locale),
    requestCount: item.requestCount,
    totalCostUsd: item.totalCostUsd,
    blockedCount: item.blockedCount,
    errorCount: item.errorCount,
  }));

  const statusLabelMap: Record<string, string> = {
    blocked: t("management.summary.status.blocked"),
    error: t("management.summary.status.error"),
    success: t("management.summary.status.success"),
    interrupted: t("management.summary.status.other"),
  };

  const statusItems: ManagementSummaryStatus[] =
    data.usageSummary.statusBreakdown.length > 0
      ? data.usageSummary.statusBreakdown.map((status) => ({
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

  const sortedProviders = data.usageSummary.providerBreakdown
    .slice()
    .sort((left, right) => right.totalCostUsd - left.totalCostUsd);
  const topProviders = sortedProviders.filter((provider) => provider.totalCostUsd > 0).slice(0, 3);
  const totalProviderCost = data.usageSummary.providerBreakdown.reduce(
    (sum, item) => sum + item.totalCostUsd,
    0,
  );
  const topProviderCost = topProviders.reduce((sum, provider) => sum + provider.totalCostUsd, 0);
  const providerItems: ManagementSummaryProvider[] = topProviders.map((provider) => ({
    key: provider.provider ?? "provider",
    label: provider.provider ?? t("management.summary.provider.unknown"),
    costUsd: provider.totalCostUsd,
    totalCostUsd: Math.max(totalProviderCost, provider.totalCostUsd, 1),
    valueLabel: formatUsd(provider.totalCostUsd, locale),
    tone: "neutral",
  }));

  if (totalProviderCost > topProviderCost) {
    providerItems.push({
      key: "others",
      label: t("management.summary.provider.others"),
      costUsd: totalProviderCost - topProviderCost,
      totalCostUsd: Math.max(totalProviderCost, 1),
      valueLabel: formatUsd(totalProviderCost - topProviderCost, locale),
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

  const riskCards: HomeRiskCard[] = [
    {
      key: "budget",
      label: t("risk.budgetRisk.title"),
      value:
        data.budgetSummary.active > 0
          ? `${formatInteger(data.budgetSummary.active, locale)} ${t("risk.budgetRisk.budgetsLabel")}`
          : t("risk.budgetRisk.empty"),
      hint:
        data.budgetSummary.blockingAlerts > 0
          ? `${formatInteger(data.budgetSummary.blockingAlerts, locale)} ${t("risk.budgetRisk.blockingAlerts")}`
          : data.budgetSummary.openAlerts > 0
            ? `${formatInteger(data.budgetSummary.openAlerts, locale)} ${t("risk.budgetRisk.openAlerts")}`
            : t("risk.budgetRisk.stable"),
      ctaLabel: t("risk.budgetRisk.cta"),
      href: selectedWorkspaceBudgetsHref,
      tone:
        data.budgetSummary.blockingAlerts > 0
          ? "critical"
          : data.budgetSummary.openAlerts > 0
            ? "warning"
            : "neutral",
    },
    {
      key: "usage",
      label: t("risk.usageExceptions.title"),
      value: `${formatInteger(blockedUsageEventCount + erroredUsageEventCount, locale)} ${t("risk.usageExceptions.requestsLabel")}`,
      hint: t("risk.usageExceptions.hint", {
        blocked: blockedUsageEventCount,
        errored: erroredUsageEventCount,
      }),
      ctaLabel: t("risk.usageExceptions.cta"),
      href: selectedWorkspaceUsageHref,
      tone: blockedUsageEventCount > 0 ? "critical" : erroredUsageEventCount > 0 ? "warning" : "neutral",
    },
    {
      key: "providers",
      label: t("risk.providerReadiness.title"),
      value: `${formatInteger(data.providerSummary.active, locale)}`,
      hint: t("risk.providerReadiness.hint", {
        attention: data.providerSummary.attention,
        revoked: data.providerSummary.revoked,
      }),
      ctaLabel: t("risk.providerReadiness.cta"),
      href: selectedWorkspaceProvidersHref,
      tone: data.providerSummary.attention > 0 ? "warning" : "neutral",
    },
    {
      key: "keys",
      label: t("risk.keyGovernance.title"),
      value: `${formatInteger(data.keySummary.active, locale)} ${t("risk.keyGovernance.active")}`,
      hint:
        [
          data.keySummary.expiringSoon > 0
            ? `${formatInteger(data.keySummary.expiringSoon, locale)} ${t("risk.keyGovernance.expiring")}`
            : null,
          data.keySummary.dormantWideAccess > 0
            ? `${formatInteger(data.keySummary.dormantWideAccess, locale)} ${t("risk.keyGovernance.dormant")}`
            : null,
          data.keySummary.neverUsed > 0
            ? `${formatInteger(data.keySummary.neverUsed, locale)} ${t("risk.keyGovernance.neverUsed")}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || t("risk.keyGovernance.stable"),
      ctaLabel: t("risk.keyGovernance.cta"),
      href: selectedWorkspaceKeysHref,
      tone:
        data.keySummary.expiringSoon > 0 || data.keySummary.dormantWideAccess > 0
          ? "warning"
          : "neutral",
    },
  ];

  const primaryActionItem: ActionCenterItem = !selectedWorkspaceId
    ? {
        title: copy.selectWorkspaceTitle,
        description: copy.selectWorkspaceDescription,
        href: workspacesHref,
        ctaLabel: copy.selectWorkspaceCta,
        tone: "warning",
      }
    : data.alertSummary.open > 0
      ? {
          title: copy.reviewAlertsTitle(data.alertSummary.open),
          description: copy.reviewAlertsDescription,
          href: selectedWorkspaceBudgetsHref,
          ctaLabel: copy.openQueue,
          tone: data.alertSummary.critical > 0 ? "critical" : "warning",
        }
      : data.providerSummary.attention > 0
        ? {
            title: copy.reviewProvidersTitle(data.providerSummary.attention),
            description: copy.reviewProvidersDescription,
            href: selectedWorkspaceProvidersHref,
            ctaLabel: copy.openQueue,
            tone: "warning",
          }
        : data.keySummary.expiringSoon > 0 || data.keySummary.dormantWideAccess > 0
          ? {
              title: copy.reviewKeysTitle(data.keySummary.expiringSoon + data.keySummary.dormantWideAccess),
              description: copy.reviewKeysDescription,
              href: selectedWorkspaceKeysHref,
              ctaLabel: copy.openQueue,
              tone: "warning",
            }
          : blockedUsageEventCount > 0 || erroredUsageEventCount > 0
            ? {
                title: copy.reviewUsageTitle(blockedUsageEventCount + erroredUsageEventCount),
                description: copy.reviewUsageDescription,
                href: selectedWorkspaceUsageHref,
                ctaLabel: copy.openQueue,
                tone: blockedUsageEventCount > 0 ? "critical" : "warning",
              }
            : {
                title: copy.reviewAuditTitle,
                description: copy.reviewAuditDescription,
                href: selectedWorkspaceAuditHref,
                ctaLabel: copy.actionOpen,
                tone: "neutral",
              };

  const actionCenterStats = [
    {
      label: t("actionItems.stats.riskQueue.label"),
      value: formatInteger(
        data.budgetSummary.openAlerts +
          data.providerSummary.attention +
          data.keySummary.expiringSoon +
          data.keySummary.dormantWideAccess,
        locale,
      ),
      hint: t("actionItems.stats.riskQueue.hint"),
      tone:
        data.budgetSummary.blockingAlerts > 0
          ? ("critical" as const)
          : data.budgetSummary.openAlerts > 0 || data.providerSummary.attention > 0
            ? ("warning" as const)
            : ("neutral" as const),
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
      value: formatInteger(data.recentUsage.items.length + data.recentAudit.items.length, locale),
      hint: t("actionItems.stats.recentChanges.hint"),
      tone: "neutral" as const,
    },
  ];

  const recentActions = [
    ...data.recentUsage.items.map((event) => ({
      title:
        event.status === "blocked"
          ? copy.recentBlockedLabel
          : event.status === "error"
            ? copy.recentErrorLabel
            : `${copy.recentUsageLabel} · ${event.model ?? copy.unknownModel}`,
      description: `${event.provider ?? copy.unknownProvider} · ${formatInteger(event.totalTokens, locale)} ${copy.tokensLabel} · ${formatUsd(event.costUsd, locale)}`,
      href: buildUsageEventHref(event.id, dashboardHref),
      sortAt: Date.parse(event.createdAt),
      badgeLabel:
        event.status === "blocked"
          ? t("inbox.badge.critical")
          : event.status === "error"
            ? t("inbox.badge.warning")
            : t("inbox.badge.neutral"),
      ctaLabel: t("inbox.open"),
      tone:
        event.status === "blocked"
          ? ("critical" as const)
          : event.status === "error"
            ? ("warning" as const)
            : ("neutral" as const),
    })),
    ...data.recentAudit.items.map((entry) => ({
      title: formatAuditAction(entry.action),
      description: `${formatAuditActorLabel(entry.actorId, locale)} · ${entry.subjectType}`,
      href: buildContextualHref(
        `/audit-logs${entry.workspaceId ? `?workspaceId=${encodeURIComponent(entry.workspaceId)}&subjectType=${encodeURIComponent(entry.subjectType)}&subjectId=${encodeURIComponent(entry.subjectId)}` : ""}`,
        dashboardHref,
      ),
      sortAt: Date.parse(entry.createdAt),
      badgeLabel: copy.recentAuditBadge,
      ctaLabel: t("inbox.open"),
      tone: "neutral" as const,
    })),
  ]
    .sort((left, right) => right.sortAt - left.sortAt)
    .slice(0, 4);

  const visibleRecentActions = recentActions.filter((action) => action.tone !== "neutral").length
    ? recentActions.filter((action) => action.tone !== "neutral")
    : recentActions;

  return (
    <div className="space-y-6">
      {setupReminder ? (
        <HomeSetupReminder
          activeLabel={copy.setupReminderActiveLabel}
          href={setupReminder.href}
          initialGuideActive={!selectedWorkspaceId || !initialGuideExitedWorkspaceIds.includes(selectedWorkspaceId)}
          nextText={copy.setupNext(setupReminder.nextTitle)}
          openLabel={copy.setupReminderOpen}
          remainingText={copy.setupRemaining(setupReminder.remainingCount)}
          title={copy.setupReminderTitle}
          workspaceId={selectedWorkspaceId}
        />
      ) : null}

      <ManagementKpiRow items={managementKpis} />

      <ManagementTrendPanel
        chips={[
          t("management.trend.chips.window"),
          t("management.trend.chips.spend", {
            value: formatUsd(monthSpend, locale),
          }),
          t("management.trend.chips.requests", {
            count: formatInteger(data.usageSummary.totalEvents, locale),
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
        budgetHint={
          data.budgetSummary.active > 0
            ? `${formatInteger(data.budgetSummary.active, locale)} ${t("management.summary.budgetHint.activeBudgets")}`
            : t("management.summary.budgetHint.noBudgets")
        }
        budgetLabel={t("management.summary.labels.budget")}
        budgetPills={[
          t("management.summary.pills.burnRate", {
            value: formatUsd(burnRateUsd, locale),
          }),
          t("management.summary.pills.forecastBreaches", {
            count: formatInteger(data.budgetSummary.blockingAlerts, locale),
          }),
          t("management.summary.pills.openAlerts", {
            count: formatInteger(data.alertSummary.open, locale),
          }),
          t("management.summary.pills.blockingAlerts", {
            count: formatInteger(data.alertSummary.critical, locale),
          }),
        ]}
        budgetValue={monthSpend > 0 ? formatUsd(projectedSpendUsd, locale) : t("management.summary.budgetValue.unavailable")}
        providerItems={providerItems}
        providerLabel={t("management.summary.labels.providers")}
        providerMeta={t("management.summary.providerMeta", {
          count: formatInteger(providerItems.length, locale),
        })}
        requestLabel={t("management.summary.labels.requests")}
        requestMeta={t("management.summary.requestMeta", {
          count: formatInteger(totalStatusEvents, locale),
        })}
        statusItems={statusItems}
      />

      <section className="motion-enter motion-enter-fast space-y-4">
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
            {copy.resourceBreakdownTitle}
          </h2>
          <p className="text-[13px] leading-5 text-muted-foreground">
            {copy.resourceBreakdownDescription}
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <BreakdownPanel
            description={copy.organizationsPanelDescription}
            emptyLabel={copy.noBreakdownData}
            footerAction={{
              label: copy.openOrganizations,
              href: organizationsHref,
            }}
            formatSpend={(value) => formatUsd(value, locale)}
            items={data.organizationBreakdown.slice(0, 5).map((item, index, items) => ({
              ...item,
              metaLabel: copy.organizationMeta(item, index, items),
            }))}
            requestsLabel={copy.requestsLabel}
            spendLabel={copy.spendLabel}
            title={copy.organizationsPanelTitle}
          />
          <BreakdownPanel
            description={copy.workspacesPanelDescription}
            emptyLabel={copy.noBreakdownData}
            footerAction={{
              label: copy.openWorkspaces,
              href: workspacesHref,
            }}
            formatSpend={(value) => formatUsd(value, locale)}
            items={data.workspaceBreakdown.slice(0, 5).map((item) => ({
              ...item,
              metaLabel: copy.workspaceMeta(item),
            }))}
            requestsLabel={copy.requestsLabel}
            spendLabel={copy.spendLabel}
            title={copy.workspacesPanelTitle}
          />
          <BreakdownPanel
            description={copy.projectsPanelDescription}
            emptyLabel={copy.noBreakdownData}
            footerAction={{
              label: copy.openProjects,
              href: projectsHref,
            }}
            formatSpend={(value) => formatUsd(value, locale)}
            items={data.projectBreakdown.slice(0, 5).map((item) => ({
              ...item,
              metaLabel: copy.projectMeta(item),
            }))}
            requestsLabel={copy.requestsLabel}
            spendLabel={copy.spendLabel}
            title={copy.projectsPanelTitle}
          />
        </div>
      </section>

      <HomeRiskBand cards={riskCards} />

      <ActionCenter
        badgeLabel={copy.globalSectionBadge}
        description={copy.globalActionDescription}
        footerAction={selectedWorkspaceId ? { label: t("primaryAction.footerActionLabel"), href: exportsHref } : null}
        items={[primaryActionItem]}
        primaryItemsTitle={t("inbox.primaryItemsTitle")}
        secondaryItems={visibleRecentActions}
        secondaryItemsTitle={copy.recentChangesTitle}
        stats={actionCenterStats}
        statsLayout="inline"
        title={copy.globalActionTitle}
      />
    </div>
  );
}
