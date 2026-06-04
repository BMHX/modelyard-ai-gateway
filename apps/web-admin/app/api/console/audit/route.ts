import { NextRequest, NextResponse } from "next/server";
import type { AuditLog } from "@teamops/contracts";

import {
  diagnoseControlApiIssue,
  listAuditLogs,
  listProjects,
  listWorkspaceEnvironments,
  loadSavedViewsState,
  loadWorkspaceSelectionWithOptimisticData,
  pickFirstControlApiIssue,
} from "@/app/lib/control-api";
import {
  buildWorkspaceScopedConsoleResponse,
  serializeConsoleIssue,
} from "@/app/lib/console-api-server";
import { getUserErrorMessage } from "@/app/lib/user-facing-error";

const defaultPageSize = 50;

function getOptionalFilter(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
        audit: {
          items: [],
          total: 0,
        },
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
      "Can't load activity history right now.",
    );
  }

  const rawProjectId = getOptionalFilter(searchParams.get("projectId"));
  const selectedProjectId =
    rawProjectId && projects.some((project) => project.id === rawProjectId)
      ? rawProjectId
      : null;
  const filteredEnvironmentOptions = selectedProjectId
    ? environments.filter((environment) => environment.projectId === selectedProjectId)
    : environments;
  const rawEnvironmentId = getOptionalFilter(searchParams.get("environmentId"));
  const selectedEnvironmentId =
    rawEnvironmentId &&
    filteredEnvironmentOptions.some((environment) => environment.id === rawEnvironmentId)
      ? rawEnvironmentId
      : null;
  const actorType = getOptionalFilter(searchParams.get("actorType"));
  const actorId = getOptionalFilter(searchParams.get("actorId"));
  const action = getOptionalFilter(searchParams.get("action"));
  const subjectType = getOptionalFilter(searchParams.get("subjectType"));
  const subjectId = getOptionalFilter(searchParams.get("subjectId"));
  const from = getOptionalFilter(searchParams.get("from"));
  const to = getOptionalFilter(searchParams.get("to"));
  const offset = parseOffset(searchParams.get("offset"));

  let audit: {
    items: AuditLog[];
    total: number;
  } = {
    items: [],
    total: 0,
  };

  if (!loadError) {
    try {
      audit = await listAuditLogs({
        workspaceId: workspaceSelection.selectedWorkspaceId,
        projectId: selectedProjectId,
        environmentId: selectedEnvironmentId,
        actorType,
        actorId,
        action,
        subjectType,
        subjectId,
        from,
        to,
        limit: defaultPageSize,
        offset,
      });
    } catch (error) {
      issue = pickFirstControlApiIssue(
        issue,
        diagnoseControlApiIssue(error),
      );
      loadError = getUserErrorMessage(error, "Can't load activity history right now.");
    }
  }

  const savedViewState = await loadSavedViewsState(
    workspaceSelection.selectedWorkspaceId,
    "audit-logs",
  );

  return NextResponse.json(
    {
      ...buildWorkspaceScopedConsoleResponse({
        ...workspaceSelection,
        issue,
      }),
      projects,
      environments,
      audit,
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
