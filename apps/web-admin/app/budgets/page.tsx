import { EmptyState } from "@/components/shared/empty-state";
import { RiskBadge } from "@/components/shared/risk-badge";

import { AppShell } from "../components/app-shell";
import { ConfirmSubmitButton } from "../components/confirm-submit-button";
import { ControlApiStatusCard } from "../components/control-api-status-card";
import { DisclosureSummary } from "../components/disclosure-summary";
import { LazyDisclosureSection } from "../components/lazy-disclosure-section";
import { PendingSubmitButton } from "../components/pending-submit-button";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { loadBudgetPageData } from "../lib/control-api";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import { getCurrentLocale } from "../lib/i18n-server";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import {
  buildBudgetPostureSummary,
  compareBudgetPoliciesByPriority,
  getBudgetPolicyAlertStatsById,
  getBudgetPolicyUtilizationPercent,
  resolveBudgetDisplayContext,
} from "../lib/budget-posture";
import { getProjectedMonthlySpend } from "../lib/budget-forecast";
import enBudgetMessages from "../messages/en/budgets.json";
import zhBudgetMessages from "../messages/zh/budgets.json";
import { deleteBudgetPolicyAction, updateBudgetPolicyAction } from "./actions";
import { BudgetPolicyCreateDialog } from "./budget-policy-create-dialog";

export const dynamic = "force-dynamic";

type BudgetsPageProps = {
  searchParams?: Promise<{
    workspaceId?: string;
    budgetPolicyId?: string;
    notice?: string;
    message?: string;
    returnTo?: string;
  }>;
};

function resolveBudgetMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  const nested = key.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" && part in (current as Record<string, unknown>)
      ? (current as Record<string, unknown>)[part]
      : null, messages);
  return typeof nested === "string" ? nested : null;
}

function createBudgetTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhBudgetMessages : enBudgetMessages) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    const template = resolveBudgetMessage(messages, key);
    if (!template) return translateInlineText(locale, key);
    return template.replace(/\{(\w+)\}/g, (_, token) => String(values?.[token] ?? `{${token}}`));
  };
}

function getNoticeState(notice?: string | null) {
  if (notice === "created") return { label: "Created", tone: "success" as const };
  if (notice === "updated") return { label: "Updated", tone: "success" as const };
  if (notice === "deleted") return { label: "Deleted", tone: "warning" as const };
  if (notice === "error") return { label: "Error", tone: "error" as const };
  return null;
}

function getBudgetRiskLevel(args: {
  hardLimitReached: boolean;
  openAlerts: number;
  blockingAlerts: number;
}) {
  if (args.hardLimitReached || args.blockingAlerts > 0) {
    return "high" as const;
  }

  if (args.openAlerts > 0) {
    return "medium" as const;
  }

  return "low" as const;
}

function buildBudgetWorkspaceNotice(args: {
  activeBudgetCount: number;
  pausedBudgetCount: number;
  blockingBudgetAlertCount: number;
  openBudgetAlertCount: number;
  tr: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (args.blockingBudgetAlertCount > 0) {
    return {
      tone: "error" as const,
      title: args.tr("budgets.notice.blockingTitle"),
      body: args.tr("budgets.notice.blockingBody", {
        count: args.blockingBudgetAlertCount,
      }),
    };
  }

  if (args.openBudgetAlertCount > 0) {
    return {
      tone: "warning" as const,
      title: args.tr("budgets.notice.watchTitle"),
      body: args.tr("budgets.notice.watchBody", {
        count: args.openBudgetAlertCount,
      }),
    };
  }

  if (args.activeBudgetCount > 0) {
    return {
      tone: "success" as const,
      title: args.tr("budgets.notice.steadyTitle"),
      body: args.tr("budgets.notice.steadyBody", {
        count: args.activeBudgetCount,
      }),
    };
  }

  if (args.pausedBudgetCount > 0) {
    return {
      tone: "warning" as const,
      title: args.tr("budgets.notice.pausedTitle"),
      body: args.tr("budgets.notice.pausedBody", {
        count: args.pausedBudgetCount,
      }),
    };
  }

  return null;
}

function formatBudgetUsd(value: number) {
  return `${value.toFixed(2)} USD`;
}

export default async function BudgetsPage({ searchParams }: BudgetsPageProps) {
  const locale = await getCurrentLocale();
  const tr = createBudgetTranslator(locale);
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = getSafeReturnTo(resolvedSearchParams.returnTo);
  const focusedBudgetPolicyId = resolvedSearchParams.budgetPolicyId?.trim() ?? null;
  const pageData = await loadBudgetPageData(resolvedSearchParams.workspaceId);
  const selectedWorkspaceId = pageData.selectedWorkspaceId ?? "";
  const selectedWorkspace = pageData.selectedWorkspaceId
    ? pageData.workspaceOptions.find((workspace) => workspace.id === pageData.selectedWorkspaceId) ?? null
    : null;
  const noticeState = getNoticeState(resolvedSearchParams.notice);
  const alertStatsByBudgetPolicyId = getBudgetPolicyAlertStatsById(pageData.alerts);
  const postureSummary = buildBudgetPostureSummary(pageData.budgets, alertStatsByBudgetPolicyId);
  const projectsById = new Map(pageData.projects.map((project) => [project.id, project]));
  const environmentsById = new Map(pageData.environments.map((environment) => [environment.id, environment]));
  const projectedMonthEndUsd = getProjectedMonthlySpend(pageData.workspaceUsageSummary.totalCostUsd);
  const noWorkspaceDescription =
    locale === "zh"
      ? "请使用页头中的全局工作区切换器切换预算范围。"
      : "Use the global workspace switcher in the header to continue.";
  const sortedBudgets = [...pageData.budgets].sort((left, right) =>
    compareBudgetPoliciesByPriority(left, right, alertStatsByBudgetPolicyId),
  );
  const topRiskBudget = postureSummary.topRiskBudgetId
    ? pageData.budgets.find((budget) => budget.id === postureSummary.topRiskBudgetId) ?? null
    : null;
  const topUtilizationBudget = postureSummary.topUtilizationBudgetId
    ? pageData.budgets.find((budget) => budget.id === postureSummary.topUtilizationBudgetId) ?? null
    : null;
  const topProtectedBudget = postureSummary.topProtectedBudgetId
    ? pageData.budgets.find((budget) => budget.id === postureSummary.topProtectedBudgetId) ?? null
    : null;
  const workspaceNotice = buildBudgetWorkspaceNotice({
    activeBudgetCount: postureSummary.activeBudgetCount,
    pausedBudgetCount: postureSummary.pausedBudgetCount,
    blockingBudgetAlertCount: postureSummary.blockingBudgetAlertCount,
    openBudgetAlertCount: postureSummary.openBudgetAlertCount,
    tr,
  });

  return (
    <AppShell
      headerMode="compact"
      showOperatorContextCards={false}
      showSupportPanels={false}
      sidebarVariant="minimal"
      title={tr("Budgets")}
      subtitle=""
      workspaceId={pageData.selectedWorkspaceId}
      workspaceLabel={selectedWorkspace ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}` : null}
    >
      <section className="space-y-5">
        {pageData.workspaceSelectionIssue ? (
          <ControlApiStatusCard issue={pageData.workspaceSelectionIssue} mode="inline" presentation="summary-strip" />
        ) : null}

        {noticeState && resolvedSearchParams.message ? (
          <ResourceInlineNotice
            label={tr(noticeState.label)}
            message={tr(resolvedSearchParams.message)}
            tone={noticeState.tone}
          />
        ) : null}

        {workspaceNotice ? (
          <ResourceInlineNotice
            label={workspaceNotice.title}
            message={workspaceNotice.body}
            tone={workspaceNotice.tone}
          />
        ) : null}

        {!pageData.selectedWorkspaceId ? (
          <EmptyState
            title={tr("No workspace selected")}
            description={noWorkspaceDescription}
          />
        ) : (
          <>
            <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] p-4 shadow-none">
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Risk posture and forecast")}</p>
                    <p className="text-sm text-muted-foreground">
                      {tr("visiblePoliciesSummary", {
                        visible: sortedBudgets.length,
                        total: sortedBudgets.length,
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{tr("Watchlist")}: {postureSummary.softLimitedBudgetCount}</span>
                    <span>·</span>
                    <span>{tr("Paused")}: {postureSummary.pausedBudgetCount}</span>
                    <span>·</span>
                    <span>{tr("Forecast breaches")}: {postureSummary.hardLimitedBudgetCount}</span>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Policies")}</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{pageData.budgets.length}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Open alerts")}</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{pageData.alerts.filter((alert) => alert.status === "open").length}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Projected month-end")}</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{formatBudgetUsd(projectedMonthEndUsd)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{tr("Current workspace usage")}: {pageData.workspaceUsageSummary.totalEvents}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Blocking now")}</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{postureSummary.blockingBudgetAlertCount}</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-border/50 bg-background px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Top risk budget")}</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {topRiskBudget
                        ? translateInlineText(
                            locale,
                            resolveBudgetDisplayContext({ budget: topRiskBudget, projectsById, environmentsById, locale }).scopeLabel,
                          )
                        : tr("No budget policies yet")}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/50 bg-background px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Highest utilization")}</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {topUtilizationBudget
                        ? `${translateInlineText(
                            locale,
                            resolveBudgetDisplayContext({ budget: topUtilizationBudget, projectsById, environmentsById, locale }).scopeLabel,
                          )} · ${getBudgetPolicyUtilizationPercent(topUtilizationBudget)}%`
                        : tr("No budget policies yet")}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/50 bg-background px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Protected spend")}</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {topProtectedBudget
                        ? `${translateInlineText(
                            locale,
                            resolveBudgetDisplayContext({ budget: topProtectedBudget, projectsById, environmentsById, locale }).scopeLabel,
                          )} · ${formatBudgetUsd(topProtectedBudget.preventedEstimatedCostUsd)}`
                        : tr("No budget policies yet")}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <article className="rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] p-5 shadow-none">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Risk posture and forecast")}</p>
                  <h3 className="text-lg font-semibold tracking-[-0.02em] text-foreground">{tr("Policies")}</h3>
                  <p className="text-sm text-muted-foreground">{tr("visiblePoliciesSummary", { visible: pageData.budgets.length, total: pageData.budgets.length })}</p>
                </div>
                <BudgetPolicyCreateDialog
                  description={tr("Define monthly limits and alert thresholds")}
                  environments={pageData.environments}
                  existingPolicies={pageData.budgets}
                  locale={locale}
                  projects={pageData.projects}
                  redirectPath={buildContextualHref(`/budgets?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`, returnTo)}
                  title={tr("Create budget policy")}
                  triggerClassName="shrink-0"
                  triggerLabel={tr("Create policy")}
                  workspaceId={selectedWorkspaceId}
                />
              </div>

              {pageData.budgets.length ? (
                <div className="space-y-3">
                  {sortedBudgets.map((budget) => {
                    const display = resolveBudgetDisplayContext({
                      budget,
                      projectsById,
                      environmentsById,
                      locale,
                    });
                    const alertStats = alertStatsByBudgetPolicyId.get(budget.id);
                    const utilization = getBudgetPolicyUtilizationPercent(budget);
                    const riskLevel = getBudgetRiskLevel({
                      hardLimitReached: budget.hardLimitReached,
                      openAlerts: alertStats?.openAlerts.length ?? 0,
                      blockingAlerts: alertStats?.blockingOpenAlerts.length ?? 0,
                    });
                    const isFocused = focusedBudgetPolicyId === budget.id;
                    const scopeLabel = display.scopeLabel
                      ? translateInlineText(locale, display.scopeLabel)
                      : tr("Workspace scoped");
                    const redirectPath = buildContextualHref(
                      `/budgets?workspaceId=${encodeURIComponent(selectedWorkspaceId)}&budgetPolicyId=${encodeURIComponent(budget.id)}`,
                      returnTo,
                    );

                    return (
                      <div key={budget.id} id={`budget-${budget.id}`}>
                        <LazyDisclosureSection
                          bodyClassName="pt-0"
                          className="rounded-xl border border-border/60 bg-background"
                          defaultOpen={isFocused}
                          summary={
                            <DisclosureSummary
                              badge={<RiskBadge level={riskLevel}>{budget.status === "active" ? tr("Active") : tr("Paused")}</RiskBadge>}
                              description={`${tr("Monthly limit")}: ${formatBudgetUsd(budget.monthlyUsdLimit)}`}
                              meta={`${utilization}%`}
                              title={scopeLabel}
                              variant="tool"
                            />
                          }
                          variant="tool"
                        >
                          <div className="grid gap-4 px-4 py-4">
                            <div className="grid gap-3 md:grid-cols-3">
                              <div className="rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-3.5 py-3">
                                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Open alerts")}</p>
                                <p className="mt-1 text-sm font-medium text-foreground">{alertStats?.openAlerts.length ?? 0}</p>
                              </div>
                              <div className="rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-3.5 py-3">
                                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Blocking now")}</p>
                                <p className="mt-1 text-sm font-medium text-foreground">{alertStats?.blockingOpenAlerts.length ?? 0}</p>
                              </div>
                              <div className="rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-3.5 py-3">
                                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Projected month-end")}</p>
                                <p className="mt-1 text-sm font-medium text-foreground">{formatBudgetUsd(projectedMonthEndUsd)}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span>{tr("Soft limit %")}: {budget.softLimitPercent}%</span>
                              <span>·</span>
                              <span>{tr("Status")}: {budget.status === "active" ? tr("Active") : tr("Paused")}</span>
                              {display.projectName ? (
                                <>
                                  <span>·</span>
                                  <span>{tr("Project")}: {display.projectName}</span>
                                </>
                              ) : null}
                              {display.environment?.name ? (
                                <>
                                  <span>·</span>
                                  <span>{tr("Environment")}: {display.environment.name}</span>
                                </>
                              ) : null}
                            </div>

                            <form action={updateBudgetPolicyAction} className="grid gap-3 rounded-lg border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-4 py-4">
                              <input name="workspaceId" type="hidden" value={selectedWorkspaceId} />
                              <input name="budgetPolicyId" type="hidden" value={budget.id} />
                              <input name="redirectPath" type="hidden" value={redirectPath} />

                              <div className="grid gap-3 md:grid-cols-3">
                                <div className="field">
                                  <label htmlFor={`budget-limit-${budget.id}`}>{tr("Monthly limit")}</label>
                                  <input
                                    defaultValue={budget.monthlyUsdLimit}
                                    id={`budget-limit-${budget.id}`}
                                    min="0.01"
                                    name="monthlyUsdLimit"
                                    step="0.01"
                                    type="number"
                                    required
                                  />
                                </div>

                                <div className="field">
                                  <label htmlFor={`budget-soft-limit-${budget.id}`}>{tr("Soft limit %")}</label>
                                  <input
                                    defaultValue={budget.softLimitPercent}
                                    id={`budget-soft-limit-${budget.id}`}
                                    min="1"
                                    max="100"
                                    name="softLimitPercent"
                                    step="1"
                                    type="number"
                                    required
                                  />
                                </div>

                                <div className="field">
                                  <label htmlFor={`budget-status-${budget.id}`}>{tr("Status")}</label>
                                  <select
                                    defaultValue={budget.status}
                                    id={`budget-status-${budget.id}`}
                                    name="status"
                                  >
                                    <option value="active">{tr("Active")}</option>
                                    <option value="paused">{tr("Paused")}</option>
                                  </select>
                                </div>
                              </div>

                              <div className="flex flex-wrap justify-end gap-2">
                                <PendingSubmitButton
                                  className="button"
                                  formAction={updateBudgetPolicyAction}
                                  pendingLabel={tr("Saving changes...")}
                                >
                                  {tr("Save changes")}
                                </PendingSubmitButton>
                                <ConfirmSubmitButton
                                  className="button button--ghost button--destructive"
                                  confirmDescription={tr("This permanently removes the policy from the selected workspace.")}
                                  confirmLabel={tr("Delete policy")}
                                  confirmTitle={locale === "zh" ? `删除 ${scopeLabel}？` : `Delete ${scopeLabel}?`}
                                  formAction={deleteBudgetPolicyAction}
                                  formNoValidate
                                  pendingLabel={tr("Deleting...")}
                                >
                                  {tr("Delete policy")}
                                </ConfirmSubmitButton>
                                <input name="deleteRedirectPath" type="hidden" value={redirectPath} />
                              </div>
                            </form>
                          </div>
                        </LazyDisclosureSection>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title={tr("No budget policies yet")}
                  description={tr("Create the first budget policy to start enforcing thresholds.")}
                />
              )}
            </article>
          </>
        )}
      </section>
    </AppShell>
  );
}
