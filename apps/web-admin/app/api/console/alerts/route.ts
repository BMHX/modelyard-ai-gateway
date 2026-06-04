import { NextRequest, NextResponse } from "next/server";
import type { Alert, Environment, Project } from "@teamops/contracts";

import {
  diagnoseControlApiIssue,
  listAlerts,
  listProjects,
  listWorkspaceEnvironments,
  loadWorkspaceSelectionWithOptimisticData,
  pickFirstControlApiIssue,
} from "@/app/lib/control-api";
import {
  buildWorkspaceScopedConsoleResponse,
  serializeConsoleIssue,
} from "@/app/lib/console-api-server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getOptionalFilter(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getOptionalUuidFilter(value: string | null) {
  const normalized = getOptionalFilter(value);
  return normalized && uuidPattern.test(normalized) ? normalized : null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requestedWorkspaceId = getOptionalFilter(searchParams.get("workspaceId"));
  const workspaceSelection = await loadWorkspaceSelectionWithOptimisticData(
    requestedWorkspaceId,
    async (workspaceId) =>
      Promise.all([
        listProjects(workspaceId),
        listWorkspaceEnvironments(workspaceId),
        listAlerts({
          workspaceId,
        }),
      ]),
  );

  let alertsIssue = workspaceSelection.issue;

  if (!workspaceSelection.selectedWorkspaceId) {
    return NextResponse.json(
      {
        ...buildWorkspaceScopedConsoleResponse(workspaceSelection),
        projects: [],
        environments: [],
        allAlerts: [],
        alerts: [],
        alertsIssue: serializeConsoleIssue(alertsIssue),
      },
      {
        headers: {
          "cache-control": "private, no-store, max-age=0",
        },
      },
    );
  }

  let projects: Project[] = [];
  let environments: Environment[] = [];
  let allAlerts: Alert[] = [];

  if (workspaceSelection.dataResult?.ok) {
    [projects, environments, allAlerts] = workspaceSelection.dataResult.data;
  } else if (workspaceSelection.dataResult) {
    alertsIssue = pickFirstControlApiIssue(
      alertsIssue,
      diagnoseControlApiIssue(workspaceSelection.dataResult.error),
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
  const status = searchParams.get("status");
  const severity = searchParams.get("severity");
  const code = getOptionalFilter(searchParams.get("code"));
  const budgetPolicyId = getOptionalUuidFilter(searchParams.get("budgetPolicyId"));
  const hasScopedFilters = Boolean(
    selectedProjectId || selectedEnvironmentId || status || severity || code || budgetPolicyId,
  );

  let alerts = allAlerts;

  if (hasScopedFilters) {
    try {
      alerts = await listAlerts({
        workspaceId: workspaceSelection.selectedWorkspaceId,
        projectId: selectedProjectId ?? undefined,
        environmentId: selectedEnvironmentId ?? undefined,
        status: status === "open" || status === "resolved" ? status : undefined,
        severity:
          severity === "info" || severity === "warning" || severity === "critical"
            ? severity
            : undefined,
        code: code ?? undefined,
        budgetPolicyId: budgetPolicyId ?? undefined,
      });
    } catch (error) {
      alertsIssue = pickFirstControlApiIssue(
        alertsIssue,
        diagnoseControlApiIssue(error),
      );
      alerts = [];
    }
  }

  return NextResponse.json(
    {
      ...buildWorkspaceScopedConsoleResponse({
        ...workspaceSelection,
        issue: alertsIssue,
      }),
      projects,
      environments,
      allAlerts,
      alerts,
      alertsIssue: serializeConsoleIssue(alertsIssue),
    },
    {
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    },
  );
}
