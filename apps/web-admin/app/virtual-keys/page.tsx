import { AppShell } from "../components/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { loadVirtualKeysPageData } from "../lib/control-api";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import enVirtualKeysMessages from "../messages/en/virtualKeys.json";
import zhVirtualKeysMessages from "../messages/zh/virtualKeys.json";
import { getCurrentLocale } from "../lib/i18n-server";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import { VirtualKeysWorkspaceView } from "./virtual-keys-workspace-view";

export const dynamic = "force-dynamic";

const defaultPageSize = 50;

type VirtualKeysPageProps = {
  searchParams?: Promise<{
    workspaceId?: string;
    offset?: string;
    q?: string;
    status?: string;
    binding?: string;
    risk?: string;
    issuance?: string;
    returnTo?: string;
  }>;
};

type VirtualKeyStatusFilter = "all" | "active" | "expired" | "revoked" | "unused" | "expiring_soon";
type VirtualKeyBindingFilter = "all" | "workspace" | "project" | "environment";
type VirtualKeyRiskFilter = "all" | "expiring_soon" | "never_used" | "dormant_wide_access" | "workspace_wide_active";
type VirtualKeyIssuanceFilter = "all" | "self_serve" | "admin";


function resolveVirtualKeysMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  const nested = key.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" && part in (current as Record<string, unknown>)
      ? (current as Record<string, unknown>)[part]
      : null, messages);
  return typeof nested === "string" ? nested : null;
}

function createVirtualKeysTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhVirtualKeysMessages : enVirtualKeysMessages) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    const template = resolveVirtualKeysMessage(messages, key);
    if (!template) return translateInlineText(locale, key);
    return template.replace(/\{(\w+)\}/g, (_, token) => String(values?.[token] ?? `{${token}}`));
  };
}

function parseOffset(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseStatusFilter(value: string | undefined): VirtualKeyStatusFilter {
  return value === "active" ||
    value === "expired" ||
    value === "revoked" ||
    value === "unused" ||
    value === "expiring_soon"
    ? value
    : "all";
}

function parseBindingFilter(value: string | undefined): VirtualKeyBindingFilter {
  return value === "workspace" || value === "project" || value === "environment" ? value : "all";
}

function parseRiskFilter(value: string | undefined): VirtualKeyRiskFilter {
  return value === "expiring_soon" ||
    value === "never_used" ||
    value === "dormant_wide_access" ||
    value === "workspace_wide_active"
    ? value
    : "all";
}

function parseIssuanceFilter(value: string | undefined): VirtualKeyIssuanceFilter {
  return value === "self_serve" || value === "admin" ? value : "all";
}

function buildVirtualKeysInventoryHref(args: {
  workspaceId?: string | null;
  offset?: number;
  q?: string | null;
  status?: VirtualKeyStatusFilter;
  binding?: VirtualKeyBindingFilter;
  risk?: VirtualKeyRiskFilter;
  issuance?: VirtualKeyIssuanceFilter;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();

  if (args.workspaceId) {
    params.set("workspaceId", args.workspaceId);
  }

  if ((args.offset ?? 0) > 0) {
    params.set("offset", String(args.offset));
  }

  if (args.q?.trim()) {
    params.set("q", args.q.trim());
  }

  if (args.status && args.status !== "all") {
    params.set("status", args.status);
  }

  if (args.binding && args.binding !== "all") {
    params.set("binding", args.binding);
  }

  if (args.risk && args.risk !== "all") {
    params.set("risk", args.risk);
  }

  if (args.issuance && args.issuance !== "all") {
    params.set("issuance", args.issuance);
  }

  return buildContextualHref(params.toString() ? `/virtual-keys?${params.toString()}` : "/virtual-keys", args.returnTo);
}

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

export default async function VirtualKeysPage({ searchParams }: VirtualKeysPageProps) {
  const locale = await getCurrentLocale();
  const tr = createVirtualKeysTranslator(locale);
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = getSafeReturnTo(resolvedSearchParams.returnTo);
  const searchQuery = resolvedSearchParams.q?.trim() ?? "";
  const statusFilter = parseStatusFilter(resolvedSearchParams.status);
  const bindingFilter = parseBindingFilter(resolvedSearchParams.binding);
  const riskFilter = parseRiskFilter(resolvedSearchParams.risk);
  const issuanceFilter = parseIssuanceFilter(resolvedSearchParams.issuance);
  const pageData = await loadVirtualKeysPageData(resolvedSearchParams.workspaceId, {
    limit: defaultPageSize,
    offset: parseOffset(resolvedSearchParams.offset),
  });
  const selectedWorkspace =
    pageData.selectedWorkspaceId
      ? pageData.workspaceOptions.find((workspace) => workspace.id === pageData.selectedWorkspaceId) ?? null
      : null;
  const virtualKeysHref =
    pageData.selectedWorkspaceId
      ? buildVirtualKeysInventoryHref({
          workspaceId: pageData.selectedWorkspaceId,
          offset: pageData.pageOffset,
          q: searchQuery,
          status: statusFilter,
          binding: bindingFilter,
          risk: riskFilter,
          issuance: issuanceFilter,
          returnTo,
        })
      : buildVirtualKeysInventoryHref({
          q: searchQuery,
          status: statusFilter,
          binding: bindingFilter,
          risk: riskFilter,
          issuance: issuanceFilter,
          returnTo,
        });
  const noWorkspaceDescription =
    locale === "zh"
      ? "请使用页头中的全局工作区切换器继续。"
      : "Use the global workspace switcher in the header to continue.";
  return (
    <AppShell
      headerMode="compact"
      showOperatorContextCards={false}
      showSupportPanels={false}
      sidebarVariant="minimal"
      title={tr("Virtual Keys")}
      subtitle={
        locale === "zh"
          ? "治理服务、共享与运行时凭据；开发者个人接入请使用 Access。"
          : "Govern service, shared, and runtime credentials here. Use Access for personal developer keys."
      }
      workspaceId={pageData.selectedWorkspaceId}
      workspaceLabel={selectedWorkspace ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}` : null}
    >
      <section className="space-y-5">
        {pageData.selectedWorkspaceId ? (
          <div className="space-y-6">
            <VirtualKeysWorkspaceView
              key={`${pageData.selectedWorkspaceId}:${pageData.pageOffset}:${pageData.virtualKeysTotal}`}
              environments={pageData.environments}
              initialInventorySummary={pageData.virtualKeySummary}
              initialVirtualKeys={pageData.virtualKeys}
              providerConnections={pageData.providerConnections}
              projects={pageData.projects}
              pageOffset={pageData.pageOffset}
              pageSize={pageData.pageSize}
              initialStatusFilter={statusFilter}
              initialBindingFilter={bindingFilter}
              initialRiskFilter={riskFilter}
              initialIssuanceFilter={issuanceFilter}
              initialSearchQuery={searchQuery}
              returnTo={returnTo}
              totalVirtualKeys={pageData.virtualKeysTotal}
              workspaceId={pageData.selectedWorkspaceId}
              locale={locale}
            />
          </div>
        ) : (
          <EmptyState compact title={tr("Workspace required")} description={noWorkspaceDescription} />
        )}
      </section>
    </AppShell>
  );
}
