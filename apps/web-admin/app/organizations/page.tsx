import { Building2, Plus, Search, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { AppShell } from "../components/app-shell";
import { ControlApiStatusCard } from "../components/control-api-status-card";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { ResourceTableSection } from "../components/resource-table-section";
import { diagnoseControlApiIssue, listOrganizationSummaries } from "../lib/control-api";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import enOrganizationsMessages from "../messages/en/organizations.json";
import zhOrganizationsMessages from "../messages/zh/organizations.json";
import { getCurrentLocale } from "../lib/i18n-server";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import { getUserErrorMessage } from "../lib/user-facing-error";
import { AutoSubmitSelect } from "./auto-submit-select";
import { OrganizationEditDialog } from "./organization-edit-dialog";
import { OrganizationsCreateDialog } from "./organizations-create-dialog";
import { OrganizationTableRow } from "./organization-table-row";

export const dynamic = "force-dynamic";

type OrganizationsPageProps = {
  searchParams?: Promise<{
    focusOrganizationId?: string;
    q?: string;
    view?: string;
    notice?: string;
    message?: string;
    returnTo?: string;
  }>;
};

type OrganizationViewFilter = "all" | "multi" | "single" | "empty";
type OrganizationLifecycleState = "setup" | "launch" | "scaled";

function formatInteger(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US").format(value);
}

function resolveOrganizationMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  const nested = key.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" && part in (current as Record<string, unknown>)
      ? (current as Record<string, unknown>)[part]
      : null, messages);
  return typeof nested === "string" ? nested : null;
}

function createOrganizationsTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhOrganizationsMessages : enOrganizationsMessages) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    const template = resolveOrganizationMessage(messages, key);
    if (!template) return translateInlineText(locale, key);
    return template.replace(/\{(\w+)\}/g, (_, token) => String(values?.[token] ?? `{${token}}`));
  };
}

function getNoticeState(notice?: string | null) {
  if (notice === "created" || notice === "updated") return { label: notice === "created" ? "Created" : "Updated", tone: "success" as const };
  if (notice === "deleted") return { label: "Deleted", tone: "warning" as const };
  if (notice === "error") return { label: "Error", tone: "error" as const };
  return null;
}

function getOrganizationLifecycle(workspaceCount: number): {
  state: OrganizationLifecycleState;
  label: string;
  variant: "outline" | "secondary" | "default";
  recommendedWorkspaceView: "all" | "recent" | "established";
} {
  if (workspaceCount <= 0) {
    return {
      state: "setup",
      label: "setup",
      variant: "outline",
      recommendedWorkspaceView: "all",
    };
  }
  if (workspaceCount === 1) {
    return {
      state: "launch",
      label: "single-workspace",
      variant: "secondary",
      recommendedWorkspaceView: "recent",
    };
  }
  return {
    state: "scaled",
    label: "multi-workspace",
    variant: "default",
    recommendedWorkspaceView: "established",
  };
}

function buildOrganizationsPageHref(args?: {
  q?: string | null;
  view?: OrganizationViewFilter | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();
  if (args?.q) params.set("q", args.q);
  if (args?.view && args.view !== "all") params.set("view", args.view);
  const href = params.toString() ? `/organizations?${params.toString()}` : "/organizations";
  return buildContextualHref(href, args?.returnTo);
}

export default async function OrganizationsPage({ searchParams }: OrganizationsPageProps) {
  const locale = await getCurrentLocale();
  const tr = createOrganizationsTranslator(locale);
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = getSafeReturnTo(resolvedSearchParams.returnTo);
  const query = resolvedSearchParams.q?.trim() ?? "";
  const normalizedQuery = query.toLowerCase();
  const viewFilter: OrganizationViewFilter =
    resolvedSearchParams.view === "multi" ||
    resolvedSearchParams.view === "single" ||
    resolvedSearchParams.view === "empty"
      ? resolvedSearchParams.view
      : "all";
  let organizations = [] as Awaited<ReturnType<typeof listOrganizationSummaries>>;
  let organizationsIssue = null as ReturnType<typeof diagnoseControlApiIssue> | {
    kind: "unexpected";
    resource: "control-api";
    message: string;
    path: string;
    status: number | null;
  } | null;

  try {
    organizations = await listOrganizationSummaries();
  } catch (error) {
    organizationsIssue =
      diagnoseControlApiIssue(error) ?? {
        kind: "unexpected",
        resource: "control-api",
        message: getUserErrorMessage(error, "Can't load this page right now."),
        path: "/v1/organizations?includeWorkspaceCounts=1",
        status: null,
      };
  }

  const filteredOrganizations = organizations.filter((organization) => {
    if (viewFilter === "multi" && organization.workspaceCount < 2) return false;
    if (viewFilter === "single" && organization.workspaceCount !== 1) return false;
    if (viewFilter === "empty" && organization.workspaceCount !== 0) return false;
    if (!normalizedQuery) return true;
    return `${organization.name} ${organization.slug}`.toLowerCase().includes(normalizedQuery);
  });

  const noticeState = getNoticeState(resolvedSearchParams.notice);
  const focusedOrganizationId = resolvedSearchParams.focusOrganizationId?.trim() ?? null;
  const currentPageHref = buildOrganizationsPageHref({ q: query || null, view: viewFilter, returnTo });
  const hasActiveFilters = Boolean(query || viewFilter !== "all");
  const resultCountLabel = hasActiveFilters
    ? locale === "zh"
      ? `筛选出 ${formatInteger(filteredOrganizations.length, locale)} 个组织`
      : `Filtered ${formatInteger(filteredOrganizations.length, locale)} organizations`
    : locale === "zh"
      ? `共 ${formatInteger(organizations.length, locale)} 个组织`
      : `Total ${formatInteger(organizations.length, locale)} organizations`;

  return (
    <AppShell
      headerMode="compact"
      showOperatorContextCards={false}
      showSupportPanels={false}
      sidebarVariant="minimal"
      title={tr("Organizations")}
      subtitle=""
    >
      <section className="space-y-6">
        {noticeState && resolvedSearchParams.message && !focusedOrganizationId ? (
          <ResourceInlineNotice
            label={tr(noticeState.label)}
            message={tr(resolvedSearchParams.message)}
            tone={noticeState.tone}
          />
        ) : null}

        {organizationsIssue ? (
          <ControlApiStatusCard
            issue={organizationsIssue}
            heading={tr("Organization data unavailable")}
          />
        ) : (
          <div className="grid gap-6">
            <ResourceTableSection
              meta={resultCountLabel}
              actions={
                <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center lg:justify-end">
                  <form action="/organizations" className="flex w-full flex-col gap-3 sm:flex-row sm:items-center lg:w-auto" method="get">
                    <div className="relative min-w-[280px] flex-1 lg:min-w-[320px]">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        defaultValue={query}
                        id="organization-query"
                        name="q"
                        placeholder={tr("Name or slug")}
                        className="h-9 border-border/60 bg-background pl-9 shadow-none"
                        type="search"
                      />
                    </div>

                    <div className="flex items-center gap-2 sm:shrink-0">
                      <AutoSubmitSelect
                        aria-label={tr("View")}
                        id="organization-view"
                        name="view"
                        defaultValue={viewFilter}
                        className="h-9 min-w-[150px] border-border/60 bg-background shadow-none"
                      >
                        <option value="all">{tr("all")}</option>
                        <option value="multi">{tr("multi-workspace")}</option>
                        <option value="single">{tr("single-workspace")}</option>
                        <option value="empty">{tr("empty")}</option>
                      </AutoSubmitSelect>

                      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

                      <Button type="submit" size="sm" variant="outline" className="h-9 border-border/60 px-3.5 font-medium">
                        <SlidersHorizontal className="mr-2 size-3.5" />
                        {tr("Apply")}
                      </Button>

                      {hasActiveFilters ? (
                        <Button asChild variant="ghost" size="sm" className="h-9 px-2.5 text-muted-foreground hover:text-foreground">
                          <a href={buildOrganizationsPageHref({ returnTo })}>
                            {tr("Reset")}
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </form>

                  <OrganizationsCreateDialog
                    currentPageHref={currentPageHref}
                    locale={locale}
                    triggerVariant="default"
                    triggerLabel={
                      <span className="flex items-center gap-2">
                        <Plus className="size-4" />
                        {tr("New organization")}
                      </span>
                    }
                  />
                </div>
              }
            >
              {filteredOrganizations.length ? (
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="w-[40%] min-w-[200px]">{tr("Organization")}</TableHead>
                      <TableHead className="w-[30%]">{tr("Slug")}</TableHead>
                      <TableHead className="w-[30%]">{tr("Status")}</TableHead>
                      <TableHead className="w-[1%] text-right">{locale === "zh" ? "操作" : "Actions"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrganizations.map((organization) => {
                      const workspaceCount = organization.workspaceCount;
                      const lifecycle = getOrganizationLifecycle(workspaceCount);
                      const workspacesHref = buildContextualHref(
                        `/workspaces?organizationId=${encodeURIComponent(organization.id)}&view=${lifecycle.recommendedWorkspaceView}`,
                        currentPageHref,
                      );
                      const isFocused = focusedOrganizationId === organization.id;

                      return (
                        <OrganizationTableRow 
                          key={organization.id} 
                          href={workspacesHref}
                          isFocused={isFocused}
                          id={`organization-${organization.id}`}
                        >
                          <TableCell className="py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20 text-muted-foreground group-hover:border-primary/30 group-hover:text-primary transition-colors">
                                <Building2 className="size-4.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-foreground truncate">{organization.name}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <code className="text-[12px] mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/40">
                              {organization.slug || "—"}
                            </code>
                          </TableCell>
                          <TableCell className="py-4">
                            <Badge variant={lifecycle.variant} className="capitalize">
                              {tr(lifecycle.label)}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-4 text-right">
                            <div className="flex justify-end">
                              <OrganizationEditDialog
                                organization={organization}
                                currentPageHref={currentPageHref}
                                locale={locale}
                                triggerMode="button"
                              />
                            </div>
                          </TableCell>
                        </OrganizationTableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-12 px-6">
                  <EmptyState
                    action={
                      organizations.length ? null : (
                        <OrganizationsCreateDialog
                          currentPageHref={currentPageHref}
                          locale={locale}
                          triggerLabel={tr("New organization")}
                          triggerVariant="outline"
                        />
                      )
                    }
                    description={
                      organizations.length
                        ? tr("No organization matches the current filters.")
                        : tr("Add the first organization entry to get started.")
                    }
                    title={organizations.length ? tr("No matching organization") : tr("Create your first organization")}
                  />
                </div>
              )}
            </ResourceTableSection>
          </div>
        )}
      </section>
    </AppShell>
  );
}
