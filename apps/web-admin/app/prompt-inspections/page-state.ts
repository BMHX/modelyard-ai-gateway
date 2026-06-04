import type { PromptInspectionSort } from "@teamops/contracts";

export const promptInspectionDefaultSort: PromptInspectionSort = "newest";

const promptInspectionExplicitFilterKeys = [
  "projectId",
  "environmentId",
  "provider",
  "providerConnectionId",
  "model",
  "virtualKeyId",
  "requestId",
  "verdict",
  "reviewStatus",
  "riskCategory",
  "activityLabel",
  "escalatedOnly",
  "from",
  "to",
] as const;

export type PromptInspectionColumnSortKey =
  | "time"
  | "score"
  | "verdict"
  | "review"
  | "provider"
  | "model";

function getSearchParamValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export function buildPromptInspectionsPageHref(args: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `/prompt-inspections?${query}` : "/prompt-inspections";
}

export function buildPromptInspectionPolicyHref(args: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `/prompt-inspections/policy?${query}` : "/prompt-inspections/policy";
}

export function appendSavedViewId(href: string, savedViewId: string) {
  const url = new URL(href, "http://localhost");
  url.searchParams.set("savedViewId", savedViewId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildPromptInspectionSavedViewOpenHref(savedViewId: string, nextHref: string) {
  const encodedSavedViewId = encodeURIComponent(savedViewId);
  const safeNextHref = new URL(nextHref, "http://localhost");
  const params = new URLSearchParams();
  params.set("next", `${safeNextHref.pathname}${safeNextHref.search}${safeNextHref.hash}`);
  return `/saved-views/${encodedSavedViewId}/open?${params.toString()}`;
}

export function shouldDefaultToPendingQueue(searchParams: Record<string, string | string[] | undefined>) {
  const workspaceId = getSearchParamValue(searchParams.workspaceId).trim();
  if (!workspaceId) {
    return false;
  }

  if (getSearchParamValue(searchParams.savedViewId).trim() || getSearchParamValue(searchParams.inspectionId).trim()) {
    return false;
  }

  return !promptInspectionExplicitFilterKeys.some((key) => getSearchParamValue(searchParams[key]).trim());
}

export function buildCompactPageNumbers(currentPage: number, totalPages: number) {
  if (totalPages <= 1) {
    return [1];
  }

  const pages = new Set<number>([1, totalPages]);
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page >= 1 && page <= totalPages) {
      pages.add(page);
    }
  }

  return [...pages].sort((left, right) => left - right);
}

export function getNextPromptInspectionSort(
  currentSortBy: PromptInspectionSort | null | undefined,
  column: PromptInspectionColumnSortKey,
): PromptInspectionSort {
  switch (column) {
    case "time":
      return currentSortBy === "newest" ? "oldest" : "newest";
    case "score":
      return currentSortBy === "score_desc" ? "score_asc" : "score_desc";
    case "verdict":
      return currentSortBy === "verdict_priority" ? "newest" : "verdict_priority";
    case "review":
      return currentSortBy === "review_status_priority" ? "newest" : "review_status_priority";
    case "provider":
      return currentSortBy === "provider_asc" ? "newest" : "provider_asc";
    case "model":
      return currentSortBy === "model_asc" ? "newest" : "model_asc";
    default:
      return promptInspectionDefaultSort;
  }
}

export function getPromptInspectionSortIndicator(
  currentSortBy: PromptInspectionSort | null | undefined,
  column: PromptInspectionColumnSortKey,
) {
  switch (column) {
    case "time":
      if (currentSortBy === "newest") {
        return "desc";
      }
      if (currentSortBy === "oldest") {
        return "asc";
      }
      return null;
    case "score":
      if (currentSortBy === "score_desc") {
        return "desc";
      }
      if (currentSortBy === "score_asc") {
        return "asc";
      }
      return null;
    case "verdict":
      return currentSortBy === "verdict_priority" ? "priority" : null;
    case "review":
      return currentSortBy === "review_status_priority" ? "priority" : null;
    case "provider":
      return currentSortBy === "provider_asc" ? "asc" : null;
    case "model":
      return currentSortBy === "model_asc" ? "asc" : null;
    default:
      return null;
  }
}
