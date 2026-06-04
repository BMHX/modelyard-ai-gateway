"use client";

import { useEffect, useMemo, useState } from "react";
import type { Organization, WorkspaceSetupSummary } from "@teamops/contracts";
import { Plus } from "lucide-react";

import { Link } from "@/i18n/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { MotionDiv, MotionSection } from "@/app/components/client-motion";

import { AppShell } from "../components/app-shell";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { useLocalePreference, useT } from "../lib/i18n-client";
import { localizeHref, type AppLocale } from "../lib/i18n";
import { useWorkspacesPageQuery } from "../lib/console-api-client";
import { buildContextualHref } from "../lib/navigation";
import { WorkspaceResourceList, type WorkspaceResourceRow } from "./_components/workspace-resource-list";
import { WorkspacesReviewQueueSummary } from "./_components/workspaces-review-queue-summary";
import { CompactToolbar, FilterField } from "../components/resource-compact-toolbar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkspacesPageResponse } from "../lib/console-api-contracts";
import {
  buildWorkspaceActionLinks,
  buildWorkspacesPageHref,
  countQueueBuckets,
  countReviewStates,
  formatDate,
  getNoticeState,
  getWorkspaceLifecycle,
  getWorkspaceReviewState,
  matchesWorkspaceQuery,
  matchesWorkspaceQueueBucket,
  matchesWorkspaceReview,
  matchesWorkspaceView,
  sortWorkspaceCollection,
  type NoticeType,
  type WorkspaceColumnSet,
  type WorkspaceDensity,
  type WorkspaceQueueBucket,
  type WorkspaceReviewFilter,
  type WorkspaceSortOrder,
  type WorkspaceViewFilter,
  type WorkspacesUrlState,
} from "./workspaces-page-state";

type WorkspacesPageClientProps = {
  adminWorkspaceId: string | null;
  initialData: WorkspacesPageResponse;
  initialGuideExitedWorkspaceIds: string[];
  initialOrganizations: Array<Pick<Organization, "id" | "name" | "slug">>;
  initialUrlState: WorkspacesUrlState;
};

function buildSetupState(args: {
  guideExited: boolean;
  locale: AppLocale;
  summary: WorkspaceSetupSummary | null;
  tr: ReturnType<typeof useT>;
}) {
  if (!args.summary) {
    return {
      label: args.tr("Setup status unavailable"),
      status: "setup" as const,
      meta: args.tr("Retry from the workspace when needed."),
      isSetupIncomplete: false,
      nextStepTitle: args.tr("Open workspace"),
    };
  }

  const setupSteps = args.summary.steps.filter((step) => step.id !== "ready_for_handoff");
  const setupProgress = {
    doneCount: setupSteps.filter((step) => step.status === "done").length,
    totalCount: setupSteps.length,
  };
  const nextStep =
    args.summary.steps.find((step) => step.status === "next") ??
    args.summary.steps.find((step) => step.status !== "done") ??
    null;
  const nextStepTitle = args.tr(nextStep?.title ?? "Continue setup");
  const isSetupIncomplete = args.summary.mode === "setup" && !args.guideExited;

  if (args.summary.mode === "setup" && args.guideExited) {
    return {
      label: args.locale === "zh" ? "已暂停" : "Paused",
      status: "scoped" as const,
      meta:
        args.locale === "zh"
          ? `${setupProgress.doneCount}/${setupProgress.totalCount} 已完成`
          : `${setupProgress.doneCount}/${setupProgress.totalCount} complete`,
      isSetupIncomplete: false,
      nextStepTitle,
    };
  }

  return {
    label: isSetupIncomplete ? args.tr("Setup incomplete") : args.tr("Ready for handoff"),
    status: isSetupIncomplete ? ("warning" as const) : ("healthy" as const),
    meta: isSetupIncomplete
      ? args.locale === "zh"
        ? `${setupProgress.doneCount}/${setupProgress.totalCount} 已完成`
        : `${setupProgress.doneCount}/${setupProgress.totalCount} complete`
      : args.tr("Ready for daily operations"),
    isSetupIncomplete,
    nextStepTitle,
  };
}

export function WorkspacesPageClient({
  adminWorkspaceId,
  initialData,
  initialGuideExitedWorkspaceIds,
  initialOrganizations,
  initialUrlState,
}: WorkspacesPageClientProps) {
  const { locale } = useLocalePreference();
  const t = useT("workspaces");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(
    initialUrlState.organizationId ?? initialData.organizationId ?? initialOrganizations[0]?.id ?? null,
  );
  const [query, setQuery] = useState(initialUrlState.q);
  const [viewFilter, setViewFilter] = useState<WorkspaceViewFilter>(initialUrlState.view);
  const [sortOrder, setSortOrder] = useState<WorkspaceSortOrder>(initialUrlState.sort);
  const [density, setDensity] = useState<WorkspaceDensity>(initialUrlState.density);
  const [columnSet, setColumnSet] = useState<WorkspaceColumnSet>(initialUrlState.columns);
  const [reviewFilter, setReviewFilter] = useState<WorkspaceReviewFilter>(initialUrlState.review);
  const [queueBucket, setQueueBucket] = useState<WorkspaceQueueBucket>(initialUrlState.bucket);
  const [isCreateOpen, setIsCreateOpen] = useState(initialUrlState.create);
  const [focusedWorkspaceId, setFocusedWorkspaceId] = useState(initialUrlState.focusWorkspaceId);
  const guideExitedWorkspaceIds = useMemo(
    () => new Set(initialGuideExitedWorkspaceIds),
    [initialGuideExitedWorkspaceIds],
  );
  const notice = initialUrlState.notice;
  const noticeMessage = initialUrlState.message;

  const queryResult = useWorkspacesPageQuery({
    organizationId: selectedOrganizationId,
    workspaceId: adminWorkspaceId,
  }, {
    initialData:
      selectedOrganizationId && selectedOrganizationId === initialData.organizationId
        ? initialData
        : undefined,
  });
  const pageData = queryResult.data ?? initialData;
  const workspaces = pageData?.workspaces ?? [];
  const setupSummariesByWorkspaceId = pageData?.setupSummariesByWorkspaceId ?? {};
  const selectedOrganization =
    selectedOrganizationId
      ? initialOrganizations.find((organization) => organization.id === selectedOrganizationId) ?? null
      : null;
  const normalizedQuery = query.trim().toLowerCase();
  const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const toolbarScopedWorkspaces = useMemo(
    () =>
      workspaces.filter(
        (workspace) =>
          matchesWorkspaceQuery(workspace, normalizedQuery) &&
          matchesWorkspaceView(workspace, viewFilter, recentThreshold),
      ),
    [normalizedQuery, recentThreshold, viewFilter, workspaces],
  );
  const reviewScopedWorkspaces = useMemo(
    () => toolbarScopedWorkspaces.filter((workspace) => matchesWorkspaceReview(workspace, reviewFilter)),
    [reviewFilter, toolbarScopedWorkspaces],
  );
  const bucketScopedWorkspaces = useMemo(
    () => toolbarScopedWorkspaces.filter((workspace) => matchesWorkspaceQueueBucket(workspace, queueBucket)),
    [queueBucket, toolbarScopedWorkspaces],
  );
  const filteredWorkspaces = useMemo(
    () => reviewScopedWorkspaces.filter((workspace) => matchesWorkspaceQueueBucket(workspace, queueBucket)),
    [queueBucket, reviewScopedWorkspaces],
  );
  const sortedFilteredWorkspaces = useMemo(
    () => sortWorkspaceCollection(filteredWorkspaces, sortOrder, locale),
    [filteredWorkspaces, locale, sortOrder],
  );
  const reviewCounts = useMemo(
    () => countReviewStates(bucketScopedWorkspaces),
    [bucketScopedWorkspaces],
  );
  const queueCounts = useMemo(
    () => countQueueBuckets(reviewScopedWorkspaces),
    [reviewScopedWorkspaces],
  );
  const resettableDefaults =
    !query &&
    viewFilter === "all" &&
    sortOrder === "updated-desc" &&
    reviewFilter === "all" &&
    queueBucket === "all" &&
    density === "comfortable" &&
    columnSet === "standard";
  const currentUrlState = useMemo(
    () => ({
      organizationId: selectedOrganizationId,
      focusWorkspaceId: focusedWorkspaceId,
      q: query,
      view: viewFilter,
      sort: sortOrder,
      density,
      columns: columnSet,
      review: reviewFilter,
      bucket: queueBucket,
      create: isCreateOpen,
      notice,
      message: noticeMessage,
      returnTo: initialUrlState.returnTo,
    }),
    [
      columnSet,
      density,
      focusedWorkspaceId,
      initialUrlState.returnTo,
      isCreateOpen,
      notice,
      noticeMessage,
      query,
      queueBucket,
      reviewFilter,
      selectedOrganizationId,
      sortOrder,
      viewFilter,
    ],
  );
  const currentPageHref = useMemo(
    () => buildWorkspacesPageHref(currentUrlState),
    [currentUrlState],
  );
  const redirectPageHref = useMemo(
    () =>
      buildWorkspacesPageHref({
        ...currentUrlState,
        create: false,
      }),
    [currentUrlState],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextHref = localizeHref(currentPageHref, locale);
    const currentHref = `${window.location.pathname}${window.location.search}`;

    if (nextHref === currentHref) {
      return;
    }

    window.history.replaceState(window.history.state, "", `${nextHref}${window.location.hash}`);
  }, [currentPageHref, locale]);

  const noticeState = getNoticeState(notice);
  const noticeLabel = noticeState ? t(`notice.${noticeState.type}`) : null;
  const localizedNoticeMessage = noticeMessage ? t(noticeMessage) : null;
  const workspaceNoticeState =
    noticeState && noticeLabel
      ? {
          label: noticeLabel,
          status: noticeState.status,
        }
      : null;
  const reviewQueueStats = [
    {
      label: t("queue.label.over7d"),
      value: String(queueCounts.over7d),
      active: queueBucket === "over7d",
      onClick: () => setQueueBucket("over7d"),
    },
    {
      label: t("queue.label.over30d"),
      value: String(queueCounts.over30d),
      active: queueBucket === "over30d",
      onClick: () => setQueueBucket("over30d"),
    },
    {
      label: t("queue.label.over90d"),
      value: String(queueCounts.over90d),
      active: queueBucket === "over90d",
      onClick: () => setQueueBucket("over90d"),
    },
  ];
  const workspaceRows: WorkspaceResourceRow[] = useMemo(
    () =>
      sortedFilteredWorkspaces.map((workspace) => {
        const lifecycle = getWorkspaceLifecycle(workspace.createdAt);
        const review = getWorkspaceReviewState(workspace.updatedAt);
        const setupSummary = setupSummariesByWorkspaceId[workspace.id] ?? null;
        const setupState = buildSetupState({
          guideExited: guideExitedWorkspaceIds.has(workspace.id),
          locale,
          summary: setupSummary,
          tr: t,
        });
        const openLink = {
          label: setupState.isSetupIncomplete ? t("Continue setup") : t("Open workspace"),
          href: buildContextualHref(
            `${setupState.isSetupIncomplete ? "/setup" : "/"}?workspaceId=${encodeURIComponent(workspace.id)}`,
            redirectPageHref,
          ),
        };
        const surfaceLinks = [
          {
            label: t("actions.members"),
            href: buildContextualHref(`/members?workspaceId=${encodeURIComponent(workspace.id)}`, redirectPageHref),
          },
          {
            label: t("actions.providers"),
            href: buildContextualHref(`/providers?workspaceId=${encodeURIComponent(workspace.id)}`, redirectPageHref),
          },
        ];
        const actionLinks = buildWorkspaceActionLinks(workspace.id, redirectPageHref);

        return {
          id: workspace.id,
          displayName: workspace.name,
          name: workspace.name,
          slug: workspace.slug,
          lifecycle: {
            label: t(`lifecycle.${lifecycle.state}`),
            status: lifecycle.badgeStatus,
            meta: t(`lifecycle.${lifecycle.state}Meta`),
          },
          review: {
            ...review,
            label: t(`review.${review.tone}`),
            meta: t(`review.${review.tone}Meta`),
          },
          setup: {
            label: setupState.label,
            status: setupState.status,
            meta: setupState.meta,
          },
          createdAtLabel: formatDate(workspace.createdAt, locale),
          updatedAtLabel: formatDate(workspace.updatedAt, locale),
          openLink,
          surfaceLinks,
          secondaryLinks: actionLinks.secondaryLinks.map((link) => ({
            label: t(link.labelKey),
            href: link.href,
          })),
          organizationId: selectedOrganizationId ?? "",
          redirectPath: `${redirectPageHref}#workspace-${workspace.id}`,
        };
      }),
    [guideExitedWorkspaceIds, locale, redirectPageHref, selectedOrganizationId, setupSummariesByWorkspaceId, sortedFilteredWorkspaces, t],
  );
  const hasWorkspaceIndex = Boolean(selectedOrganization && selectedOrganizationId);
  const hasAnyWorkspaces = workspaces.length > 0;
  const showReviewQueueSummary = reviewQueueStats.some((stat) => Number(stat.value) > 0);

  function handleOrganizationChange(organizationId: string) {
    setSelectedOrganizationId(organizationId);
    setFocusedWorkspaceId(null);
    setIsCreateOpen(false);
  }

  function handleResetFilters() {
    setQuery("");
    setViewFilter("all");
    setSortOrder("updated-desc");
    setDensity("comfortable");
    setColumnSet("standard");
    setReviewFilter("all");
    setQueueBucket("all");
  }

  return (
    <AppShell
      headerMode="compact"
      showOperatorContextCards={false}
      showSupportPanels={false}
      sidebarVariant="minimal"
      title={t("title")}
      subtitle=""
    >
      <MotionSection 
        className="space-y-5"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        {noticeState && noticeLabel && localizedNoticeMessage && !focusedWorkspaceId ? (
          <ResourceInlineNotice
            label={noticeLabel}
            message={localizedNoticeMessage}
            tone={noticeState.status === "error" ? "error" : noticeState.status === "warning" ? "warning" : "success"}
          />
        ) : null}

        {queryResult.error ? (
          <ResourceInlineNotice
            label={t("notice.error")}
            message={t("Can't refresh this workspace list right now.")}
            tone="error"
          />
        ) : null}

        {hasWorkspaceIndex ? (
          <>
            <CompactToolbar
              query={query}
              onQueryChange={setQuery}
              filterCount={[
                viewFilter !== "all",
                reviewFilter !== "all",
                queueBucket !== "all",
                initialOrganizations.length > 1
              ].filter(Boolean).length}
              onResetFilters={handleResetFilters}
              placeholder={t("toolbar.searchPlaceholder")}
              actions={
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setIsCreateOpen(true)}
                    size="sm"
                    type="button"
                    className="rounded-full px-4 font-medium shadow-none"
                  >
                    <Plus className="mr-1.5 size-4" />
                    {t("toolbar.newWorkspace")}
                  </Button>
                  <Select value={density} onValueChange={(val) => setDensity(val as any)}>
                    <SelectTrigger className="h-8 w-32 rounded-full text-xs">
                      <SelectValue placeholder="Density" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comfortable">{t("toolbar.densityOptions.comfortable")}</SelectItem>
                      <SelectItem value="compact">{t("toolbar.densityOptions.compact")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              }
            >
              {initialOrganizations.length > 1 && (
                <FilterField label={t("toolbar.organization")}>
                  <Select value={selectedOrganizationId ?? ""} onValueChange={handleOrganizationChange}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {initialOrganizations.map((org) => (
                        <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
              )}
              <FilterField label={t("toolbar.browse")}>
                <Select value={viewFilter} onValueChange={(val) => setViewFilter(val as any)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("toolbar.browseOptions.all")}</SelectItem>
                    <SelectItem value="recent">{t("toolbar.browseOptions.recent")}</SelectItem>
                    <SelectItem value="established">{t("toolbar.browseOptions.established")}</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label={t("toolbar.sort")}>
                <Select value={sortOrder} onValueChange={(val) => setSortOrder(val as any)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="updated-desc">{t("toolbar.sortOptions.updatedDesc")}</SelectItem>
                    <SelectItem value="updated-asc">{t("toolbar.sortOptions.updatedAsc")}</SelectItem>
                    <SelectItem value="name-asc">{t("toolbar.sortOptions.nameAsc")}</SelectItem>
                    <SelectItem value="name-desc">{t("toolbar.sortOptions.nameDesc")}</SelectItem>
                    <SelectItem value="review-priority">{t("toolbar.sortOptions.reviewPriority")}</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </CompactToolbar>
          </>
        ) : null}

        {!hasWorkspaceIndex ? (
          <MotionDiv 
            className="rounded-3xl border border-border/60 bg-card/40 p-8"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
          >
            <EmptyState
              action={
                <Button asChild size="sm" variant="default" className="shadow-none">
                  <Link href={buildContextualHref("/organizations", initialUrlState.returnTo)}>
                    {t("emptyState.noOrganization.action")}
                  </Link>
                </Button>
              }
              description={t("emptyState.noOrganization.description")}
              title={t("emptyState.noOrganization.title")}
            />
          </MotionDiv>
        ) : (
          <>
            {showReviewQueueSummary ? (
              <WorkspacesReviewQueueSummary
                onReviewQueueOpen={() => setQueueBucket("over30d")}
                openLabel={t("reviewQueue.open")}
                stats={reviewQueueStats}
                title={t("reviewQueue.title")}
              />
            ) : null}

            <WorkspaceResourceList
              columnSet={columnSet}
              density={density}
              emptyState={
                <EmptyState
                  action={
                    <Button
                      onClick={() => setIsCreateOpen(true)}
                      size="sm"
                      type="button"
                      variant="default"
                      className="shadow-none"
                    >
                      {t("toolbar.newWorkspace")}
                    </Button>
                  }
                  compact
                  description={
                    hasAnyWorkspaces
                      ? t("emptyState.noMatching.description")
                      : selectedOrganization
                        ? t("emptyState.noWorkspace.description", {
                            organization: selectedOrganization.name,
                          })
                        : t("emptyState.noWorkspace.descriptionFallback")
                  }
                  title={
                    hasAnyWorkspaces
                      ? t("emptyState.noMatching.title")
                      : t("emptyState.noWorkspace.title")
                  }
                />
              }
              focusedWorkspaceId={focusedWorkspaceId}
              noticeMessage={localizedNoticeMessage}
              noticeState={workspaceNoticeState}
              onColumnSetChange={setColumnSet}
              onDensityChange={setDensity}
              organizationId={selectedOrganizationId ?? ""}
              redirectPath={redirectPageHref}
              rows={workspaceRows}
            />
          </>
        )}
      </MotionSection>
    </AppShell>
  );
}
