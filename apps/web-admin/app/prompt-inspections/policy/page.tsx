import { Link } from "@/i18n/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AppShell } from "../../components/app-shell";
import { ResourceInlineNotice } from "../../components/resource-inline-notice";
import { ResourcePageFiltersCard } from "../../components/resource-page-filters-card";
import {
  diagnoseControlApiIssue,
  getPromptPolicy,
  getWorkspaceHomeOverview,
  loadWorkspaceSelectionWithOptimisticData,
  pickFirstControlApiIssue,
} from "../../lib/control-api";
import { getCurrentLocale } from "../../lib/i18n-server";
import { getUserErrorMessage } from "../../lib/user-facing-error";
import { updatePromptPolicyAction } from "../actions";
import {
  buildPromptInspectionPolicyHref,
  buildPromptInspectionsPageHref,
} from "../page-state";
type PromptInspectionPolicyPageProps = {
  searchParams?: Promise<{
    workspaceId?: string;
    returnTo?: string;
    notice?: string;
    message?: string;
  }>;
};
function getOptionalFilter(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
export default async function PromptInspectionPolicyPage({
  searchParams,
}: PromptInspectionPolicyPageProps) {
  const locale = await getCurrentLocale();
  const appLocale = locale === "zh" ? "zh" : "en";
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedWorkspaceId = getOptionalFilter(
    resolvedSearchParams.workspaceId,
  );
  const returnTo = getOptionalFilter(resolvedSearchParams.returnTo);
  const notice = getOptionalFilter(resolvedSearchParams.notice);
  const message = getOptionalFilter(resolvedSearchParams.message);
  const text = {
    title: appLocale === "zh" ? "内容审查策略" : "Content review policy",
    subtitle:
      appLocale === "zh"
        ? "管理当前工作区的 Prompt 检查阈值、证据方式与例外规则。"
        : "Manage prompt inspection thresholds, evidence mode, and rule overrides for this workspace.",
    workspaceRequired:
      appLocale === "zh"
        ? "先选择一个工作区，才能管理内容审查策略。"
        : "Select a workspace before managing content review policy.",
    unavailable:
      appLocale === "zh"
        ? "当前无法加载该工作区的内容审查策略。"
        : "Content review policy is unavailable for this workspace right now.",
    permissionRequired:
      appLocale === "zh"
        ? "只有具备内容审查策略写权限的角色才能更新该工作区策略。"
        : "Only roles with content review policy write access can update this workspace policy.",
    backToQueue: appLocale === "zh" ? "返回内容审查" : "Back to content review",
    enabledLabel: appLocale === "zh" ? "启用检测" : "Enable inspection",
    modeLabel: appLocale === "zh" ? "处置模式" : "Mode",
    evidenceLabel: appLocale === "zh" ? "证据模式" : "Evidence",
    reviewThreshold: appLocale === "zh" ? "复核阈值" : "Review threshold",
    blockThreshold: appLocale === "zh" ? "阻断阈值" : "Block threshold",
    domainsLabel: appLocale === "zh" ? "允许域名" : "Allowed domains",
    keywordsLabel: appLocale === "zh" ? "放行关键词" : "Allowed keywords",
    disabledRulesLabel: appLocale === "zh" ? "禁用规则" : "Disabled rules",
    save: appLocale === "zh" ? "保存策略" : "Save policy",
    summary: appLocale === "zh" ? "当前策略" : "Current policy",
    scopeLabel: appLocale === "zh" ? "作用范围" : "Scope",
  };
  const workspaceSelection = await loadWorkspaceSelectionWithOptimisticData(
    requestedWorkspaceId,
    async () => null,
  );
  const selectedWorkspaceId = workspaceSelection.selectedWorkspaceId;
  const selectedWorkspace = selectedWorkspaceId
    ? (workspaceSelection.workspaceOptions.find(
        (workspace) => workspace.id === selectedWorkspaceId,
      ) ?? null)
    : null;
  let issue = workspaceSelection.issue;
  let policy = null as Awaited<ReturnType<typeof getPromptPolicy>> | null;
  let policyError: string | null = null;
  let canManagePromptPolicy = false;
  if (selectedWorkspaceId && !issue) {
    const workspaceOverview = await getWorkspaceHomeOverview(
      selectedWorkspaceId,
    ).catch((error) => {
      issue = pickFirstControlApiIssue(issue, diagnoseControlApiIssue(error));
      return null;
    });
    const promptInspectionPermissions = workspaceOverview?.permissions as
      | Record<string, boolean>
      | undefined;
    canManagePromptPolicy =
      promptInspectionPermissions?.promptPolicyWrite === true;
    if (canManagePromptPolicy) {
      policy = await getPromptPolicy(selectedWorkspaceId).catch((error) => {
        policyError = getUserErrorMessage(
          error,
          appLocale === "zh" ? "无法加载策略。" : "Can't load policy.",
        );
        return null;
      });
    }
  }
  const queueHref = buildPromptInspectionsPageHref({
    workspaceId: selectedWorkspaceId,
  });
  const pageHref = buildPromptInspectionPolicyHref({
    workspaceId: selectedWorkspaceId,
    returnTo,
  });
  const noticeTone =
    notice === "error" ? "error" : notice === "success" ? "success" : null;
  const noWorkspaceDescription =
    appLocale === "zh"
      ? "请使用页头中的全局工作区切换器继续。"
      : "Use the global workspace switcher in the header to continue.";
  const filterSelectClassName =
    "h-[36px] w-full rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] hover:border-[color:var(--border-strong)] focus:border-[color:var(--primary-border-strong)]";
  return (
    <AppShell
      headerMode="compact"
      showOperatorContextCards={false}
      showSupportPanels={false}
      sidebarVariant="minimal"
      title={text.title}
      subtitle={text.subtitle}
      workspaceId={selectedWorkspaceId}
      workspaceOptions={workspaceSelection.workspaceOptions.map(
        (workspace) => ({
          id: workspace.id,
          label: `${workspace.organizationName} / ${workspace.name}`,
        }),
      )}
      workspaceLabel={
        selectedWorkspace
          ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}`
          : null
      }
    >
      {" "}
      <section className="space-y-4">
        {" "}
        {!selectedWorkspaceId ? (
          <EmptyState
            compact
            description={noWorkspaceDescription}
            title={text.title}
          />
        ) : null}{" "}
        {selectedWorkspaceId && issue ? (
          <EmptyState
            compact
            description={text.unavailable}
            title={text.title}
          />
        ) : null}{" "}
        {selectedWorkspaceId && !issue ? (
          <>
            {" "}
            <ResourcePageFiltersCard
              actions={
                <Link className="button button--ghost" href={queueHref}>
                  {text.backToQueue}
                </Link>
              }
              returnTo={returnTo}
              title={text.summary}
              variant="toolbar"
            >
              {" "}
              <p className="text-sm text-muted-foreground">
                {" "}
                {appLocale === "zh"
                  ? "策略更新会立即影响当前工作区后续命中的 Prompt 检查记录。"
                  : "Policy changes apply to future prompt inspections in the current workspace immediately."}{" "}
              </p>{" "}
            </ResourcePageFiltersCard>{" "}
            {noticeTone && message ? (
              <ResourceInlineNotice
                label={
                  noticeTone === "error"
                    ? appLocale === "zh"
                      ? "错误"
                      : "Error"
                    : appLocale === "zh"
                      ? "已保存"
                      : "Saved"
                }
                message={message}
                tone={noticeTone}
              />
            ) : null}{" "}
            {policyError ? (
              <ResourceInlineNotice
                label={appLocale === "zh" ? "错误" : "Error"}
                message={policyError}
                tone="error"
              />
            ) : null}{" "}
            {!canManagePromptPolicy ? (
              <EmptyState
                compact
                description={text.permissionRequired}
                title={text.title}
              />
            ) : null}{" "}
            {canManagePromptPolicy ? (
              <Card className="overflow-hidden border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)]">
                {" "}
                <CardHeader className="pb-3">
                  {" "}
                  <div className="space-y-0.5">
                    {" "}
                    <h2 className="text-sm font-semibold text-foreground">
                      {text.summary}
                    </h2>{" "}
                    <p className="text-sm text-muted-foreground">
                      {" "}
                      {policy
                        ? `${policy.enabled ? (appLocale === "zh" ? "已启用" : "Enabled") : appLocale === "zh" ? "已关闭" : "Disabled"} · ${policy.enforcementMode} · ${policy.evidenceMode}`
                        : appLocale === "zh"
                          ? "调整阈值、证据方式与例外规则。"
                          : "Adjust thresholds, evidence mode, and rule overrides."}{" "}
                    </p>{" "}
                  </div>{" "}
                </CardHeader>{" "}
                <CardContent>
                  {" "}
                  <form
                    action={updatePromptPolicyAction}
                    className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    {" "}
                    <input
                      name="workspaceId"
                      type="hidden"
                      value={selectedWorkspaceId ?? ""}
                    />{" "}
                    <input name="redirectTo" type="hidden" value={pageHref} />{" "}
                    <input name="fallbackPath" type="hidden" value={pageHref} />{" "}
                    <label className="flex items-center justify-between gap-4 rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-2)_50%,var(--surface-1)_50%)] px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-[color:color-mix(in_srgb,var(--surface-2)_70%,var(--surface-1)_30%)] lg:col-span-2">
                      {" "}
                      <span>{text.enabledLabel}</span>{" "}
                      <input
                        className="size-[15px] accent-[color:var(--primary)]"
                        defaultChecked={policy?.enabled ?? false}
                        name="enabled"
                        type="checkbox"
                      />{" "}
                    </label>{" "}
                    <label className="grid gap-1 text-[13px] text-muted-foreground">
                      {" "}
                      <span>{text.modeLabel}</span>{" "}
                      <select
                        className={filterSelectClassName}
                        defaultValue={policy?.enforcementMode ?? "graded"}
                        name="enforcementMode"
                      >
                        {" "}
                        <option value="graded">graded</option>{" "}
                        <option value="alert_only">alert_only</option>{" "}
                        <option value="strict">strict</option>{" "}
                      </select>{" "}
                    </label>{" "}
                    <label className="grid gap-1 text-[13px] text-muted-foreground">
                      {" "}
                      <span>{text.evidenceLabel}</span>{" "}
                      <select
                        className={filterSelectClassName}
                        defaultValue={
                          policy?.evidenceMode ?? "redacted_snippet"
                        }
                        name="evidenceMode"
                      >
                        {" "}
                        <option value="redacted_snippet">
                          redacted_snippet
                        </option>{" "}
                        <option value="fingerprint_only">
                          fingerprint_only
                        </option>{" "}
                        <option value="disabled">disabled</option>{" "}
                      </select>{" "}
                    </label>{" "}
                    <label className="grid gap-1 text-[13px] text-muted-foreground">
                      {" "}
                      <span>{text.reviewThreshold}</span>{" "}
                      <Input
                        defaultValue={policy?.reviewThreshold ?? 60}
                        name="reviewThreshold"
                        type="number"
                      />{" "}
                    </label>{" "}
                    <label className="grid gap-1 text-[13px] text-muted-foreground">
                      {" "}
                      <span>{text.blockThreshold}</span>{" "}
                      <Input
                        defaultValue={policy?.blockThreshold ?? 100}
                        name="blockThreshold"
                        type="number"
                      />{" "}
                    </label>{" "}
                    <label className="grid gap-1 text-[13px] text-muted-foreground lg:col-span-2">
                      {" "}
                      <span>{text.domainsLabel}</span>{" "}
                      <textarea
                        className="min-h-[88px] rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 py-2 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/68 hover:border-[color:var(--border-strong)] focus:border-[color:var(--primary-border-strong)] resize-none"
                        defaultValue={(
                          policy?.allowedExternalDomains ?? []
                        ).join("\n")}
                        name="allowedExternalDomains"
                      />{" "}
                    </label>{" "}
                    <label className="grid gap-1 text-[13px] text-muted-foreground lg:col-span-2">
                      {" "}
                      <span>{text.keywordsLabel}</span>{" "}
                      <textarea
                        className="min-h-[88px] rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 py-2 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/68 hover:border-[color:var(--border-strong)] focus:border-[color:var(--primary-border-strong)] resize-none"
                        defaultValue={(
                          policy?.allowedKeywordOverrides ?? []
                        ).join("\n")}
                        name="allowedKeywordOverrides"
                      />{" "}
                    </label>{" "}
                    <label className="grid gap-1 text-[13px] text-muted-foreground lg:col-span-2">
                      {" "}
                      <span>{text.disabledRulesLabel}</span>{" "}
                      <textarea
                        className="min-h-[88px] rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 py-2 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/68 hover:border-[color:var(--border-strong)] focus:border-[color:var(--primary-border-strong)] resize-none"
                        defaultValue={(policy?.disabledRuleIds ?? []).join(
                          "\n",
                        )}
                        name="disabledRuleIds"
                      />{" "}
                    </label>{" "}
                    <div className="lg:col-span-2">
                      {" "}
                      <Button size="sm" type="submit">
                        {text.save}
                      </Button>{" "}
                    </div>{" "}
                  </form>{" "}
                </CardContent>{" "}
              </Card>
            ) : null}{" "}
          </>
        ) : null}{" "}
      </section>{" "}
    </AppShell>
  );
}
