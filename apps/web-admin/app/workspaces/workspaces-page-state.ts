import type { Workspace, WorkspaceSetupSummary } from "@teamops/contracts";

import type { AppLocale } from "../lib/i18n";
import { buildContextualHref } from "../lib/navigation";

export type WorkspaceViewFilter = "all" | "recent" | "established";
export type WorkspaceLifecycleState = "onboarding" | "stabilizing" | "operating";
export type WorkspaceSortOrder =
  | "updated-desc"
  | "updated-asc"
  | "name-asc"
  | "name-desc"
  | "review-priority";
export type WorkspaceDensity = "comfortable" | "compact";
export type WorkspaceColumnSet = "standard" | "audit" | "minimal";
export type WorkspaceReviewFilter = "all" | "fresh" | "active" | "dormant";
export type WorkspaceQueueBucket = "all" | "over7d" | "over30d" | "over90d";
export type NoticeType = "created" | "updated" | "deleted" | "error";

export type WorkspacesUrlState = {
  organizationId: string | null;
  focusWorkspaceId: string | null;
  q: string;
  view: WorkspaceViewFilter;
  sort: WorkspaceSortOrder;
  density: WorkspaceDensity;
  columns: WorkspaceColumnSet;
  review: WorkspaceReviewFilter;
  bucket: WorkspaceQueueBucket;
  create: boolean;
  notice: NoticeType | null;
  message: string | null;
  returnTo: string | null;
};

export type WorkspaceActionLink = {
  labelKey: string;
  href: string;
};

export type WorkspaceReviewState = {
  tone: "fresh" | "active" | "dormant";
  status: "healthy" | "scoped" | "warning";
};

export type WorkspacesPageData = {
  organizationId: string | null;
  workspaces: Workspace[];
  setupSummariesByWorkspaceId: Record<string, WorkspaceSetupSummary | null>;
};

function parseWorkspaceViewFilter(value: string | null | undefined): WorkspaceViewFilter {
  return value === "recent" || value === "established" ? value : "all";
}

function parseWorkspaceSortOrder(value: string | null | undefined): WorkspaceSortOrder {
  return value === "updated-asc" ||
    value === "name-asc" ||
    value === "name-desc" ||
    value === "review-priority"
    ? value
    : "updated-desc";
}

function parseWorkspaceDensity(value: string | null | undefined): WorkspaceDensity {
  return value === "compact" ? "compact" : "comfortable";
}

function parseWorkspaceColumnSet(value: string | null | undefined): WorkspaceColumnSet {
  return value === "audit" || value === "minimal" ? value : "standard";
}

function parseWorkspaceReviewFilter(value: string | null | undefined): WorkspaceReviewFilter {
  return value === "fresh" || value === "active" || value === "dormant" ? value : "all";
}

function parseWorkspaceQueueBucket(value: string | null | undefined): WorkspaceQueueBucket {
  return value === "over7d" || value === "over30d" || value === "over90d" ? value : "all";
}

function parseNoticeType(value: string | null | undefined): NoticeType | null {
  return value === "created" || value === "updated" || value === "deleted" || value === "error"
    ? value
    : null;
}

function getOptionalString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function parseWorkspacesUrlState(params: {
  organizationId?: string | null;
  focusWorkspaceId?: string | null;
  q?: string | null;
  view?: string | null;
  sort?: string | null;
  density?: string | null;
  columns?: string | null;
  review?: string | null;
  bucket?: string | null;
  create?: string | null;
  notice?: string | null;
  message?: string | null;
  returnTo?: string | null;
}): WorkspacesUrlState {
  return {
    organizationId: getOptionalString(params.organizationId),
    focusWorkspaceId: getOptionalString(params.focusWorkspaceId),
    q: params.q?.trim() ?? "",
    view: parseWorkspaceViewFilter(params.view),
    sort: parseWorkspaceSortOrder(params.sort),
    density: parseWorkspaceDensity(params.density),
    columns: parseWorkspaceColumnSet(params.columns),
    review: parseWorkspaceReviewFilter(params.review),
    bucket: parseWorkspaceQueueBucket(params.bucket),
    create: params.create === "1",
    notice: parseNoticeType(params.notice),
    message: getOptionalString(params.message),
    returnTo: getOptionalString(params.returnTo),
  };
}

export function buildWorkspacesPageHref(state: Partial<WorkspacesUrlState>) {
  const params = new URLSearchParams();

  if (state.organizationId) {
    params.set("organizationId", state.organizationId);
  }
  if (state.focusWorkspaceId) {
    params.set("focusWorkspaceId", state.focusWorkspaceId);
  }
  if (state.q?.trim()) {
    params.set("q", state.q.trim());
  }
  if (state.view && state.view !== "all") {
    params.set("view", state.view);
  }
  if (state.sort && state.sort !== "updated-desc") {
    params.set("sort", state.sort);
  }
  if (state.density && state.density !== "comfortable") {
    params.set("density", state.density);
  }
  if (state.columns && state.columns !== "standard") {
    params.set("columns", state.columns);
  }
  if (state.review && state.review !== "all") {
    params.set("review", state.review);
  }
  if (state.bucket && state.bucket !== "all") {
    params.set("bucket", state.bucket);
  }
  if (state.create) {
    params.set("create", "1");
  }
  if (state.notice) {
    params.set("notice", state.notice);
  }
  if (state.message) {
    params.set("message", state.message);
  }

  const href = params.toString() ? `/workspaces?${params.toString()}` : "/workspaces";
  return buildContextualHref(href, state.returnTo ?? null);
}

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

export function formatDate(value: string, locale: AppLocale) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function getNoticeState(notice?: NoticeType | null) {
  if (notice === "created") {
    return {
      type: "created" as const,
      status: "healthy" as const,
    };
  }

  if (notice === "updated") {
    return {
      type: "updated" as const,
      status: "healthy" as const,
    };
  }

  if (notice === "deleted") {
    return {
      type: "deleted" as const,
      status: "warning" as const,
    };
  }

  if (notice === "error") {
    return {
      type: "error" as const,
      status: "error" as const,
    };
  }

  return null;
}

export function getWorkspaceLifecycle(createdAt: string): {
  state: WorkspaceLifecycleState;
  badgeStatus: "warning" | "scoped" | "healthy";
} {
  const createdAtMs = Date.parse(createdAt);
  const ageDays = Number.isFinite(createdAtMs)
    ? Math.floor((Date.now() - createdAtMs) / (24 * 60 * 60 * 1000))
    : null;

  if (ageDays === null || ageDays <= 14) {
    return {
      state: "onboarding",
      badgeStatus: "warning",
    };
  }

  if (ageDays <= 90) {
    return {
      state: "stabilizing",
      badgeStatus: "scoped",
    };
  }

  return {
    state: "operating",
    badgeStatus: "healthy",
  };
}

export function getWorkspaceQueueBucketThreshold(queueBucket: WorkspaceQueueBucket) {
  if (queueBucket === "over7d") {
    return Date.now() - 7 * 24 * 60 * 60 * 1000;
  }

  if (queueBucket === "over30d") {
    return Date.now() - 30 * 24 * 60 * 60 * 1000;
  }

  if (queueBucket === "over90d") {
    return Date.now() - 90 * 24 * 60 * 60 * 1000;
  }

  return null;
}

export function getWorkspaceReviewState(updatedAt: string): WorkspaceReviewState {
  const updatedAtMs = Date.parse(updatedAt);
  const ageDays = Number.isFinite(updatedAtMs)
    ? Math.floor((Date.now() - updatedAtMs) / (24 * 60 * 60 * 1000))
    : null;

  if (ageDays === null || ageDays <= 3) {
    return {
      tone: "fresh",
      status: "healthy",
    };
  }

  if (ageDays <= 30) {
    return {
      tone: "active",
      status: "scoped",
    };
  }

  return {
    tone: "dormant",
    status: "warning",
  };
}

export function getWorkspaceReviewPriority(reviewTone: WorkspaceReviewState["tone"]) {
  switch (reviewTone) {
    case "dormant":
      return 0;
    case "active":
      return 1;
    case "fresh":
    default:
      return 2;
  }
}

export function matchesWorkspaceQuery(
  workspace: Pick<Workspace, "name" | "slug">,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }

  return `${workspace.name} ${workspace.slug}`.toLowerCase().includes(normalizedQuery);
}

export function isRecentWorkspace(workspace: Pick<Workspace, "createdAt">, recentThreshold: number) {
  const createdAtMs = Date.parse(workspace.createdAt);
  return Number.isFinite(createdAtMs) && createdAtMs >= recentThreshold;
}

export function matchesWorkspaceView(
  workspace: Pick<Workspace, "createdAt">,
  viewFilter: WorkspaceViewFilter,
  recentThreshold: number,
) {
  const isRecent = isRecentWorkspace(workspace, recentThreshold);

  if (viewFilter === "recent") {
    return isRecent;
  }

  if (viewFilter === "established") {
    return !isRecent;
  }

  return true;
}

export function matchesWorkspaceReview(
  workspace: Pick<Workspace, "updatedAt">,
  reviewFilter: WorkspaceReviewFilter,
) {
  return reviewFilter === "all" || getWorkspaceReviewState(workspace.updatedAt).tone === reviewFilter;
}

export function matchesWorkspaceQueueBucket(
  workspace: Pick<Workspace, "updatedAt">,
  queueBucket: WorkspaceQueueBucket,
) {
  const threshold = getWorkspaceQueueBucketThreshold(queueBucket);

  if (threshold === null) {
    return true;
  }

  return Date.parse(workspace.updatedAt) <= threshold;
}

export function countReviewStates(workspaces: Array<Pick<Workspace, "updatedAt">>) {
  return workspaces.reduce(
    (counts, workspace) => {
      const reviewTone = getWorkspaceReviewState(workspace.updatedAt).tone;
      counts[reviewTone] += 1;
      return counts;
    },
    {
      fresh: 0,
      active: 0,
      dormant: 0,
    },
  );
}

export function countQueueBuckets(workspaces: Array<Pick<Workspace, "updatedAt">>) {
  const now = Date.now();
  const thresholds = {
    over7d: now - 7 * 24 * 60 * 60 * 1000,
    over30d: now - 30 * 24 * 60 * 60 * 1000,
    over90d: now - 90 * 24 * 60 * 60 * 1000,
  };

  return workspaces.reduce(
    (counts, workspace) => {
      const updatedAtMs = Date.parse(workspace.updatedAt);

      if (!Number.isFinite(updatedAtMs)) {
        return counts;
      }

      if (updatedAtMs <= thresholds.over7d) {
        counts.over7d += 1;
      }

      if (updatedAtMs <= thresholds.over30d) {
        counts.over30d += 1;
      }

      if (updatedAtMs <= thresholds.over90d) {
        counts.over90d += 1;
      }

      return counts;
    },
    {
      over7d: 0,
      over30d: 0,
      over90d: 0,
    },
  );
}

export function sortWorkspaceCollection<T extends Pick<Workspace, "name" | "updatedAt">>(
  items: T[],
  sortOrder: WorkspaceSortOrder,
  locale: AppLocale,
) {
  return [...items].sort((left, right) => {
    if (sortOrder === "review-priority") {
      const leftPriority = getWorkspaceReviewPriority(getWorkspaceReviewState(left.updatedAt).tone);
      const rightPriority = getWorkspaceReviewPriority(getWorkspaceReviewState(right.updatedAt).tone);

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    }
    if (sortOrder === "name-asc") {
      return left.name.localeCompare(right.name, getIntlLocale(locale), { sensitivity: "base" });
    }

    if (sortOrder === "name-desc") {
      return right.name.localeCompare(left.name, getIntlLocale(locale), { sensitivity: "base" });
    }

    const leftUpdatedAt = Date.parse(left.updatedAt);
    const rightUpdatedAt = Date.parse(right.updatedAt);
    const delta = rightUpdatedAt - leftUpdatedAt;

    return sortOrder === "updated-asc" ? -delta : delta;
  });
}

export function buildWorkspaceActionLinks(workspaceId: string, currentPageHref: string) {
  const encodedWorkspaceId = encodeURIComponent(workspaceId);

  const primaryLinks: WorkspaceActionLink[] = [
    {
      labelKey: "actions.controlCenter",
      href: buildContextualHref(`/?workspaceId=${encodedWorkspaceId}`, currentPageHref),
    },
    {
      labelKey: "actions.providers",
      href: buildContextualHref(`/providers?workspaceId=${encodedWorkspaceId}`, currentPageHref),
    },
    {
      labelKey: "actions.members",
      href: buildContextualHref(`/members?workspaceId=${encodedWorkspaceId}`, currentPageHref),
    },
    {
      labelKey: "actions.alerts",
      href: buildContextualHref(`/alerts?workspaceId=${encodedWorkspaceId}`, currentPageHref),
    },
  ];

  const secondaryLinks: WorkspaceActionLink[] = [
    {
      labelKey: "actions.keys",
      href: buildContextualHref(`/virtual-keys?workspaceId=${encodedWorkspaceId}`, currentPageHref),
    },
    {
      labelKey: "actions.budgets",
      href: buildContextualHref(`/budgets?workspaceId=${encodedWorkspaceId}`, currentPageHref),
    },
    {
      labelKey: "actions.projects",
      href: buildContextualHref(`/projects?workspaceId=${encodedWorkspaceId}`, currentPageHref),
    },
    {
      labelKey: "actions.usage",
      href: buildContextualHref(`/usage-events?workspaceId=${encodedWorkspaceId}`, currentPageHref),
    },
  ];

  return {
    primaryLinks,
    secondaryLinks,
  };
}

