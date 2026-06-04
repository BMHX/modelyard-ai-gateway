import { buildActionRedirectPath } from "../lib/action-redirect";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";

export type MembersFocusFilter =
  | "all"
  | "stale_invites"
  | "scope_gaps"
  | "expired_temp"
  | "expiring_temp"
  | "dormant_broad_access"
  | "broad_access"
  | "disabled_cleanup";

export type MembersSection = "roster" | "invites" | "access-reviews" | "offboarding";
export type MembersViewMode = "roster" | "offboarding";
export type MembersTaskMode = "assign-projects" | null;

type BuildMembersPageHrefArgs = {
  workspaceId?: string | null;
  q?: string | null;
  status?: string | null;
  role?: string | null;
  view?: string | null;
  section?: MembersSection | null;
  focus?: MembersFocusFilter | null;
  focusMemberId?: string | null;
  task?: MembersTaskMode;
  projectId?: string | null;
  returnTo?: string | null;
};

const LOCAL_ORIGIN = "http://localhost";

function withHash(path: string, hash?: string | null) {
  const url = new URL(path, LOCAL_ORIGIN);
  url.hash = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildMembersPageHref(args?: BuildMembersPageHrefArgs) {
  const pathname =
    args?.section === "access-reviews"
      ? "/members/reviews"
      : args?.section === "offboarding"
        ? "/members/offboarding"
        : "/members";
  const params = new URLSearchParams();

  if (args?.workspaceId) {
    params.set("workspaceId", args.workspaceId);
  }
  if (args?.q) {
    params.set("q", args.q);
  }
  if (args?.status && args.status !== "all") {
    params.set("status", args.status);
  }
  if (args?.role && args.role !== "all") {
    params.set("role", args.role);
  }
  if (args?.view && args.view !== "roster") {
    params.set("view", args.view);
  }
  if (args?.section === "invites") {
    params.set("section", args.section);
  }
  if (args?.focus && args.focus !== "all") {
    params.set("focus", args.focus);
  }
  if (args?.focusMemberId) {
    params.set("focusMemberId", args.focusMemberId);
  }
  if (args?.task) {
    params.set("task", args.task);
  }
  if (args?.projectId) {
    params.set("projectId", args.projectId);
  }

  const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
  return buildContextualHref(href, args?.returnTo);
}

export function stripMembersTaskState(path?: string | null, hash?: string | null) {
  const safePath = getSafeReturnTo(path);
  if (!safePath) {
    return null;
  }

  const url = new URL(safePath, LOCAL_ORIGIN);
  url.searchParams.delete("focusMemberId");
  url.searchParams.delete("task");
  url.searchParams.delete("projectId");

  return withHash(`${url.pathname}${url.search}`, hash);
}

export function buildMembersRedirect(
  workspaceId: string,
  requestedPath?: string,
  options?: {
    notice?: "created" | "updated" | "deleted" | "error";
    message?: string;
    focusMemberId?: string;
    anchor?: string;
    task?: "assign-projects";
    projectId?: string;
    clearTaskState?: boolean;
  },
) {
  const hash = options?.anchor ?? (options?.focusMemberId ? `member-${options.focusMemberId}` : null);
  const fallbackPath = buildMembersPageHref({
    workspaceId,
    focusMemberId: options?.focusMemberId ?? null,
    task: options?.clearTaskState ? null : options?.task ?? null,
    projectId: options?.clearTaskState ? null : options?.projectId ?? null,
  });
  const normalizedFallbackPath = hash ? withHash(fallbackPath, hash) : fallbackPath;
  const normalizedRequestedPath = options?.clearTaskState
    ? stripMembersTaskState(requestedPath)
    : getSafeReturnTo(requestedPath);
  const targetPath =
    normalizedRequestedPath
      ? hash
        ? withHash(normalizedRequestedPath, hash)
        : normalizedRequestedPath
      : undefined;

  return buildActionRedirectPath(normalizedFallbackPath, targetPath, {
    notice: options?.notice,
    message: options?.message,
    focusMemberId: options?.focusMemberId,
    task: options?.clearTaskState ? undefined : options?.task,
    projectId: options?.clearTaskState ? undefined : options?.projectId,
  });
}
