import { NextRequest, NextResponse } from "next/server";

import {
  diagnoseControlApiIssue,
  getUsageEventSummary,
  listProjects,
  listUsageEvents,
  listWorkspaceEnvironments,
  loadSavedViewsState,
  loadWorkspaceSelectionWithOptimisticData,
  pickFirstControlApiIssue,
} from "@/app/lib/control-api";
import {
  buildWorkspaceScopedConsoleResponse,
  emptyUsageSummary,
  serializeConsoleIssue,
} from "@/app/lib/console-api-server";
import { getUserErrorMessage } from "@/app/lib/user-facing-error";

const providerOptions = ["anthropic", "openai", "openai-compatible", "bedrock", "vertex"] as const;
const statusOptions = ["success", "error", "blocked"] as const;
const surfaceOptions = ["metadata", "streamed", "interrupted"] as const;
const sortOptions = ["newest", "oldest", "latency_desc", "cost_desc", "tokens_desc"] as const;
const defaultPageSize = 25;

function getOptionalFilter(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseNonNegativeInteger(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function parseOffset(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requestedWorkspaceId = getOptionalFilter(searchParams.get("workspaceId"));
  const workspaceSelection = await loadWorkspaceSelectionWithOptimisticData(
    requestedWorkspaceId,
    async (workspaceId) => Promise.all([listProjects(workspaceId), listWorkspaceEnvironments(workspaceId)]),
  );

  if (!workspaceSelection.selectedWorkspaceId) {
    return NextResponse.json(
      {
        ...buildWorkspaceScopedConsoleResponse(workspaceSelection),
        projects: [],
        environments: [],
        usage: {
          items: [],
          total: 0,
        },
        summary: emptyUsageSummary,
        savedViews: [],
        savedViewsIssue: null,
        loadError: null,
      },
      {
        headers: {
          "cache-control": "private, no-store, max-age=0",
        },
      },
    );
  }

  let issue = workspaceSelection.issue;
  let loadError: string | null = null;
  let projects = [] as Awaited<ReturnType<typeof listProjects>>;
  let environments = [] as Awaited<ReturnType<typeof listWorkspaceEnvironments>>;

  if (workspaceSelection.dataResult?.ok) {
    [projects, environments] = workspaceSelection.dataResult.data;
  } else if (workspaceSelection.dataResult) {
    issue = pickFirstControlApiIssue(
      issue,
      diagnoseControlApiIssue(workspaceSelection.dataResult.error),
    );
    loadError = getUserErrorMessage(
      workspaceSelection.dataResult.error,
      "Can't load usage right now.",
    );
  }

  const rawProjectId = getOptionalFilter(searchParams.get("projectId"));
  const selectedProjectId =
    rawProjectId && projects.some((project) => project.id === rawProjectId)
      ? rawProjectId
      : null;
  const rawEnvironmentId = getOptionalFilter(searchParams.get("environmentId"));
  const filteredEnvironmentOptions = selectedProjectId
    ? environments.filter((environment) => environment.projectId === selectedProjectId)
    : environments;
  const selectedEnvironmentId =
    rawEnvironmentId &&
    filteredEnvironmentOptions.some((environment) => environment.id === rawEnvironmentId)
      ? rawEnvironmentId
      : null;
  const rawProvider = getOptionalFilter(searchParams.get("provider"));
  const provider =
    rawProvider && providerOptions.includes(rawProvider as (typeof providerOptions)[number])
      ? (rawProvider as (typeof providerOptions)[number])
      : null;
  const rawOutcome = getOptionalFilter(searchParams.get("outcome"));
  const rawStatus = getOptionalFilter(searchParams.get("status"));
  const rawStatusGroup = getOptionalFilter(searchParams.get("statusGroup"));
  const outcome =
    rawOutcome === "attention" || rawStatusGroup === "attention"
      ? "attention"
      : rawOutcome && statusOptions.includes(rawOutcome as (typeof statusOptions)[number])
        ? (rawOutcome as (typeof statusOptions)[number])
        : rawStatus && statusOptions.includes(rawStatus as (typeof statusOptions)[number])
          ? (rawStatus as (typeof statusOptions)[number])
          : null;
  const status = outcome && outcome !== "attention" ? outcome : null;
  const statusGroup = outcome === "attention" ? "attention" : null;
  const rawSurface = getOptionalFilter(searchParams.get("surface"));
  const surface =
    rawSurface && surfaceOptions.includes(rawSurface as (typeof surfaceOptions)[number])
      ? (rawSurface as (typeof surfaceOptions)[number])
      : null;
  const rawSortBy = getOptionalFilter(searchParams.get("sortBy"));
  const sortBy =
    rawSortBy && rawSortBy !== "newest" && sortOptions.includes(rawSortBy as (typeof sortOptions)[number])
      ? (rawSortBy as (typeof sortOptions)[number])
      : null;
  const virtualKeyId = getOptionalFilter(searchParams.get("virtualKeyId"));
  const providerConnectionId = getOptionalFilter(searchParams.get("providerConnectionId"));
  const budgetPolicyId = getOptionalFilter(searchParams.get("budgetPolicyId"));
  const model = getOptionalFilter(searchParams.get("model"));
  const requestId = getOptionalFilter(searchParams.get("requestId"));
  const providerRequestId = getOptionalFilter(searchParams.get("providerRequestId"));
  const minLatencyMs = parseNonNegativeInteger(searchParams.get("minLatencyMs"));
  const from = getOptionalFilter(searchParams.get("from"));
  const to = getOptionalFilter(searchParams.get("to"));
  const offset = parseOffset(searchParams.get("offset"));

  let usage: Awaited<ReturnType<typeof listUsageEvents>> = {
    items: [],
    total: 0,
  };
  let summary = emptyUsageSummary;

  if (!loadError) {
    try {
      [usage, summary] = await Promise.all([
        listUsageEvents(workspaceSelection.selectedWorkspaceId, {
          projectId: selectedProjectId,
          environmentId: selectedEnvironmentId,
          virtualKeyId,
          providerConnectionId,
          budgetPolicyId,
          provider: provider ?? undefined,
          model,
          requestId,
          providerRequestId,
          status: status ?? undefined,
          statusGroup: statusGroup ?? undefined,
          surface: surface ?? undefined,
          minLatencyMs: minLatencyMs ?? undefined,
          sortBy: sortBy ?? undefined,
          from,
          to,
          limit: defaultPageSize,
          offset,
        }),
        getUsageEventSummary({
          workspaceId: workspaceSelection.selectedWorkspaceId,
          projectId: selectedProjectId,
          environmentId: selectedEnvironmentId,
          virtualKeyId,
          providerConnectionId,
          budgetPolicyId,
          provider,
          model,
          requestId,
          providerRequestId,
          status,
          statusGroup,
          surface,
          minLatencyMs,
          from,
          to,
        }),
      ]);
    } catch (error) {
      issue = pickFirstControlApiIssue(
        issue,
        diagnoseControlApiIssue(error),
      );
      loadError = getUserErrorMessage(error, "Can't load usage right now.");
    }
  }

  const savedViewState = await loadSavedViewsState(
    workspaceSelection.selectedWorkspaceId,
    "usage-events",
  );

  return NextResponse.json(
    {
      ...buildWorkspaceScopedConsoleResponse({
        ...workspaceSelection,
        issue,
      }),
      projects,
      environments,
      usage,
      summary,
      savedViews: savedViewState.items,
      savedViewsIssue: serializeConsoleIssue(savedViewState.issue),
      loadError,
    },
    {
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    },
  );
}
