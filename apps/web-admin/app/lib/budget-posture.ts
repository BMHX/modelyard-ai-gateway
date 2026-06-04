import type { Alert, BudgetPolicySummary, Environment, Project } from "@teamops/contracts";

import { translateInlineText, type AppLocale } from "./i18n";

export type BudgetPolicyAlertStats = {
  relatedAlerts: Alert[];
  openAlerts: Alert[];
  blockingOpenAlerts: Alert[];
  pricingGapOpenAlerts: Alert[];
  latestAlert: Alert | null;
};

export type BudgetPostureSummary = {
  activeBudgetCount: number;
  pausedBudgetCount: number;
  softLimitedBudgetCount: number;
  hardLimitedBudgetCount: number;
  policiesWithOpenAlertsCount: number;
  openBudgetAlertCount: number;
  blockingBudgetAlertCount: number;
  pricingGapPolicyCount: number;
  policiesWithPreventedBlocksCount: number;
  policiesWithUnestimatedBlocksCount: number;
  topRiskBudgetId: string | null;
  topProtectedBudgetId: string | null;
  topUtilizationBudgetId: string | null;
};

type BudgetScopeKind = "workspace" | "project" | "environment";

const emptyBudgetPolicyAlertStats: BudgetPolicyAlertStats = {
  relatedAlerts: [],
  openAlerts: [],
  blockingOpenAlerts: [],
  pricingGapOpenAlerts: [],
  latestAlert: null,
};

function getAlertMetadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

export function getAlertBudgetPolicyId(alert: Alert) {
  const metadata = getAlertMetadataRecord(alert.metadata);
  return typeof metadata.budgetPolicyId === "string" && metadata.budgetPolicyId ? metadata.budgetPolicyId : null;
}

export function formatBudgetScopeLabel(
  scopeKind: BudgetScopeKind,
  projectName: string | null,
  environmentName: string | null,
  environmentRuntime: string | null,
  locale: AppLocale = "en",
) {
  const environmentLabel = locale === "zh" ? translateInlineText(locale, "Environment") : "environment";
  const projectLabel = locale === "zh" ? translateInlineText(locale, "Project") : "project";
  const workspaceLabel = locale === "zh" ? translateInlineText(locale, "workspace-wide") : "workspace";
  const runtimeLabel = environmentRuntime ? translateInlineText(locale, environmentRuntime) : null;
  const normalizedEnvironmentName = environmentName?.trim().toLocaleLowerCase(locale === "zh" ? "zh-CN" : "en-US");
  const normalizedRuntime = environmentRuntime?.trim().toLocaleLowerCase(locale === "zh" ? "zh-CN" : "en-US");
  const normalizedRuntimeLabel = runtimeLabel?.trim().toLocaleLowerCase(locale === "zh" ? "zh-CN" : "en-US");

  if (scopeKind === "environment") {
    if (environmentName && runtimeLabel) {
      if (
        normalizedEnvironmentName &&
        (normalizedEnvironmentName === normalizedRuntime || normalizedEnvironmentName === normalizedRuntimeLabel)
      ) {
        return `${environmentLabel} / ${runtimeLabel}`;
      }

      return `${environmentLabel} / ${environmentName} (${runtimeLabel})`;
    }
    if (environmentName) {
      return `${environmentLabel} / ${environmentName}`;
    }
    if (runtimeLabel) {
      return `${environmentLabel} / ${runtimeLabel}`;
    }
  }

  if (scopeKind === "project" && projectName) {
    return `${projectLabel} / ${projectName}`;
  }

  return workspaceLabel;
}

export function isBlockingBudgetAlert(alert: Alert) {
  return (
    alert.code === "budget.hard-limit" ||
    alert.code === "budget.preflight-block" ||
    alert.code === "budget.pricing-unavailable"
  );
}

export function getBudgetPolicyAlertStatsById(alerts: Alert[]) {
  const alertsByBudgetPolicyId = new Map<string, Alert[]>();

  for (const alert of alerts) {
    const budgetPolicyId = getAlertBudgetPolicyId(alert);
    if (!budgetPolicyId) {
      continue;
    }

    const existingAlerts = alertsByBudgetPolicyId.get(budgetPolicyId) ?? [];
    existingAlerts.push(alert);
    alertsByBudgetPolicyId.set(budgetPolicyId, existingAlerts);
  }

  return new Map(
    [...alertsByBudgetPolicyId.entries()].map(([budgetPolicyId, relatedAlerts]) => {
      const sortedAlerts = [...relatedAlerts].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      const openAlerts = sortedAlerts.filter((alert) => alert.status === "open");

      return [
        budgetPolicyId,
        {
          relatedAlerts: sortedAlerts,
          openAlerts,
          blockingOpenAlerts: openAlerts.filter(isBlockingBudgetAlert),
          pricingGapOpenAlerts: openAlerts.filter((alert) => alert.code === "budget.pricing-unavailable"),
          latestAlert: sortedAlerts[0] ?? null,
        } satisfies BudgetPolicyAlertStats,
      ] as const;
    }),
  );
}

export function getBudgetPolicyUtilizationPercent(policy: Pick<BudgetPolicySummary, "monthlyUsdLimit" | "currentMonthSpendUsd">) {
  if (policy.monthlyUsdLimit <= 0) {
    return 0;
  }

  return Number(((policy.currentMonthSpendUsd / policy.monthlyUsdLimit) * 100).toFixed(1));
}

export function findActiveBudgetPolicyForScope(
  policies: BudgetPolicySummary[],
  scope: {
    projectId: string | null;
    environmentId: string | null;
  },
) {
  return (
    policies.find((policy) => {
      if (policy.status !== "active") {
        return false;
      }

      if (scope.environmentId) {
        return policy.environmentId === scope.environmentId;
      }

      if (scope.projectId) {
        return policy.projectId === scope.projectId && policy.environmentId === null;
      }

      return policy.projectId === null && policy.environmentId === null;
    }) ?? null
  );
}

export function getBudgetPolicyAlertStats(
  budgetPolicyId: string,
  alertStatsByBudgetPolicyId: Map<string, BudgetPolicyAlertStats>,
) {
  return alertStatsByBudgetPolicyId.get(budgetPolicyId) ?? emptyBudgetPolicyAlertStats;
}

function getBudgetPolicyPriorityLevel(
  policy: BudgetPolicySummary,
  alertStats: BudgetPolicyAlertStats,
) {
  if (policy.status !== "active") {
    return 4;
  }

  if (policy.hardLimitReached || alertStats.blockingOpenAlerts.length > 0) {
    return 0;
  }

  if (policy.softLimitReached || alertStats.openAlerts.length > 0 || policy.preventedUnestimatedRequestsCount > 0) {
    return 1;
  }

  if (policy.preventedRequestsCount > 0) {
    return 2;
  }

  return 3;
}

export function compareBudgetPoliciesByPriority(
  left: BudgetPolicySummary,
  right: BudgetPolicySummary,
  alertStatsByBudgetPolicyId: Map<string, BudgetPolicyAlertStats>,
) {
  const leftAlerts = getBudgetPolicyAlertStats(left.id, alertStatsByBudgetPolicyId);
  const rightAlerts = getBudgetPolicyAlertStats(right.id, alertStatsByBudgetPolicyId);
  const leftLevel = getBudgetPolicyPriorityLevel(left, leftAlerts);
  const rightLevel = getBudgetPolicyPriorityLevel(right, rightAlerts);

  return (
    leftLevel - rightLevel ||
    rightAlerts.blockingOpenAlerts.length - leftAlerts.blockingOpenAlerts.length ||
    rightAlerts.openAlerts.length - leftAlerts.openAlerts.length ||
    getBudgetPolicyUtilizationPercent(right) - getBudgetPolicyUtilizationPercent(left) ||
    right.preventedEstimatedCostUsd - left.preventedEstimatedCostUsd ||
    right.preventedRequestsCount - left.preventedRequestsCount ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt)
  );
}

export function resolveBudgetDisplayContext(args: {
  budget: BudgetPolicySummary;
  projectsById: Map<string, Project>;
  environmentsById: Map<string, Environment>;
  locale?: AppLocale;
}) {
  const environment = args.budget.environmentId ? args.environmentsById.get(args.budget.environmentId) ?? null : null;
  const projectName =
    (environment ? args.projectsById.get(environment.projectId)?.name ?? null : null) ??
    (args.budget.projectId ? args.projectsById.get(args.budget.projectId)?.name ?? null : null);

  return {
    environment,
    projectName,
    scopeLabel: formatBudgetScopeLabel(
      args.budget.scopeKind,
      projectName,
      environment?.name ?? null,
      environment?.runtime ?? args.budget.environment ?? null,
      args.locale,
    ),
  };
}

export function buildBudgetPostureSummary(
  budgets: BudgetPolicySummary[],
  alertStatsByBudgetPolicyId: Map<string, BudgetPolicyAlertStats>,
): BudgetPostureSummary {
  const activeBudgets = budgets.filter((budget) => budget.status === "active");
  const sortedBudgets = [...budgets].sort((left, right) =>
    compareBudgetPoliciesByPriority(left, right, alertStatsByBudgetPolicyId),
  );
  const topProtectedBudget = [...budgets]
    .filter((budget) => budget.preventedEstimatedCostUsd > 0 || budget.preventedRequestsCount > 0)
    .sort(
      (left, right) =>
        right.preventedEstimatedCostUsd - left.preventedEstimatedCostUsd ||
        right.preventedRequestsCount - left.preventedRequestsCount ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )[0] ?? null;
  const topUtilizationBudget = [...activeBudgets].sort(
    (left, right) =>
      getBudgetPolicyUtilizationPercent(right) - getBudgetPolicyUtilizationPercent(left) ||
      right.currentMonthSpendUsd - left.currentMonthSpendUsd,
  )[0] ?? null;

  return {
    activeBudgetCount: activeBudgets.length,
    pausedBudgetCount: budgets.filter((budget) => budget.status !== "active").length,
    softLimitedBudgetCount: activeBudgets.filter((budget) => budget.softLimitReached && !budget.hardLimitReached).length,
    hardLimitedBudgetCount: activeBudgets.filter((budget) => budget.hardLimitReached).length,
    policiesWithOpenAlertsCount: activeBudgets.filter(
      (budget) => getBudgetPolicyAlertStats(budget.id, alertStatsByBudgetPolicyId).openAlerts.length > 0,
    ).length,
    openBudgetAlertCount: activeBudgets.reduce(
      (sum, budget) => sum + getBudgetPolicyAlertStats(budget.id, alertStatsByBudgetPolicyId).openAlerts.length,
      0,
    ),
    blockingBudgetAlertCount: activeBudgets.reduce(
      (sum, budget) => sum + getBudgetPolicyAlertStats(budget.id, alertStatsByBudgetPolicyId).blockingOpenAlerts.length,
      0,
    ),
    pricingGapPolicyCount: activeBudgets.filter(
      (budget) => getBudgetPolicyAlertStats(budget.id, alertStatsByBudgetPolicyId).pricingGapOpenAlerts.length > 0,
    ).length,
    policiesWithPreventedBlocksCount: activeBudgets.filter((budget) => budget.preventedRequestsCount > 0).length,
    policiesWithUnestimatedBlocksCount: activeBudgets.filter((budget) => budget.preventedUnestimatedRequestsCount > 0).length,
    topRiskBudgetId: sortedBudgets[0]?.id ?? null,
    topProtectedBudgetId: topProtectedBudget?.id ?? null,
    topUtilizationBudgetId: topUtilizationBudget?.id ?? null,
  };
}
