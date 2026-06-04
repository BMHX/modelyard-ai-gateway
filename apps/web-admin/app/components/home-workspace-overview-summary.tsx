import type { ActionCenterStat } from "./action-center";
import type { WorkspaceHomeOverview } from "@teamops/contracts";

import { getWorkspaceHomeOverview } from "@/app/lib/control-api";
import { type AppLocale } from "@/app/lib/i18n";

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

function formatUsd(amount: number, locale: AppLocale) {
  const formatted = new Intl.NumberFormat(getIntlLocale(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return locale === "zh" ? formatted.replace(/^US\$/, "美元 ") : formatted;
}

function formatInteger(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(getIntlLocale(locale)).format(value);
}

export type HomeWorkspaceOverviewStatsResult = {
  stats: ActionCenterStat[];
  overview: WorkspaceHomeOverview | null;
};

export async function getHomeWorkspaceOverviewStats({
  locale,
  workspaceId,
  t,
}: {
  locale: AppLocale;
  workspaceId: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}): Promise<HomeWorkspaceOverviewStatsResult> {

  try {
    const overview = await getWorkspaceHomeOverview(workspaceId);
    const stats: ActionCenterStat[] = [
      overview.usageSummary
        ? {
            label: t("overview.usage"),
            value: formatUsd(overview.usageSummary.totalCostUsd, locale),
            hint: `${formatInteger(overview.usageSummary.totalEvents, locale)} ${t("overview.eventsLabel")}`,
          }
        : null,
      overview.budgetSummary
        ? {
            label: t("overview.budgets"),
            value: String(overview.budgetSummary.activeBudgetCount),
            hint:
              overview.budgetSummary.blockingBudgetAlertCount > 0
                ? `${overview.budgetSummary.blockingBudgetAlertCount} ${t("overview.blocked")}`
                : overview.budgetSummary.openBudgetAlertCount > 0
                  ? `${overview.budgetSummary.openBudgetAlertCount} ${t("overview.openAlerts")}`
                  : t("overview.stable"),
            tone:
              overview.budgetSummary.blockingBudgetAlertCount > 0
                ? ("critical" as const)
                : overview.budgetSummary.openBudgetAlertCount > 0
                  ? ("warning" as const)
                  : ("neutral" as const),
          }
        : null,
      overview.usageSummary
        ? {
            label: t("overview.success"),
            value:
              overview.usageSummary.successRate === null
                ? "n/a"
                : `${Math.round(overview.usageSummary.successRate * 100)}%`,
            hint:
              overview.usageSummary.averageLatencyMs === null
                ? t("overview.waitingForTraffic")
                : `${Math.round(overview.usageSummary.averageLatencyMs)} ms`,
          }
        : null,
    ].filter((stat): stat is ActionCenterStat => Boolean(stat));

    return { stats, overview };
  } catch {
    return {
      stats: [
        {
          label: t("overview.overview"),
          value: t("overview.unavailable"),
          hint: t("overview.summaryUnavailable"),
        },
      ],
      overview: null,
    };
  }
}
