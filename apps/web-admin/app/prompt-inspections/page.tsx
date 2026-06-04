import { Link } from "@/i18n/navigation";
import type { PromptInspectionSort, SavedView } from "@teamops/contracts";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AppShell } from "../components/app-shell";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { ResourceSummaryStrip } from "../components/resource-summary-strip";
import { ResourceTableSection } from "../components/resource-table-section";
import { getCurrentLocale } from "../lib/i18n-server";
import { buildUsageEventHref } from "../lib/navigation";
import {
  diagnoseControlApiIssue,
  getPromptInspection,
  getPromptInspectionSummary,
  getUsageEvent,
  getWorkspaceHomeOverview,
  listPromptInspections,
  listProjects,
  listProviderConnections,
  listVirtualKeys,
  listWorkspaceEnvironments,
  loadSavedViewsState,
  loadWorkspaceSelectionWithOptimisticData,
  pickFirstControlApiIssue,
} from "../lib/control-api";
import { getUserErrorMessage } from "../lib/user-facing-error";
import { createSavedViewAction } from "../saved-views/actions";
import { reviewPromptInspectionAction } from "./actions";
import {
  PromptInspectionsTable,
  type PromptInspectionTableRow,
  type PromptInspectionTableSortState,
} from "./prompt-inspections-table";
import { buildPromptInspectionRelationshipModel } from "./prompt-inspection-relationships";
import {
  buildCompactPageNumbers,
  buildPromptInspectionPolicyHref,
  buildPromptInspectionSavedViewOpenHref,
  buildPromptInspectionsPageHref,
  getNextPromptInspectionSort,
  getPromptInspectionSortIndicator,
  promptInspectionDefaultSort,
  shouldDefaultToPendingQueue,
} from "./page-state";
const providerOptions = [
  "anthropic",
  "openai",
  "openai-compatible",
  "bedrock",
  "vertex",
] as const;
const verdictOptions = ["allow_with_record", "review", "block"] as const;
const reviewStatusOptions = [
  "pending",
  "confirmed_violation",
  "confirmed_benign",
  "needs_followup",
] as const;
const pageSizeOptions = [25, 50, 100] as const;
const promptInspectionSortOptions: Array<{
  value: PromptInspectionSort;
  label: { zh: string; en: string };
}> = [
  { value: "newest", label: { zh: "最新优先", en: "Newest first" } },
  { value: "oldest", label: { zh: "最早优先", en: "Oldest first" } },
  {
    value: "score_desc",
    label: { zh: "分数从高到低", en: "Score high to low" },
  },
  {
    value: "score_asc",
    label: { zh: "分数从低到高", en: "Score low to high" },
  },
  {
    value: "verdict_priority",
    label: { zh: "结论优先级", en: "Verdict priority" },
  },
  {
    value: "review_status_priority",
    label: { zh: "复核优先级", en: "Review priority" },
  },
  { value: "provider_asc", label: { zh: "供应商 A-Z", en: "Provider A-Z" } },
  { value: "model_asc", label: { zh: "模型 A-Z", en: "Model A-Z" } },
] as const;
const riskOptions = [
  "secret_exfiltration",
  "credential_exposure",
  "pii_exposure",
  "customer_data_export",
  "external_business",
  "personal_use",
  "policy_evasion",
  "suspicious_obfuscation",
] as const;
const activityOptions = [
  "coding",
  "debugging",
  "testing",
  "documentation",
  "translation",
  "research",
  "external_delivery",
  "non_work",
  "unknown",
] as const;
type PromptInspectionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
function getSingleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}
function getOptionalFilter(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function parseOffset(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}
function parsePageSize(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return pageSizeOptions.includes(parsed as (typeof pageSizeOptions)[number])
    ? parsed
    : 25;
}
function getSavedViewNoticeTone(value: string | null) {
  if (value === "error" || value === "success") {
    return value;
  }
  return null;
}
function formatVerdict(locale: "zh" | "en", value: string) {
  const labels: Record<string, string> =
    locale === "zh"
      ? {
          allow_clean: "安全通过",
          allow_with_record: "通过并记录",
          review: "人工复核",
          block: "安全阻断",
        }
      : {
          allow_clean: "Allow clean",
          allow_with_record: "Allow with record",
          review: "Needs review",
          block: "Blocked",
        };
  return labels[value] ?? value;
}
function formatReviewStatus(locale: "zh" | "en", value: string) {
  const labels: Record<string, string> =
    locale === "zh"
      ? {
          pending: "待处理",
          confirmed_violation: "确认违规",
          confirmed_benign: "确认正常",
          needs_followup: "标记跟进",
        }
      : {
          pending: "Pending",
          confirmed_violation: "Confirmed violation",
          confirmed_benign: "Confirmed benign",
          needs_followup: "Needs follow-up",
        };
  return labels[value] ?? value;
}
function formatRiskCategory(locale: "zh" | "en", value: string) {
  const labels: Record<string, string> =
    locale === "zh"
      ? {
          secret_exfiltration: "机密信息外泄",
          credential_exposure: "登录凭证暴露",
          pii_exposure: "个人隐私泄漏",
          customer_data_export: "客户数据导出",
          external_business: "外部业务关联",
          personal_use: "非工作用途",
          policy_evasion: "规避公司策略",
          suspicious_obfuscation: "可疑内容混淆",
        }
      : {
          secret_exfiltration: "Secrets exfiltration",
          credential_exposure: "Credential exposure",
          pii_exposure: "PII exposure",
          customer_data_export: "Customer data export",
          external_business: "External business",
          personal_use: "Personal use",
          policy_evasion: "Policy evasion",
          suspicious_obfuscation: "Suspicious obfuscation",
        };
  return labels[value] ?? value;
}
function formatActivityLabel(locale: "zh" | "en", value: string) {
  const labels: Record<string, string> =
    locale === "zh"
      ? {
          coding: "编码",
          debugging: "调试",
          testing: "测试",
          documentation: "文档",
          translation: "翻译",
          research: "研究",
          external_delivery: "外部交付",
          non_work: "非工作内容",
          unknown: "未知",
        }
      : {
          coding: "Coding",
          debugging: "Debugging",
          testing: "Testing",
          documentation: "Documentation",
          translation: "Translation",
          research: "Research",
          external_delivery: "External delivery",
          non_work: "Non-work",
          unknown: "Unknown",
        };
  return labels[value] ?? value;
}
function formatRuleId(value: string) {
  return value
    .replace(/[_-]+/g, "")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
function formatContextKey(locale: "zh" | "en", value: string) {
  const labels: Record<string, { zh: string; en: string }> = {
    attachmentCount: { zh: "附件数", en: "Attachments" },
    externalDomainCount: { zh: "外部域名数", en: "External domains" },
    externalLinkCount: { zh: "外链数", en: "External links" },
    fileCount: { zh: "文件数", en: "Files" },
    imageCount: { zh: "图片数", en: "Images" },
    messageCount: { zh: "消息数", en: "Messages" },
    riskSignalCount: { zh: "风险信号", en: "Risk signals" },
    toolCallCount: { zh: "工具调用数", en: "Tool calls" },
    urlCount: { zh: "链接数", en: "URLs" },
  };
  const known = labels[value];
  if (known) {
    return known[locale];
  }
  return value
    .replace(/([A-Z])/g, "$1")
    .replace(/[_-]+/g, "")
    .trim();
}
function formatContextValue(locale: "zh" | "en", value: unknown) {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return locale === "zh" ? `${value.length} 项` : `${value.length} items`;
  }
  if (value && typeof value === "object") {
    return locale === "zh"
      ? `${Object.keys(value).length} 个字段`
      : `${Object.keys(value).length} fields`;
  }
  return "n/a";
}
function summarizeContextCounts(
  locale: "zh" | "en",
  contextCounts: Record<string, unknown>,
) {
  return Object.entries(contextCounts)
    .filter(([, value]) => {
      if (value === null || value === undefined || value === "") {
        return false;
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (typeof value === "object") {
        return Object.keys(value).length > 0;
      }
      return true;
    })
    .slice(0, 5)
    .map(([key, value]) => ({
      key,
      label: formatContextKey(locale, key),
      value: formatContextValue(locale, value),
    }));
}
function formatDateTime(locale: "zh" | "en", value: string) {
  return new Date(value).toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
}
export default async function PromptInspectionsPage(
  props: PromptInspectionsPageProps,
) {
  const locale = await getCurrentLocale();
  const appLocale = locale === "zh" ? "zh" : "en";
  const rawSearchParams = props.searchParams ? await props.searchParams : {};
  const defaultToPendingQueue = shouldDefaultToPendingQueue(rawSearchParams);
  const requestedWorkspaceId = getOptionalFilter(
    getSingleValue(rawSearchParams.workspaceId),
  );
  const selectedProjectId = getOptionalFilter(
    getSingleValue(rawSearchParams.projectId),
  );
  const selectedEnvironmentId = getOptionalFilter(
    getSingleValue(rawSearchParams.environmentId),
  );
  const selectedVerdict = getOptionalFilter(
    getSingleValue(rawSearchParams.verdict),
  );
  const requestedReviewStatus = getOptionalFilter(
    getSingleValue(rawSearchParams.reviewStatus),
  );
  const selectedReviewStatus =
    requestedReviewStatus ?? (defaultToPendingQueue ? "pending" : null);
  const selectedRiskCategory = getOptionalFilter(
    getSingleValue(rawSearchParams.riskCategory),
  );
  const selectedActivityLabel = getOptionalFilter(
    getSingleValue(rawSearchParams.activityLabel),
  );
  const selectedInspectionId = getOptionalFilter(
    getSingleValue(rawSearchParams.inspectionId),
  );
  const requestedSavedViewId = getOptionalFilter(
    getSingleValue(rawSearchParams.savedViewId),
  );
  const selectedProvider = getOptionalFilter(
    getSingleValue(rawSearchParams.provider),
  );
  const selectedProviderConnectionId = getOptionalFilter(
    getSingleValue(rawSearchParams.providerConnectionId),
  );
  const selectedModel = getOptionalFilter(
    getSingleValue(rawSearchParams.model),
  );
  const selectedVirtualKeyId = getOptionalFilter(
    getSingleValue(rawSearchParams.virtualKeyId),
  );
  const selectedRequestId = getOptionalFilter(
    getSingleValue(rawSearchParams.requestId),
  );
  const selectedFrom = getOptionalFilter(getSingleValue(rawSearchParams.from));
  const selectedTo = getOptionalFilter(getSingleValue(rawSearchParams.to));
  const selectedEscalatedOnly =
    getOptionalFilter(getSingleValue(rawSearchParams.escalatedOnly)) === "true";
  const requestedSortBy = getOptionalFilter(
    getSingleValue(rawSearchParams.sortBy),
  );
  const selectedSortBy = promptInspectionSortOptions.some(
    (option) => option.value === requestedSortBy,
  )
    ? (requestedSortBy as PromptInspectionSort)
    : promptInspectionDefaultSort;
  const offset = parseOffset(getSingleValue(rawSearchParams.offset));
  const pageSize = parsePageSize(getSingleValue(rawSearchParams.pageSize));
  const notice = getOptionalFilter(getSingleValue(rawSearchParams.notice));
  const noticeMessage = getOptionalFilter(
    getSingleValue(rawSearchParams.message),
  );
  const savedViewNotice = getSavedViewNoticeTone(
    getOptionalFilter(getSingleValue(rawSearchParams.savedViewNotice)),
  );
  const savedViewMessage = getOptionalFilter(
    getSingleValue(rawSearchParams.savedViewMessage),
  );
  const text = {
    title: appLocale === "zh" ? "内容审查" : "Content review",
    subtitle:
      appLocale === "zh"
        ? "复核命中的提示词活动、脱敏证据与人工处置状态。"
        : "Review flagged prompt activity, redacted evidence, and operator dispositions.",
    workspaceRequired:
      appLocale === "zh"
        ? "先选择一个工作区，才能查看内容审查队列。"
        : "Select a workspace before reviewing the content review queue.",
    unavailable:
      appLocale === "zh"
        ? "当前无法加载该工作区的内容审查记录。"
        : "Content review records are unavailable for this workspace right now.",
    currentScope: appLocale === "zh" ? "当前范围" : "Current scope",
    filters: appLocale === "zh" ? "筛选" : "Filters",
    applyFilters: appLocale === "zh" ? "搜索" : "Search",
    reset: appLocale === "zh" ? "重置" : "Reset",
    moreFilters: appLocale === "zh" ? "更多筛选" : "More filters",
    exportCsv: appLocale === "zh" ? "导出 CSV" : "Export CSV",
    openPolicy: appLocale === "zh" ? "查看策略" : "View policy",
    providerLabel: appLocale === "zh" ? "供应商" : "Provider",
    providerConnectionLabel:
      appLocale === "zh" ? "供应商连接" : "Provider connection",
    modelLabel: appLocale === "zh" ? "模型" : "Model",
    virtualKeyLabel: appLocale === "zh" ? "虚拟密钥" : "Virtual key",
    requestIdLabel: appLocale === "zh" ? "请求 ID" : "Request ID",
    requestIdPlaceholder:
      appLocale === "zh"
        ? "输入请求 ID 或关键词搜索..."
        : "Enter Request ID or keywords...",
    fromLabel: appLocale === "zh" ? "开始时间" : "From",
    toLabel: appLocale === "zh" ? "结束时间" : "To",
    escalatedOnlyLabel: appLocale === "zh" ? "只看升级项" : "Escalated only",
    summary: appLocale === "zh" ? "摘要" : "Summary",
    pendingReview: appLocale === "zh" ? "待复核" : "Pending review",
    blocked: appLocale === "zh" ? "已阻断" : "Blocked",
    escalated: appLocale === "zh" ? "升级" : "Escalated",
    records:
      appLocale === "zh" ? "内容检查记录" : "Prompt inspection records",
    recordDetail: appLocale === "zh" ? "记录详情" : "Record detail",
    noItems:
      appLocale === "zh"
        ? "当前筛选下还没有命中的内容检查记录。"
        : "No prompt inspection records matched the current filters.",
    selectDetail:
      appLocale === "zh"
        ? "从队列中选择一条记录查看证据和处置。"
        : "Select a record from the queue to review evidence and take action.",
    noSummary:
      appLocale === "zh"
        ? "当前队列里还没有可用摘要。"
        : "No summary data is available in the current queue.",
    sortByLabel: appLocale === "zh" ? "排序" : "Sort",
    pageSizeLabel: appLocale === "zh" ? "每页条数" : "Rows per page",
    openUsage: appLocale === "zh" ? "打开用量事件" : "Open usage event",
    relationshipsTitle:
      appLocale === "zh" ? "关联链路" : "Evidence relationships",
    relationshipsDescription:
      appLocale === "zh"
        ? "先看清这条内容审查记录挂在哪条访问链路上，再继续调查。"
        : "See where this content review record sits in the access path before drilling deeper.",
    noRelationships:
      appLocale === "zh"
        ? "当前记录没有可展示的一跳关联实体。"
        : "No one-hop related entities are available for this record.",
    reviewNoteLabel: appLocale === "zh" ? "复核备注" : "Review note",
    noReviewNote:
      appLocale === "zh" ? "当前没有复核备注。" : "No review note saved.",
    reviewMetaPending:
      appLocale === "zh"
        ? "尚未人工复核。"
        : "No operator review recorded yet.",
    evidenceTruncated:
      appLocale === "zh"
        ? "证据已按当前策略做截断展示。"
        : "Evidence was truncated by the current policy.",
    noEvidence:
      appLocale === "zh"
        ? "当前没有可展示证据。"
        : "No redacted evidence is available.",
    hitRules: appLocale === "zh" ? "命中规则" : "Hit rules",
    redactedEvidence: appLocale === "zh" ? "脱敏证据" : "Redacted evidence",
    contextSummary: appLocale === "zh" ? "上下文摘要" : "Context summary",
    rawContext: appLocale === "zh" ? "原始上下文" : "Raw context",
    noContext:
      appLocale === "zh"
        ? "当前没有结构化上下文摘要。"
        : "No structured context summary is available.",
    reviewActionsUnavailable:
      appLocale === "zh"
        ? "只有具备内容审查写权限的角色才能提交处置结果。"
        : "Only roles with content review write access can submit dispositions.",
    reviewActionsTitle:
      appLocale === "zh" ? "处置当前记录" : "Disposition current record",
    reviewActionsDescription:
      appLocale === "zh"
        ? "单条处置只作用于当前记录。"
        : "Single-record disposition only applies to the selected record.",
    savedViewsTitle: appLocale === "zh" ? "已保存视图" : "Saved views",
    savedViewsDescription:
      appLocale === "zh"
        ? "保存常用队列，快速回到同一批复核视图。"
        : "Save repeat queues and jump back into the same review views.",
    saveCurrentView: appLocale === "zh" ? "保存当前视图" : "Save current view",
    noSavedViews:
      appLocale === "zh"
        ? "当前还没有已保存视图。"
        : "No saved views exist yet.",
    activeSavedView:
      appLocale === "zh" ? "当前已保存视图" : "Current saved view",
    allInWorkspace:
      appLocale === "zh"
        ? "显示当前工作区内的全部内容检查记录。"
        : "Showing all prompt inspection records in this workspace.",
    queueInWorkspace:
      appLocale === "zh"
        ? "显示当前工作区待人工处理的内容检查记录。"
        : "Showing prompt inspection records that still need operator review.",
    filterByProject: appLocale === "zh" ? "项目" : "Project",
    filterByEnvironment: appLocale === "zh" ? "环境" : "Environment",
    filterByVerdict: appLocale === "zh" ? "处置结论" : "Verdict",
    filterByReviewStatus: appLocale === "zh" ? "复核状态" : "Review status",
    filterByRiskCategory: appLocale === "zh" ? "风险类型" : "Risk category",
    filterByActivity: appLocale === "zh" ? "活动标签" : "Activity",
    confirmViolation: appLocale === "zh" ? "确认违规" : "Confirm violation",
    confirmBenign: appLocale === "zh" ? "确认正常" : "Confirm benign",
    needsFollowUp: appLocale === "zh" ? "继续跟进" : "Needs follow-up",
    openSavedView: appLocale === "zh" ? "打开视图" : "Open view",
  };
  const workspaceSelection = await loadWorkspaceSelectionWithOptimisticData(
    requestedWorkspaceId,
    async (workspaceId) =>
      Promise.all([
        listProjects(workspaceId),
        listWorkspaceEnvironments(workspaceId),
        listProviderConnections(workspaceId),
        listVirtualKeys(workspaceId, { limit: 100, offset: 0 }),
      ]),
  );
  const selectedWorkspaceId = workspaceSelection.selectedWorkspaceId;
  const selectedWorkspace = selectedWorkspaceId
    ? (workspaceSelection.workspaceOptions.find(
        (workspace) => workspace.id === selectedWorkspaceId,
      ) ?? null)
    : null;
  let issue = workspaceSelection.issue;
  let projects = [] as Awaited<ReturnType<typeof listProjects>>;
  let environments = [] as Awaited<
    ReturnType<typeof listWorkspaceEnvironments>
  >;
  let providerConnections = [] as Awaited<
    ReturnType<typeof listProviderConnections>
  >;
  let virtualKeyOptions = [] as Awaited<
    ReturnType<typeof listVirtualKeys>
  >["items"];
  let workspaceOverview = null as Awaited<
    ReturnType<typeof getWorkspaceHomeOverview>
  > | null;
  let inspectionsError: string | null = null;
  let summaryError: string | null = null;
  let detailError: string | null = null;
  let savedViews: SavedView[] = [];
  let savedViewsIssue: Awaited<
    ReturnType<typeof loadSavedViewsState>
  >["issue"] = null;
  if (workspaceSelection.dataResult?.ok) {
    [
      projects,
      environments,
      providerConnections,
      { items: virtualKeyOptions },
    ] = workspaceSelection.dataResult.data;
  } else if (workspaceSelection.dataResult) {
    issue = pickFirstControlApiIssue(
      issue,
      diagnoseControlApiIssue(workspaceSelection.dataResult.error),
    );
  }
  if (selectedWorkspaceId && !issue) {
    workspaceOverview = await getWorkspaceHomeOverview(
      selectedWorkspaceId,
    ).catch((error) => {
      issue = pickFirstControlApiIssue(issue, diagnoseControlApiIssue(error));
      return null;
    });
    const savedViewState = await loadSavedViewsState(
      selectedWorkspaceId,
      "prompt-inspections",
    );
    savedViews = savedViewState.items;
    savedViewsIssue = savedViewState.issue;
  }
  const promptInspectionPermissions = workspaceOverview?.permissions as
    | Record<string, boolean>
    | undefined;
  const canReviewPromptInspections =
    promptInspectionPermissions?.promptInspectionReview === true;
  const canManagePromptPolicy =
    promptInspectionPermissions?.promptPolicyWrite === true;
  const inspectionFilters = selectedWorkspaceId
    ? {
        workspaceId: selectedWorkspaceId,
        projectId: selectedProjectId,
        environmentId: selectedEnvironmentId,
        provider: selectedProvider as (typeof providerOptions)[number] | null,
        providerConnectionId: selectedProviderConnectionId,
        model: selectedModel,
        virtualKeyId: selectedVirtualKeyId,
        requestId: selectedRequestId,
        verdict: selectedVerdict as (typeof verdictOptions)[number] | null,
        reviewStatus: selectedReviewStatus as
          | (typeof reviewStatusOptions)[number]
          | null,
        riskCategory: selectedRiskCategory as
          | (typeof riskOptions)[number]
          | null,
        activityLabel: selectedActivityLabel as
          | (typeof activityOptions)[number]
          | null,
        escalatedOnly: selectedEscalatedOnly,
        sortBy: selectedSortBy,
        from: selectedFrom,
        to: selectedTo,
      }
    : null;
  const [inspections, summary] =
    inspectionFilters && !issue
      ? await Promise.all([
          listPromptInspections({
            ...inspectionFilters,
            limit: pageSize,
            offset,
          }).catch((error) => {
            inspectionsError = getUserErrorMessage(
              error,
              appLocale === "zh"
                ? "无法加载检查记录。"
                : "Can't load inspection records.",
            );
            return { items: [], total: 0 };
          }),
          getPromptInspectionSummary(inspectionFilters).catch((error) => {
            summaryError = getUserErrorMessage(
              error,
              appLocale === "zh" ? "无法加载摘要。" : "Can't load summary.",
            );
            return {
              total: 0,
              escalatedCount: 0,
              verdictBreakdown: [],
              reviewStatusBreakdown: [],
              riskCategoryBreakdown: [],
              activityBreakdown: [],
            };
          }),
        ])
      : [
          { items: [], total: 0 },
          {
            total: 0,
            escalatedCount: 0,
            verdictBreakdown: [],
            reviewStatusBreakdown: [],
            riskCategoryBreakdown: [],
            activityBreakdown: [],
          },
        ];
  const selectedInspection =
    selectedInspectionId && selectedWorkspaceId && !issue
      ? await getPromptInspection(selectedInspectionId).catch((error) => {
          detailError = getUserErrorMessage(
            error,
            appLocale === "zh"
              ? "无法加载检查详情。"
              : "Can't load inspection detail.",
          );
          return null;
        })
      : null;
  const visibleInspection =
    selectedInspection &&
    selectedWorkspaceId &&
    selectedInspection.workspaceId === selectedWorkspaceId
      ? selectedInspection
      : selectedInspection && selectedWorkspaceId
        ? (() => {
            detailError =
              appLocale === "zh"
                ? "该检查记录不属于当前工作区。"
                : "This inspection record does not belong to the current workspace.";
            return null;
          })()
        : selectedInspection;
  const linkedUsageEvent = visibleInspection?.usageEventId
    ? await getUsageEvent(visibleInspection.usageEventId).catch((error) => {
        detailError = getUserErrorMessage(
          error,
          appLocale === "zh"
            ? "无法加载关联用量事件。"
            : "Can't load the linked usage event.",
        );
        return null;
      })
    : null;
  const activeSavedView = requestedSavedViewId
    ? (savedViews.find((savedView) => savedView.id === requestedSavedViewId) ??
      null)
    : null;
  const savedViewId = activeSavedView?.id ?? null;
  const persistedViewFilters = {
    workspaceId: selectedWorkspaceId,
    projectId: selectedProjectId,
    environmentId: selectedEnvironmentId,
    provider: selectedProvider,
    providerConnectionId: selectedProviderConnectionId,
    model: selectedModel,
    virtualKeyId: selectedVirtualKeyId,
    requestId: selectedRequestId,
    verdict: selectedVerdict,
    reviewStatus: selectedReviewStatus,
    riskCategory: selectedRiskCategory,
    activityLabel: selectedActivityLabel,
    escalatedOnly: selectedEscalatedOnly ? "true" : null,
    sortBy:
      selectedSortBy !== promptInspectionDefaultSort ? selectedSortBy : null,
    from: selectedFrom,
    to: selectedTo,
  };
  const pageHref = buildPromptInspectionsPageHref({
    ...persistedViewFilters,
    inspectionId: selectedInspectionId,
    savedViewId,
    pageSize: pageSize > 25 ? String(pageSize) : null,
    offset: offset > 0 ? String(offset) : null,
  });
  const redirectPath = buildPromptInspectionsPageHref({
    ...persistedViewFilters,
    inspectionId: selectedInspectionId,
    savedViewId,
    pageSize: pageSize > 25 ? String(pageSize) : null,
    offset: offset > 0 ? String(offset) : null,
  });
  const previousPageHref =
    offset > 0
      ? buildPromptInspectionsPageHref({
          ...persistedViewFilters,
          inspectionId: selectedInspectionId,
          savedViewId,
          pageSize: pageSize > 25 ? String(pageSize) : null,
          offset: String(Math.max(offset - pageSize, 0)),
        })
      : null;
  const nextPageHref =
    inspections.total > offset + inspections.items.length
      ? buildPromptInspectionsPageHref({
          ...persistedViewFilters,
          inspectionId: selectedInspectionId,
          savedViewId,
          pageSize: pageSize > 25 ? String(pageSize) : null,
          offset: String(offset + pageSize),
        })
      : null;
  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(Math.ceil(inspections.total / pageSize), 1);
  const compactPages = buildCompactPageNumbers(currentPage, totalPages);
  const buildDrilldownHref = (
    patch: Record<string, string | null | undefined>,
  ) =>
    buildPromptInspectionsPageHref({
      ...persistedViewFilters,
      ...patch,
      inspectionId: null,
      savedViewId,
      pageSize: pageSize > 25 ? String(pageSize) : null,
      offset: null,
    });
  const buildSortHref = (nextSortBy: PromptInspectionSort) =>
    buildPromptInspectionsPageHref({
      ...persistedViewFilters,
      sortBy: nextSortBy !== promptInspectionDefaultSort ? nextSortBy : null,
      inspectionId: selectedInspectionId,
      savedViewId,
      pageSize: pageSize > 25 ? String(pageSize) : null,
      offset: null,
    });
  const projectById = new Map(
    projects.map((project) => [project.id, project] as const),
  );
  const environmentById = new Map(
    environments.map((environment) => [environment.id, environment] as const),
  );
  const providerConnectionById = new Map(
    providerConnections.map(
      (connection) => [connection.id, connection] as const,
    ),
  );
  const virtualKeyById = new Map(
    virtualKeyOptions.map((virtualKey) => [virtualKey.id, virtualKey] as const),
  );
  const suggestedSavedViewName = [
    appLocale === "zh" ? "内容审查" : "Content review",
    selectedReviewStatus
      ? formatReviewStatus(appLocale, selectedReviewStatus)
      : null,
    selectedVerdict ? formatVerdict(appLocale, selectedVerdict) : null,
    selectedRiskCategory
      ? formatRiskCategory(appLocale, selectedRiskCategory)
      : null,
    selectedProjectId
      ? (projects.find((item) => item.id === selectedProjectId)?.name ??
        selectedProjectId)
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("·");
  const savedViewEntries = savedViews
    .map((savedView) => {
      const filters = savedView.filters as Record<string, unknown>;
      const recentAt = savedView.lastOpenedAt ?? savedView.updatedAt;
      return {
        id: savedView.id,
        label: savedView.name,
        hint: savedView.lastOpenedAt
          ? `${appLocale === "zh" ? "最近打开" : "Opened"} ${new Date(savedView.lastOpenedAt).toLocaleString(appLocale === "zh" ? "zh-CN" : "en-US")}`
          : `${appLocale === "zh" ? "最近更新" : "Updated"} ${new Date(savedView.updatedAt).toLocaleString(appLocale === "zh" ? "zh-CN" : "en-US")}`,
        href: buildPromptInspectionSavedViewOpenHref(
          savedView.id,
          buildPromptInspectionsPageHref({
            workspaceId: selectedWorkspaceId,
            projectId:
              typeof filters.projectId === "string" ? filters.projectId : null,
            environmentId:
              typeof filters.environmentId === "string"
                ? filters.environmentId
                : null,
            provider:
              typeof filters.provider === "string" ? filters.provider : null,
            providerConnectionId:
              typeof filters.providerConnectionId === "string"
                ? filters.providerConnectionId
                : null,
            model: typeof filters.model === "string" ? filters.model : null,
            virtualKeyId:
              typeof filters.virtualKeyId === "string"
                ? filters.virtualKeyId
                : null,
            requestId:
              typeof filters.requestId === "string" ? filters.requestId : null,
            verdict:
              typeof filters.verdict === "string" ? filters.verdict : null,
            reviewStatus:
              typeof filters.reviewStatus === "string"
                ? filters.reviewStatus
                : null,
            riskCategory:
              typeof filters.riskCategory === "string"
                ? filters.riskCategory
                : null,
            activityLabel:
              typeof filters.activityLabel === "string"
                ? filters.activityLabel
                : null,
            escalatedOnly:
              filters.escalatedOnly === true || filters.escalatedOnly === "true"
                ? "true"
                : null,
            sortBy: typeof filters.sortBy === "string" ? filters.sortBy : null,
            from: typeof filters.from === "string" ? filters.from : null,
            to: typeof filters.to === "string" ? filters.to : null,
            savedViewId: savedView.id,
          }),
        ),
        active: savedView.id === savedViewId,
        recentAtMs: new Date(recentAt).getTime(),
        updatedAtMs: new Date(savedView.updatedAt).getTime(),
      };
    })
    .sort(
      (left, right) =>
        right.recentAtMs - left.recentAtMs ||
        right.updatedAtMs - left.updatedAtMs ||
        left.label.localeCompare(right.label),
    )
    .slice(0, 5);
  const savedViewNoticeState: {
    tone: "success" | "error";
    message: string;
  } | null =
    savedViewNotice && savedViewMessage
      ? { tone: savedViewNotice, message: savedViewMessage }
      : null;
  const inspectionTableRows: PromptInspectionTableRow[] = inspections.items.map(
    (inspection) => ({
      id: inspection.id,
      href: buildPromptInspectionsPageHref({
        ...persistedViewFilters,
        pageSize: pageSize > 25 ? String(pageSize) : null,
        inspectionId: inspection.id,
        savedViewId,
      }),
      verdict: inspection.verdict,
      reviewStatus: inspection.reviewStatus,
      createdAtLabel: formatDateTime(appLocale, inspection.createdAt),
      verdictLabel: formatVerdict(appLocale, inspection.verdict),
      reviewStatusLabel: formatReviewStatus(appLocale, inspection.reviewStatus),
      riskLabel:
        inspection.riskCategories
          .map((category) => formatRiskCategory(appLocale, category))
          .join(",") || "n/a",
      activityLabel: formatActivityLabel(
        appLocale,
        inspection.topActivityLabel,
      ),
      providerLabel: inspection.provider ?? "n/a",
      modelLabel: inspection.model ?? "n/a",
      scoreLabel: String(inspection.score),
      requestIdLabel: inspection.requestId,
    }),
  );
  const summaryStripItems = [
    {
      id: "total",
      label: text.summary,
      value: String(summary.total),
      meta: selectedReviewStatus
        ? formatReviewStatus(appLocale, selectedReviewStatus)
        : appLocale === "zh"
          ? "当前范围"
          : "In scope",
    },
    {
      id: "pending",
      label: text.pendingReview,
      value: String(
        summary.reviewStatusBreakdown.find(
          (item) => item.reviewStatus === "pending",
        )?.count ?? 0,
      ),
      href: buildDrilldownHref({ reviewStatus: "pending" }),
      active: selectedReviewStatus === "pending",
      tone: "warning" as const,
    },
    {
      id: "blocked",
      label: text.blocked,
      value: String(
        summary.verdictBreakdown.find((item) => item.verdict === "block")
          ?.count ?? 0,
      ),
      href: buildDrilldownHref({ verdict: "block", reviewStatus: null }),
      active: selectedVerdict === "block",
      tone: "warning" as const,
    },
    {
      id: "escalated",
      label: text.escalated,
      value: String(summary.escalatedCount),
      href: buildDrilldownHref({ escalatedOnly: "true" }),
      active: selectedEscalatedOnly,
      tone: "warning" as const,
    },
  ];
  const sortState: PromptInspectionTableSortState = {
    time: {
      href: buildSortHref(getNextPromptInspectionSort(selectedSortBy, "time")),
      indicator: getPromptInspectionSortIndicator(selectedSortBy, "time"),
    },
    score: {
      href: buildSortHref(getNextPromptInspectionSort(selectedSortBy, "score")),
      indicator: getPromptInspectionSortIndicator(selectedSortBy, "score"),
    },
    verdict: {
      href: buildSortHref(
        getNextPromptInspectionSort(selectedSortBy, "verdict"),
      ),
      indicator: getPromptInspectionSortIndicator(selectedSortBy, "verdict"),
    },
    review: {
      href: buildSortHref(
        getNextPromptInspectionSort(selectedSortBy, "review"),
      ),
      indicator: getPromptInspectionSortIndicator(selectedSortBy, "review"),
    },
    provider: {
      href: buildSortHref(
        getNextPromptInspectionSort(selectedSortBy, "provider"),
      ),
      indicator: getPromptInspectionSortIndicator(selectedSortBy, "provider"),
    },
    model: {
      href: buildSortHref(getNextPromptInspectionSort(selectedSortBy, "model")),
      indicator: getPromptInspectionSortIndicator(selectedSortBy, "model"),
    },
  };
  const selectedProjectLabel = selectedProjectId
    ? (projectById.get(selectedProjectId)?.name ?? selectedProjectId)
    : null;
  const selectedEnvironmentLabel = selectedEnvironmentId
    ? (environmentById.get(selectedEnvironmentId)?.name ??
      selectedEnvironmentId)
    : null;
  const selectedProviderConnectionLabel = selectedProviderConnectionId
    ? (providerConnectionById.get(selectedProviderConnectionId)?.label ??
      selectedProviderConnectionId)
    : null;
  const selectedVirtualKeyLabel = selectedVirtualKeyId
    ? (virtualKeyById.get(selectedVirtualKeyId)?.label ?? selectedVirtualKeyId)
    : null;
  const currentScopeParts = [
    selectedProjectLabel,
    selectedEnvironmentLabel,
    selectedProvider ? `${text.providerLabel} ${selectedProvider}` : null,
    selectedVerdict ? formatVerdict(appLocale, selectedVerdict) : null,
    selectedReviewStatus
      ? formatReviewStatus(appLocale, selectedReviewStatus)
      : null,
    selectedRiskCategory
      ? formatRiskCategory(appLocale, selectedRiskCategory)
      : null,
    selectedActivityLabel
      ? formatActivityLabel(appLocale, selectedActivityLabel)
      : null,
    selectedModel ? `${text.modelLabel} ${selectedModel}` : null,
    selectedRequestId ? `${text.requestIdLabel} ${selectedRequestId}` : null,
    selectedEscalatedOnly ? text.escalatedOnlyLabel : null,
  ].filter((value): value is string => Boolean(value));
  const currentScopeLabel = currentScopeParts.length
    ? currentScopeParts.join("·")
    : selectedReviewStatus === "pending"
      ? text.queueInWorkspace
      : text.allInWorkspace;
  const noWorkspaceDescription =
    appLocale === "zh"
      ? "请使用页头中的全局工作区切换器继续。"
      : "Use the global workspace switcher in the header to continue.";
  const moreFilterCount = [
    selectedActivityLabel,
    selectedProviderConnectionLabel,
    selectedModel,
    selectedVirtualKeyLabel,
    selectedRequestId,
    selectedFrom,
    selectedTo,
    selectedEscalatedOnly ? "true" : null,
  ].filter(Boolean).length;
  const exportHref = `/api/console/prompt-inspections/export?${new URLSearchParams({ workspaceId: selectedWorkspaceId ?? "", ...(selectedProjectId ? { projectId: selectedProjectId } : {}), ...(selectedEnvironmentId ? { environmentId: selectedEnvironmentId } : {}), ...(selectedProvider ? { provider: selectedProvider } : {}), ...(selectedProviderConnectionId ? { providerConnectionId: selectedProviderConnectionId } : {}), ...(selectedModel ? { model: selectedModel } : {}), ...(selectedVirtualKeyId ? { virtualKeyId: selectedVirtualKeyId } : {}), ...(selectedRequestId ? { requestId: selectedRequestId } : {}), ...(selectedVerdict ? { verdict: selectedVerdict } : {}), ...(selectedReviewStatus ? { reviewStatus: selectedReviewStatus } : {}), ...(selectedRiskCategory ? { riskCategory: selectedRiskCategory } : {}), ...(selectedActivityLabel ? { activityLabel: selectedActivityLabel } : {}), ...(selectedEscalatedOnly ? { escalatedOnly: "true" } : {}), ...(selectedSortBy !== promptInspectionDefaultSort ? { sortBy: selectedSortBy } : {}), ...(selectedFrom ? { from: selectedFrom } : {}), ...(selectedTo ? { to: selectedTo } : {}) }).toString()}`;
  const clearFiltersHref = buildPromptInspectionsPageHref({
    workspaceId: selectedWorkspaceId,
  });
  const visibleRangeLabel =
    inspections.total === 0
      ? text.noItems
      : appLocale === "zh"
        ? `显示第 ${offset + 1}-${Math.min(offset + inspections.items.length, inspections.total)} 条，共 ${inspections.total} 条 · 第 ${currentPage} / ${totalPages} 页`
        : `Showing ${offset + 1}-${Math.min(offset + inspections.items.length, inspections.total)} of ${inspections.total} · Page ${currentPage} / ${totalPages}`;
  const policyHref = buildPromptInspectionPolicyHref({
    workspaceId: selectedWorkspaceId,
    returnTo: pageHref,
  });
  const savedViewInputDefaultValue =
    suggestedSavedViewName ||
    (appLocale === "zh" ? "内容审查队列" : "Content review queue");
  const filterSelectClassName =
    "h-[36px] w-full rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] hover:border-[color:var(--border-strong)] focus:border-[color:var(--primary-border-strong)]";
  const verdictToStatus = (value: string) =>
    value === "block"
      ? "critical"
      : value === "review"
        ? "warning"
        : ("active" as const);
  const contextSummaryRows = visibleInspection
    ? summarizeContextCounts(appLocale, visibleInspection.contextCounts)
    : [];
  const hasActiveFilters = Boolean(
    selectedProjectId ||
      selectedEnvironmentId ||
      selectedProvider ||
      selectedProviderConnectionId ||
      selectedModel ||
      selectedVirtualKeyId ||
      selectedRequestId ||
      selectedVerdict ||
      selectedReviewStatus ||
      selectedRiskCategory ||
      selectedActivityLabel ||
      selectedEscalatedOnly ||
      selectedFrom ||
      selectedTo,
  );
  const savedViewsSummary =
    activeSavedView?.name ??
    (savedViewEntries.length ? text.savedViewsDescription : text.noSavedViews);
  const relationshipModel = visibleInspection
    ? buildPromptInspectionRelationshipModel({
        locale: appLocale,
        inspection: visibleInspection,
        linkedUsageEvent,
        projectName:
          projectById.get(visibleInspection.projectId ?? "")?.name ?? null,
        environmentName:
          environmentById.get(visibleInspection.environmentId ?? "")?.name ??
          null,
        environmentRuntime:
          environmentById.get(visibleInspection.environmentId ?? "")?.runtime ??
          null,
        virtualKeyLabel:
          virtualKeyById.get(visibleInspection.virtualKeyId ?? "")?.label ??
          null,
        providerConnectionLabel:
          providerConnectionById.get(
            visibleInspection.providerConnectionId ?? "",
          )?.label ?? null,
        returnTo: pageHref,
      })
    : null;
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
            <section className="space-y-4 rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-canvas)_8%)] p-4 backdrop-blur-sm">
              {" "}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
                {" "}
                <div className="space-y-1">
                  {" "}
                  <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
                    {text.summary}
                  </h2>{" "}
                  <p className="text-[12.5px] font-medium text-muted-foreground">
                    {currentScopeLabel}
                  </p>{" "}
                </div>{" "}
                <div className="flex items-center gap-2">
                  {" "}
                  {canManagePromptPolicy ? (
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-8 border-border/40 bg-background/50 hover:bg-muted"
                    >
                      <Link href={policyHref}>{text.openPolicy}</Link>
                    </Button>
                  ) : null}{" "}
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 border-border/40 bg-background/50 hover:bg-muted"
                  >
                    <Link href={exportHref}>{text.exportCsv}</Link>
                  </Button>{" "}
                </div>{" "}
              </div>{" "}
              <form
                action="/prompt-inspections"
                className="space-y-4"
                method="get"
              >
                {" "}
                <input
                  name="workspaceId"
                  type="hidden"
                  value={selectedWorkspaceId}
                />{" "}
                {savedViewId ? (
                  <input name="savedViewId" type="hidden" value={savedViewId} />
                ) : null}{" "}
                {pageSize > 25 ? (
                  <input
                    name="pageSize"
                    type="hidden"
                    value={String(pageSize)}
                  />
                ) : null}{" "}
                {selectedSortBy !== promptInspectionDefaultSort ? (
                  <input name="sortBy" type="hidden" value={selectedSortBy} />
                ) : null}{" "}
                <div className="flex items-center gap-3 bg-background/50 border border-border/40 rounded-xl px-4 py-2 focus-within:border-primary/40 transition-all">
                  {" "}
                  <label
                    className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap"
                    htmlFor="requestId"
                  >
                    {" "}
                    {text.requestIdLabel}{" "}
                  </label>{" "}
                  <input
                    className="flex-1 bg-transparent border-none p-0 text-[15px] focus:ring-0 placeholder:text-muted-foreground/50"
                    defaultValue={selectedRequestId ?? ""}
                    id="requestId"
                    name="requestId"
                    placeholder={text.requestIdPlaceholder}
                    type="search"
                  />{" "}
                  <Button size="sm" type="submit" className="h-8 rounded-lg">
                    {" "}
                    {text.applyFilters}{" "}
                  </Button>{" "}
                </div>{" "}
                <div className="flex flex-wrap items-center gap-4">
                  {" "}
                  <div className="flex items-center gap-2 bg-background/40 border border-border/30 rounded-lg px-2.5 py-1.5 focus-within:bg-background/80 transition-all">
                    {" "}
                    <label
                      className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                      htmlFor="projectId"
                    >
                      {" "}
                      {text.filterByProject}{" "}
                    </label>{" "}
                    <select
                      className="bg-transparent border-none p-0 text-[13px] focus:ring-0 h-auto cursor-pointer max-w-[140px]"
                      defaultValue={selectedProjectId ?? ""}
                      id="projectId"
                      name="projectId"
                    >
                      {" "}
                      <option value="">
                        {appLocale === "zh" ? "全部" : "All"}
                      </option>{" "}
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}{" "}
                    </select>{" "}
                  </div>{" "}
                  <div className="flex items-center gap-2 bg-background/40 border border-border/30 rounded-lg px-2.5 py-1.5 focus-within:bg-background/80 transition-all">
                    {" "}
                    <label
                      className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                      htmlFor="verdict"
                    >
                      {" "}
                      {text.filterByVerdict}{" "}
                    </label>{" "}
                    <select
                      className="bg-transparent border-none p-0 text-[13px] focus:ring-0 h-auto cursor-pointer"
                      defaultValue={selectedVerdict ?? ""}
                      id="verdict"
                      name="verdict"
                    >
                      {" "}
                      <option value="">
                        {appLocale === "zh" ? "全部" : "All"}
                      </option>{" "}
                      {verdictOptions.map((value) => (
                        <option key={value} value={value}>
                          {formatVerdict(appLocale, value)}
                        </option>
                      ))}{" "}
                    </select>{" "}
                  </div>{" "}
                  <div className="flex items-center gap-2 bg-background/40 border border-border/30 rounded-lg px-2.5 py-1.5 focus-within:bg-background/80 transition-all">
                    {" "}
                    <label
                      className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                      htmlFor="reviewStatus"
                    >
                      {" "}
                      {text.filterByReviewStatus}{" "}
                    </label>{" "}
                    <select
                      className="bg-transparent border-none p-0 text-[13px] focus:ring-0 h-auto cursor-pointer"
                      defaultValue={selectedReviewStatus ?? ""}
                      id="reviewStatus"
                      name="reviewStatus"
                    >
                      {" "}
                      <option value="">
                        {appLocale === "zh" ? "全部" : "All"}
                      </option>{" "}
                      {reviewStatusOptions.map((value) => (
                        <option key={value} value={value}>
                          {formatReviewStatus(appLocale, value)}
                        </option>
                      ))}{" "}
                    </select>{" "}
                  </div>{" "}
                  <details className="relative group">
                    {" "}
                    <summary className="flex h-8 items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:bg-muted hover:text-foreground transition-all list-none">
                      {" "}
                      <span>{text.moreFilters}</span>{" "}
                      {moreFilterCount > 0 ? (
                        <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
                          {" "}
                          {moreFilterCount}{" "}
                        </span>
                      ) : null}{" "}
                    </summary>{" "}
                    <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-xl border border-border bg-card p-4 shadow-none animate-in fade-in zoom-in duration-200">
                      {" "}
                      <div className="grid gap-4">
                        {" "}
                        <div className="grid gap-1.5">
                          {" "}
                          <label
                            className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                            htmlFor="riskCategory"
                          >
                            {" "}
                            {text.filterByRiskCategory}{" "}
                          </label>{" "}
                          <select
                            className={filterSelectClassName}
                            defaultValue={selectedRiskCategory ?? ""}
                            id="riskCategory"
                            name="riskCategory"
                          >
                            {" "}
                            <option value="">
                              {appLocale === "zh"
                                ? "全部风险类型"
                                : "All risk categories"}
                            </option>{" "}
                            {riskOptions.map((value) => (
                              <option key={value} value={value}>
                                {formatRiskCategory(appLocale, value)}
                              </option>
                            ))}{" "}
                          </select>{" "}
                        </div>{" "}
                        <div className="grid gap-1.5">
                          {" "}
                          <label
                            className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                            htmlFor="environmentId"
                          >
                            {" "}
                            {text.filterByEnvironment}{" "}
                          </label>{" "}
                          <select
                            className={filterSelectClassName}
                            defaultValue={selectedEnvironmentId ?? ""}
                            id="environmentId"
                            name="environmentId"
                          >
                            {" "}
                            <option value="">
                              {appLocale === "zh"
                                ? "全部环境"
                                : "All environments"}
                            </option>{" "}
                            {environments.map((environment) => (
                              <option
                                key={environment.id}
                                value={environment.id}
                              >
                                {environment.name}
                              </option>
                            ))}{" "}
                          </select>{" "}
                        </div>{" "}
                        <div className="grid gap-1.5">
                          {" "}
                          <label
                            className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                            htmlFor="model"
                          >
                            {" "}
                            {text.modelLabel}{" "}
                          </label>{" "}
                          <Input
                            className="h-9 text-[13px]"
                            defaultValue={selectedModel ?? ""}
                            id="model"
                            name="model"
                            placeholder={text.modelLabel}
                          />{" "}
                        </div>{" "}
                        <div className="grid grid-cols-2 gap-3">
                          {" "}
                          <div className="grid gap-1.5">
                            {" "}
                            <label
                              className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                              htmlFor="from"
                            >
                              {" "}
                              {text.fromLabel}{" "}
                            </label>{" "}
                            <input
                              className="h-9 w-full rounded-md border border-border/60 bg-muted px-2 text-[11px]"
                              defaultValue={selectedFrom ?? ""}
                              id="from"
                              name="from"
                              type="datetime-local"
                            />{" "}
                          </div>{" "}
                          <div className="grid gap-1.5">
                            {" "}
                            <label
                              className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                              htmlFor="to"
                            >
                              {" "}
                              {text.toLabel}{" "}
                            </label>{" "}
                            <input
                              className="h-9 w-full rounded-md border border-border/60 bg-muted px-2 text-[11px]"
                              defaultValue={selectedTo ?? ""}
                              id="to"
                              name="to"
                              type="datetime-local"
                            />{" "}
                          </div>{" "}
                        </div>{" "}
                        <label className="flex items-center gap-2 cursor-pointer pt-1">
                          {" "}
                          <input
                            className="rounded border-border/60 accent-primary"
                            defaultChecked={selectedEscalatedOnly}
                            name="escalatedOnly"
                            type="checkbox"
                            value="true"
                          />{" "}
                          <span className="text-[12px] font-medium text-foreground">
                            {text.escalatedOnlyLabel}
                          </span>{" "}
                        </label>{" "}
                        <Button className="mt-2" size="sm" type="submit">
                          {" "}
                          {text.applyFilters}{" "}
                        </Button>{" "}
                      </div>{" "}
                    </div>{" "}
                  </details>{" "}
                  <div className="ml-auto flex items-center gap-2">
                    {" "}
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Link href={clearFiltersHref}>{text.reset}</Link>
                    </Button>{" "}
                  </div>{" "}
                </div>{" "}
              </form>{" "}
            </section>{" "}
            {notice && noticeMessage ? (
              <ResourceInlineNotice
                label={
                  notice === "error"
                    ? appLocale === "zh"
                      ? "错误"
                      : "Error"
                    : appLocale === "zh"
                      ? "已保存"
                      : "Saved"
                }
                message={noticeMessage}
                tone={notice === "error" ? "error" : "success"}
              />
            ) : null}{" "}
            {inspectionsError || summaryError || detailError ? (
              <div className="space-y-2">
                {" "}
                {inspectionsError ? (
                  <ResourceInlineNotice
                    label={appLocale === "zh" ? "错误" : "Error"}
                    message={inspectionsError}
                    tone="error"
                  />
                ) : null}{" "}
                {summaryError ? (
                  <ResourceInlineNotice
                    label={appLocale === "zh" ? "错误" : "Error"}
                    message={summaryError}
                    tone="error"
                  />
                ) : null}{" "}
                {detailError ? (
                  <ResourceInlineNotice
                    label={appLocale === "zh" ? "错误" : "Error"}
                    message={detailError}
                    tone="error"
                  />
                ) : null}{" "}
              </div>
            ) : null}{" "}
            <div
              className={
                visibleInspection
                  ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start"
                  : "space-y-4"
              }
            >
              {" "}
              <section className="min-w-0 space-y-4">
                {" "}
                <ResourceSummaryStrip items={summaryStripItems} />{" "}
                <section className="rounded-xl border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-3">
                  {" "}
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    {" "}
                    <div className="min-w-0 space-y-0.5">
                      {" "}
                      <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">
                        {" "}
                        {text.savedViewsTitle}{" "}
                      </h2>{" "}
                      <p className="text-[12px] text-muted-foreground">
                        {" "}
                        {activeSavedView
                          ? `${text.activeSavedView} · ${savedViewsSummary}`
                          : savedViewsSummary}{" "}
                      </p>{" "}
                    </div>{" "}
                    {!savedViewsIssue ? (
                      <form
                        action={createSavedViewAction}
                        className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
                      >
                        {" "}
                        <input
                          name="workspaceId"
                          type="hidden"
                          value={selectedWorkspaceId ?? ""}
                        />{" "}
                        <input
                          name="surface"
                          type="hidden"
                          value="prompt-inspections"
                        />{" "}
                        <input
                          name="redirectPath"
                          type="hidden"
                          value={redirectPath}
                        />{" "}
                        <input
                          name="filtersJson"
                          type="hidden"
                          value={JSON.stringify(persistedViewFilters)}
                        />{" "}
                        <Input
                          className="h-9 w-full sm:w-[240px]"
                          defaultValue={savedViewInputDefaultValue}
                          name="name"
                          placeholder={text.savedViewsTitle}
                        />{" "}
                        <Button
                          className="h-9 shrink-0"
                          size="sm"
                          type="submit"
                          variant="outline"
                        >
                          {" "}
                          {text.saveCurrentView}{" "}
                        </Button>{" "}
                      </form>
                    ) : null}{" "}
                  </div>{" "}
                  {savedViewNoticeState ? (
                    <div className="mt-3">
                      {" "}
                      <ResourceInlineNotice
                        label={
                          savedViewNoticeState.tone === "error"
                            ? appLocale === "zh"
                              ? "错误"
                              : "Error"
                            : appLocale === "zh"
                              ? "已保存"
                              : "Saved"
                        }
                        message={savedViewNoticeState.message}
                        tone={savedViewNoticeState.tone}
                      />{" "}
                    </div>
                  ) : null}{" "}
                  {savedViewsIssue ? (
                    <div className="mt-3">
                      {" "}
                      <ResourceInlineNotice
                        label={appLocale === "zh" ? "错误" : "Error"}
                        message={savedViewsIssue.message}
                        tone="error"
                      />{" "}
                    </div>
                  ) : null}{" "}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {" "}
                    {savedViewEntries.length ? (
                      savedViewEntries.map((view) => (
                        <Link
                          aria-current={view.active ? "page" : undefined}
                          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${view.active ? "border-border/70 bg-[color:color-mix(in_srgb,var(--surface-selected)_14%,var(--surface-1)_86%)] font-medium text-foreground" : "border-border/60 bg-background text-muted-foreground hover:border-border/80 hover:text-foreground"}`}
                          href={view.href}
                          key={view.id}
                        >
                          {" "}
                          <span>{view.label}</span>{" "}
                        </Link>
                      ))
                    ) : null}{" "}
                  </div>{" "}
                </section>{" "}
                <ResourceTableSection
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      {" "}
                      <span className="text-sm text-muted-foreground">
                        {text.pageSizeLabel}
                      </span>{" "}
                      {pageSizeOptions.map((size) => {
                        const sizeHref = buildPromptInspectionsPageHref({
                          ...persistedViewFilters,
                          inspectionId: selectedInspectionId,
                          savedViewId,
                          pageSize: size > 25 ? String(size) : null,
                        });
                        return (
                          <Button
                            asChild={size !== pageSize}
                            key={size}
                            size="sm"
                            variant={size === pageSize ? "default" : "outline"}
                          >
                            {size === pageSize ? (
                              <span
                                data-testid={`prompt-inspections-page-size-${size}`}
                              >
                                {size}
                              </span>
                            ) : (
                              <Link
                                data-testid={`prompt-inspections-page-size-${size}`}
                                href={sizeHref}
                              >
                                {size}
                              </Link>
                            )}
                          </Button>
                        );
                      })}{" "}
                    </div>
                  }
                  className="overflow-hidden"
                  contentClassName="space-y-0"
                  meta={
                    <div className="space-y-0.5">
                      {" "}
                      <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">
                        {" "}
                        {text.records}{" "}
                      </h2>{" "}
                      <p className="text-[12px] text-muted-foreground">
                        {visibleRangeLabel}
                      </p>{" "}
                    </div>
                  }
                  >
                  {" "}
                  <div className="overflow-x-auto">
                    {" "}
                    {inspections.items.length ? (
                      <PromptInspectionsTable
                        activeInspectionId={visibleInspection?.id ?? null}
                        appLocale={appLocale}
                        redirectPath={redirectPath}
                        rows={inspectionTableRows}
                        sortState={sortState}
                        workspaceId={selectedWorkspaceId ?? ""}
                      />
                    ) : (
                      <div className="flex min-h-[160px] flex-col justify-center gap-3 px-5 py-7 sm:flex-row sm:items-center sm:justify-between">
                        {" "}
                        <div className="space-y-1">
                          {" "}
                          <p className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">
                            {text.records}
                          </p>{" "}
                          <p className="max-w-[42rem] text-[13px] text-muted-foreground">
                            {text.noItems}
                          </p>{" "}
                        </div>{" "}
                        {hasActiveFilters ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={clearFiltersHref}>{text.reset}</Link>
                          </Button>
                        ) : null}{" "}
                      </div>
                    )}{" "}
                  </div>{" "}
                  {inspections.total > pageSize ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
                      {" "}
                      {previousPageHref ? (
                        <Button asChild size="sm" variant="outline">
                          <Link
                            data-testid="prompt-inspections-page-previous"
                            href={previousPageHref}
                          >
                            {appLocale === "zh" ? "上一页" : "Previous"}
                          </Link>
                        </Button>
                      ) : null}{" "}
                      {compactPages.map((pageNumber, index) => {
                        const previousVisible = compactPages[index - 1];
                        const needsGap =
                          previousVisible !== undefined &&
                          pageNumber - previousVisible > 1;
                        const pageLinkHref = buildPromptInspectionsPageHref({
                          ...persistedViewFilters,
                          inspectionId: selectedInspectionId,
                          savedViewId,
                          pageSize: pageSize > 25 ? String(pageSize) : null,
                          offset:
                            pageNumber === 1
                              ? null
                              : String((pageNumber - 1) * pageSize),
                        });
                        return (
                          <span
                            key={pageNumber}
                            className="inline-flex items-center gap-2"
                          >
                            {" "}
                            {needsGap ? (
                              <span className="px-1 text-sm text-muted-foreground">
                                …
                              </span>
                            ) : null}{" "}
                            <Button
                              asChild={pageNumber !== currentPage}
                              size="sm"
                              variant={
                                pageNumber === currentPage
                                  ? "default"
                                  : "outline"
                              }
                            >
                              {pageNumber === currentPage ? (
                                <span
                                  data-testid={`prompt-inspections-page-link-${pageNumber}`}
                                >
                                  {pageNumber}
                                </span>
                              ) : (
                                <Link
                                  data-testid={`prompt-inspections-page-link-${pageNumber}`}
                                  href={pageLinkHref}
                                >
                                  {pageNumber}
                                </Link>
                              )}
                            </Button>{" "}
                          </span>
                        );
                      })}{" "}
                      {nextPageHref ? (
                        <Button asChild size="sm" variant="outline">
                          <Link
                            data-testid="prompt-inspections-page-next"
                            href={nextPageHref}
                          >
                            {appLocale === "zh" ? "下一页" : "Next"}
                          </Link>
                        </Button>
                      ) : null}{" "}
                    </div>
                  ) : null}{" "}
                </ResourceTableSection>{" "}
              </section>{" "}
              {visibleInspection ? (
                <section className="space-y-4 xl:sticky xl:top-6">
                  {" "}
                  <Card className="overflow-hidden border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)]">
                    {" "}
                    <CardHeader className="pb-3">
                      {" "}
                      <div className="flex items-start justify-between gap-3">
                        {" "}
                        <div className="space-y-0.5">
                          {" "}
                          <h2 className="text-sm font-semibold text-foreground">
                            {text.recordDetail}
                          </h2>{" "}
                          <p className="text-sm text-muted-foreground">
                            {" "}
                            {visibleInspection.requestId} ·{" "}
                            {formatDateTime(
                              appLocale,
                              visibleInspection.createdAt,
                            )}{" "}
                          </p>{" "}
                        </div>{" "}
                        {linkedUsageEvent ? (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              href={buildUsageEventHref(
                                linkedUsageEvent.id,
                                pageHref,
                              )}
                            >
                              {text.openUsage}
                            </Link>
                          </Button>
                        ) : null}{" "}
                      </div>{" "}
                    </CardHeader>{" "}
                    <CardContent className="space-y-4">
                      {" "}
                      <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_62%,var(--surface-1)_38%)] px-3 py-3">
                        {" "}
                        <div className="space-y-1.5">
                          {" "}
                          <StatusBadge
                            status={verdictToStatus(visibleInspection.verdict)}
                          >
                            {" "}
                            {formatVerdict(
                              appLocale,
                              visibleInspection.verdict,
                            )}{" "}
                          </StatusBadge>{" "}
                          <div className="flex flex-wrap gap-2">
                            {" "}
                            {visibleInspection.riskCategories.length ? (
                              visibleInspection.riskCategories.map(
                                (riskCategory) => (
                                  <span
                                    className="inline-flex items-center rounded-full border border-border/60 bg-background px-2.5 py-1 text-[12px] text-foreground"
                                    key={riskCategory}
                                  >
                                    {" "}
                                    {formatRiskCategory(
                                      appLocale,
                                      riskCategory,
                                    )}{" "}
                                  </span>
                                ),
                              )
                            ) : (
                              <span className="text-[12px] text-muted-foreground">
                                n/a
                              </span>
                            )}{" "}
                          </div>{" "}
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {" "}
                            {visibleInspection.requestId}{" "}
                          </p>{" "}
                        </div>{" "}
                        <span
                          className={
                            visibleInspection.score >= 70
                              ? "text-[1.15rem] font-bold tabular-nums text-[color:var(--destructive-strong)]"
                              : visibleInspection.score >= 40
                                ? "text-[1.15rem] font-bold tabular-nums text-[color:var(--warning-strong)]"
                                : "text-[1.15rem] font-semibold tabular-nums text-muted-foreground"
                          }
                        >
                          {" "}
                          {visibleInspection.score}{" "}
                        </span>{" "}
                      </div>{" "}
                      <div className="grid gap-2 text-[12.5px]">
                        {" "}
                        {[
                          [
                            text.filterByActivity,
                            formatActivityLabel(
                              appLocale,
                              visibleInspection.topActivityLabel,
                            ),
                          ],
                          [
                            text.providerLabel,
                            visibleInspection.provider ?? "n/a",
                          ],
                          [text.modelLabel, visibleInspection.model ?? "n/a"],
                        ].map(([label, value]) => (
                          <div
                            className="flex items-start justify-between gap-4"
                            key={label}
                          >
                            {" "}
                            <span className="shrink-0 text-muted-foreground">
                              {label}
                            </span>{" "}
                            <span className="min-w-0 break-all text-right font-medium text-foreground">
                              {value}
                            </span>{" "}
                          </div>
                        ))}{" "}
                        <div className="flex items-center justify-between gap-4">
                          {" "}
                          <span className="shrink-0 text-muted-foreground">
                            {text.filterByReviewStatus}
                          </span>{" "}
                          <StatusBadge
                            status={
                              visibleInspection.reviewStatus ===
                              "confirmed_violation"
                                ? "critical"
                                : visibleInspection.reviewStatus ===
                                    "confirmed_benign"
                                  ? "active"
                                  : visibleInspection.reviewStatus ===
                                      "needs_followup"
                                    ? "scoped"
                                    : "warning"
                            }
                          >
                            {" "}
                            {formatReviewStatus(
                              appLocale,
                              visibleInspection.reviewStatus,
                            )}{" "}
                          </StatusBadge>{" "}
                        </div>{" "}
                        <p className="text-[12px] text-muted-foreground">
                          {" "}
                          {visibleInspection.reviewedAt
                            ? `${visibleInspection.reviewedBy ?? "operator"} · ${formatDateTime(appLocale, visibleInspection.reviewedAt)}`
                            : text.reviewMetaPending}{" "}
                        </p>{" "}
                      </div>{" "}
                      <div className="space-y-2">
                        {" "}
                        <div className="space-y-0.5">
                          {" "}
                          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                            {" "}
                            {text.relationshipsTitle}{" "}
                          </p>{" "}
                          <p className="text-[12px] text-muted-foreground">
                            {text.relationshipsDescription}
                          </p>{" "}
                        </div>{" "}
                        {relationshipModel && relationshipModel.nodes.length ? (
                          <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-3 py-3">
                            {" "}
                            <div className="rounded-lg border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_54%,var(--surface-1)_46%)] px-3 py-3">
                              {" "}
                              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                {" "}
                                {relationshipModel.center.relationLabel}{" "}
                              </p>{" "}
                              <div className="mt-1.5 space-y-1">
                                {" "}
                                <p className="text-sm font-medium text-foreground">
                                  {relationshipModel.center.title}
                                </p>{" "}
                                <p className="font-mono text-[12px] text-foreground">
                                  {relationshipModel.center.value}
                                </p>{" "}
                                {relationshipModel.center.meta ? (
                                  <p className="text-[12px] text-muted-foreground">
                                    {relationshipModel.center.meta}
                                  </p>
                                ) : null}{" "}
                              </div>{" "}
                            </div>{" "}
                            <div className="ml-3 mt-3 border-l border-dashed border-border/60 pl-4">
                              {" "}
                              <div className="grid gap-3 sm:grid-cols-2">
                                {" "}
                                {relationshipModel.nodes.map((node) => (
                                  <div
                                    className="rounded-lg border border-border/60 bg-background px-3 py-3"
                                    key={node.kind}
                                  >
                                    {" "}
                                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                      {" "}
                                      {node.relationLabel}{" "}
                                    </p>{" "}
                                    <div className="mt-1.5 space-y-1">
                                      {" "}
                                      <p className="text-sm font-medium text-foreground">
                                        {node.title}
                                      </p>{" "}
                                      <p className="break-all text-[13px] text-foreground">
                                        {node.value}
                                      </p>{" "}
                                      {node.meta ? (
                                        <p className="text-[12px] text-muted-foreground">
                                          {node.meta}
                                        </p>
                                      ) : null}{" "}
                                    </div>{" "}
                                    {node.href && node.actionLabel ? (
                                      <div className="mt-3">
                                        {" "}
                                        <Button
                                          asChild
                                          size="sm"
                                          variant="outline"
                                        >
                                          {" "}
                                          <Link href={node.href}>
                                            {node.actionLabel}
                                          </Link>{" "}
                                        </Button>{" "}
                                      </div>
                                    ) : null}{" "}
                                  </div>
                                ))}{" "}
                              </div>{" "}
                            </div>{" "}
                          </div>
                        ) : (
                          <p className="rounded-md border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_56%,var(--surface-1)_44%)] px-3 py-2 text-sm text-muted-foreground">
                            {" "}
                            {text.noRelationships}{" "}
                          </p>
                        )}{" "}
                      </div>{" "}
                        <div className="space-y-2">
                          {" "}
                          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                            {" "}
                            {text.redactedEvidence}{" "}
                          </p>{" "}
                          {visibleInspection.truncated ? (
                            <p className="text-[12px] text-muted-foreground">
                              {text.evidenceTruncated}
                            </p>
                          ) : null}{" "}
                          {visibleInspection.redactedEvidence.length ? (
                            <ul className="space-y-2 text-sm text-foreground">
                              {" "}
                              {visibleInspection.redactedEvidence.map(
                                (item) => (
                                  <li
                                    className="rounded-md border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_56%,var(--surface-1)_44%)] px-3 py-2"
                                    key={item}
                                  >
                                    {" "}
                                    {item}{" "}
                                  </li>
                                ),
                              )}{" "}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {" "}
                              {text.noEvidence}{" "}
                            </p>
                          )}{" "}
                        </div>{" "}
                        <div className="space-y-2">
                          {" "}
                          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                            {" "}
                            {text.hitRules}{" "}
                          </p>{" "}
                          <div className="flex flex-wrap gap-2">
                            {" "}
                            {visibleInspection.hitRuleIds.length ? (
                              visibleInspection.hitRuleIds.map((ruleId) => (
                                <span
                                  className="inline-flex items-center rounded-full border border-border/60 bg-background px-2.5 py-1 text-[12px] text-foreground"
                                  key={ruleId}
                                >
                                  {" "}
                                  {formatRuleId(ruleId)}{" "}
                                </span>
                              ))
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                n/a
                              </p>
                            )}{" "}
                          </div>{" "}
                        </div>{" "}
                        <div className="space-y-2">
                          {" "}
                          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                            {" "}
                            {text.contextSummary}{" "}
                          </p>{" "}
                          {contextSummaryRows.length ? (
                            <div className="grid gap-2 text-[12.5px]">
                              {" "}
                              {contextSummaryRows.map((row) => (
                                <div
                                  className="flex items-start justify-between gap-4"
                                  key={row.key}
                                >
                                  {" "}
                                  <span className="shrink-0 text-muted-foreground">
                                    {row.label}
                                  </span>{" "}
                                  <span className="min-w-0 break-all text-right font-medium text-foreground">
                                    {row.value}
                                  </span>{" "}
                                </div>
                              ))}{" "}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {text.noContext}
                            </p>
                          )}{" "}
                          <details className="rounded-lg border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_56%,var(--surface-1)_44%)]">
                            {" "}
                            <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-foreground">
                              {" "}
                              {text.rawContext}{" "}
                            </summary>{" "}
                            <div className="border-t border-border/60 px-3 py-3">
                              {" "}
                              <pre className="overflow-x-auto text-xs text-foreground">
                                {" "}
                                {JSON.stringify(
                                  visibleInspection.contextCounts,
                                  null,
                                  2,
                                )}{" "}
                              </pre>{" "}
                            </div>{" "}
                          </details>{" "}
                        </div>{" "}
                        <div className="space-y-2">
                          {" "}
                          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                            {" "}
                            {text.reviewNoteLabel}{" "}
                          </p>{" "}
                          <p className="rounded-md border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_56%,var(--surface-1)_44%)] px-3 py-2 text-sm text-foreground">
                            {" "}
                            {visibleInspection.reviewNote?.trim() ||
                              text.noReviewNote}{" "}
                          </p>{" "}
                        </div>{" "}
                        {canReviewPromptInspections ? (
                          <div className="space-y-2 rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-3 py-3">
                            {" "}
                            <div className="space-y-0.5">
                              {" "}
                              <p className="text-sm font-medium text-foreground">
                                {text.reviewActionsTitle}
                              </p>{" "}
                              <p className="text-[12px] text-muted-foreground">
                                {text.reviewActionsDescription}
                              </p>{" "}
                            </div>{" "}
                            <form
                              action={reviewPromptInspectionAction}
                              className="flex flex-wrap gap-2"
                            >
                              {" "}
                              <input
                                name="promptInspectionId"
                                type="hidden"
                                value={visibleInspection.id}
                              />{" "}
                              <input
                                name="workspaceId"
                                type="hidden"
                                value={selectedWorkspaceId ?? ""}
                              />{" "}
                              <input
                                name="redirectTo"
                                type="hidden"
                                value={redirectPath}
                              />{" "}
                              <textarea
                                className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                name="reviewNote"
                                placeholder={text.reviewNoteLabel}
                              />{" "}
                              <Button
                                name="reviewStatus"
                                size="sm"
                                type="submit"
                                value="confirmed_violation"
                              >
                                {" "}
                                {text.confirmViolation}{" "}
                              </Button>{" "}
                              <Button
                                name="reviewStatus"
                                size="sm"
                                type="submit"
                                value="confirmed_benign"
                                variant="outline"
                              >
                                {" "}
                                {text.confirmBenign}{" "}
                              </Button>{" "}
                              <Button
                                name="reviewStatus"
                                size="sm"
                                type="submit"
                                value="needs_followup"
                                variant="outline"
                              >
                                {" "}
                                {text.needsFollowUp}{" "}
                              </Button>{" "}
                            </form>{" "}
                          </div>
                        ) : (
                          <p className="rounded-md border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_56%,var(--surface-1)_44%)] px-3 py-2 text-sm text-muted-foreground">
                            {" "}
                            {text.reviewActionsUnavailable}{" "}
                          </p>
                        )}{" "}
                    </CardContent>{" "}
                  </Card>{" "}
                </section>
              ) : null}{" "}
            </div>{" "}
          </>
        ) : null}{" "}
      </section>{" "}
    </AppShell>
  );
}
