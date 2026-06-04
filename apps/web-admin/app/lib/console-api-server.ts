import type {
  WorkspaceOption,
  UsageEventSummary,
} from "@teamops/contracts";

import type {
  ConsoleBootstrapResponse,
  ConsoleIssue,
  ConsoleSelectionStatus,
  WorkspaceIdentityResolution,
  WorkspaceScopedConsoleResponse,
} from "./console-api-contracts";
import type { ControlApiIssue, WorkspaceSelectionState } from "./control-api";
import {
  diagnoseControlApiIssue,
  fetchAuthIdentityOptions,
  fetchAuthSession,
  getWorkspaceHomeOverviewPermissions,
  loadWorkspaceSelection,
} from "./control-api";
import { resolveWorkspaceIdentitySelection } from "./auth-identities";
import { EMPTY_CAPABILITIES, getCapabilitiesFromPermissions } from "./capabilities";
import {
  normalizeWorkspacePreferenceValue,
  workspacePreferenceCookieName,
} from "./workspace-preference";

export function serializeConsoleIssue(issue: ControlApiIssue | null): ConsoleIssue | null {
  if (!issue) {
    return null;
  }

  return {
    kind: issue.kind,
    resource: issue.resource,
    message: issue.message,
    path: issue.path,
    status: issue.status ?? null,
  };
}

export function getWorkspacePreferenceFromCookieHeader(cookieHeader: string | null | undefined) {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${workspacePreferenceCookieName}=([^;]+)`),
  );

  if (!match?.[1]) {
    return null;
  }

  try {
    return normalizeWorkspacePreferenceValue(decodeURIComponent(match[1]));
  } catch {
    return normalizeWorkspacePreferenceValue(match[1]);
  }
}

function isAuthenticationIssue(issue: ControlApiIssue | null) {
  return issue?.kind === "missing-auth";
}

function resolveWorkspaceIdentityResolution(args: {
  selectedWorkspaceId: string | null;
  identities: ConsoleBootstrapResponse["identities"];
  activeMembershipId: string | null;
  activeRole: string | null;
}): WorkspaceIdentityResolution {
  const selection = resolveWorkspaceIdentitySelection({
    identities: args.identities,
    targetWorkspaceId: args.selectedWorkspaceId,
    activeMembershipId: args.activeMembershipId,
    activeRole: args.activeRole,
  });

  if (!selection?.needsSwitch) {
    return {
      status: "matched",
      workspaceId: args.selectedWorkspaceId,
      selectedMembershipId: selection?.selectedMembershipId ?? null,
      selectedRole: selection?.selectedRole ?? null,
    };
  }

  return {
    status: "switch_required",
    workspaceId: selection.workspaceId,
    selectedMembershipId: selection.selectedMembershipId,
    selectedRole: selection.selectedRole,
  };
}

export async function buildConsoleBootstrapResponse(args: {
  requestedWorkspaceId?: string | null;
  preferredWorkspaceId?: string | null;
}): Promise<ConsoleBootstrapResponse> {
  const preferredWorkspaceId = normalizeWorkspacePreferenceValue(args.preferredWorkspaceId);
  const requestedWorkspaceId = normalizeWorkspacePreferenceValue(args.requestedWorkspaceId);
  const selection = await loadWorkspaceSelection(requestedWorkspaceId ?? preferredWorkspaceId);

  const [sessionResult, identitiesResult] = await Promise.allSettled([
    fetchAuthSession(),
    fetchAuthIdentityOptions(),
  ]);

  const sessionIssue =
    sessionResult.status === "rejected" ? diagnoseControlApiIssue(sessionResult.reason) : null;
  const identitiesIssue =
    identitiesResult.status === "rejected" ? diagnoseControlApiIssue(identitiesResult.reason) : null;
  const session = sessionResult.status === "fulfilled" ? sessionResult.value : null;
  const identities =
    identitiesResult.status === "fulfilled" && session ? identitiesResult.value : [];
  const activeMembershipId = session?.activeMembershipId ?? null;
  const activeRole = session?.activeRole ?? null;
  const identityResolution = resolveWorkspaceIdentityResolution({
    selectedWorkspaceId: selection.selectedWorkspaceId ?? null,
    identities,
    activeMembershipId,
    activeRole,
  });
  const permissionsResult =
    session &&
    selection.selectedWorkspaceId &&
    identityResolution.status === "matched"
      ? await Promise.allSettled([
          getWorkspaceHomeOverviewPermissions(selection.selectedWorkspaceId),
        ]).then((results) => results[0] ?? { status: "fulfilled", value: null as null })
      : ({
          status: "fulfilled",
          value: null,
        } as const);
  const permissionsIssue =
    permissionsResult.status === "rejected" ? diagnoseControlApiIssue(permissionsResult.reason) : null;
  const permissions = permissionsResult.status === "fulfilled" ? permissionsResult.value : null;
  const capabilities = getCapabilitiesFromPermissions(permissions);
  const authStatus = session ? "authenticated" : "unauthenticated";
  const issues = [
    serializeConsoleIssue(selection.issue),
    isAuthenticationIssue(sessionIssue) ? null : serializeConsoleIssue(sessionIssue),
    isAuthenticationIssue(identitiesIssue) ? null : serializeConsoleIssue(identitiesIssue),
    isAuthenticationIssue(permissionsIssue) ? null : serializeConsoleIssue(permissionsIssue),
  ].filter((issue): issue is ConsoleIssue => issue !== null);
  const user = session
    ? {
        id: session.operatorId,
        email: session.email,
        name: session.name,
      }
    : null;
  const activeWorkspaceId = identityResolution.status !== "matched"
    ? null
    : selection.selectedWorkspaceId ?? preferredWorkspaceId ?? null;

  return {
    auth: {
      status: authStatus,
      user,
      activeMembershipId,
      activeRole,
    },
    identities,
    workspace: {
      requestedWorkspaceId,
      activeWorkspaceId,
      options: selection.workspaceOptions,
      selectionStatus: selection.selectionStatus,
      identityResolution,
    },
    capabilities: session ? capabilities : EMPTY_CAPABILITIES,
    selectionStatus: selection.selectionStatus,
    issues,
    user,
    activeMembershipId,
    activeRole,
    workspaceOptions: selection.workspaceOptions,
    preferredWorkspaceId: selection.selectedWorkspaceId ?? preferredWorkspaceId ?? null,
  };
}

export function buildWorkspaceScopedConsoleResponse(
  selection: WorkspaceSelectionState,
): WorkspaceScopedConsoleResponse {
  return {
    workspaceOptions: selection.workspaceOptions,
    selectedWorkspaceId: selection.selectedWorkspaceId,
    selectionStatus: selection.selectionStatus as ConsoleSelectionStatus,
    issue: serializeConsoleIssue(selection.issue),
  };
}

export function getConsoleIssueList(issue: ControlApiIssue | null) {
  return [serializeConsoleIssue(issue)].filter((entry): entry is ConsoleIssue => entry !== null);
}

export const emptyUsageSummary: UsageEventSummary = {
  totalEvents: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  averageLatencyMs: null,
  successRate: null,
  statusBreakdown: [],
  providerBreakdown: [],
  modelBreakdown: [],
};

export function findWorkspaceLabel(
  workspaceOptions: WorkspaceOption[],
  workspaceId: string | null,
) {
  if (!workspaceId) {
    return null;
  }

  const workspace = workspaceOptions.find((item) => item.id === workspaceId);
  return workspace ? `${workspace.organizationName} / ${workspace.name}` : null;
}
