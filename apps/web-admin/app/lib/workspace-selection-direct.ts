import {
  AuthSessionSchema,
  WorkspaceOptionSchema,
  type AuthSession,
  type WorkspaceOption,
} from "@teamops/contracts";

import { normalizeWorkspacePreferenceValue } from "./workspace-preference";

type WorkspaceSelectionStatus =
  | "selected"
  | "needs-selection"
  | "missing"
  | "invalid"
  | "unavailable";

type WorkspaceSelectionIssue = {
  kind: "missing-auth" | "invalid-selection" | "unavailable" | "unexpected";
  resource: "control-api" | "workspace-selection";
  message: string;
  path: string;
  status: number | null;
};

export type DirectWorkspaceSelectionState = {
  workspaceOptions: WorkspaceOption[];
  selectedWorkspaceId: string | null;
  selectionStatus: WorkspaceSelectionStatus;
  requestedWorkspaceId: string | null;
  issue: WorkspaceSelectionIssue | null;
};

function getControlApiBaseUrl() {
  return process.env.CONTROL_API_BASE_URL ?? process.env.NEXT_PUBLIC_CONTROL_API_BASE_URL ?? "http://127.0.0.1:4001";
}

async function fetchControlApiJson<T>(path: string, sessionHandle: string) {
  const response = await fetch(`${getControlApiBaseUrl()}${path}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-teamops-web-admin-auth": `session ${sessionHandle}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    return {
      ok: false as const,
      status: response.status,
      code: payload?.error?.code ?? null,
      message: payload?.error?.message ?? `Request failed with ${response.status}`,
    };
  }

  return {
    ok: true as const,
    data: (await response.json()) as T,
  };
}

export async function fetchAuthSessionDirect(sessionHandle: string): Promise<AuthSession | null> {
  const result = await fetchControlApiJson<unknown>("/v1/auth/session", sessionHandle);
  if (!result.ok) {
    return null;
  }

  return AuthSessionSchema.parse(result.data);
}

function createUnavailableSelection(args: {
  requestedWorkspaceId: string | null;
  message: string;
  status?: number | null;
}): DirectWorkspaceSelectionState {
  return {
    workspaceOptions: [],
    selectedWorkspaceId: null,
    selectionStatus: "unavailable",
    requestedWorkspaceId: args.requestedWorkspaceId,
    issue: {
      kind: "unavailable",
      resource: "control-api",
      message: args.message,
      path: "/v1/workspace-options",
      status: args.status ?? null,
    },
  };
}

export async function loadWorkspaceSelectionDirect(args: {
  sessionHandle: string | null;
  requestedWorkspaceId?: string | null;
  preferredWorkspaceId?: string | null;
}): Promise<DirectWorkspaceSelectionState> {
  const requestedWorkspaceId = normalizeWorkspacePreferenceValue(args.requestedWorkspaceId);
  const preferredWorkspaceId = normalizeWorkspacePreferenceValue(args.preferredWorkspaceId);

  if (!args.sessionHandle) {
    return {
      workspaceOptions: [],
      selectedWorkspaceId: null,
      selectionStatus: "unavailable",
      requestedWorkspaceId,
      issue: {
        kind: "missing-auth",
        resource: "control-api",
        message: "Authentication is required for this route",
        path: "/v1/workspace-options",
        status: 401,
      },
    };
  }

  const result = await fetchControlApiJson<{ items: unknown[] }>("/v1/workspace-options", args.sessionHandle);
  if (!result.ok) {
    return createUnavailableSelection({
      requestedWorkspaceId,
      message: result.message,
      status: result.status,
    });
  }

  const workspaceOptions = WorkspaceOptionSchema.array().parse(result.data.items);
  const workspaceIds = new Set(workspaceOptions.map((workspace) => workspace.id));

  if (requestedWorkspaceId && !workspaceIds.has(requestedWorkspaceId)) {
    return {
      workspaceOptions,
      selectedWorkspaceId: null,
      selectionStatus: workspaceOptions.length > 0 ? "invalid" : "missing",
      requestedWorkspaceId,
      issue: {
        kind: "invalid-selection",
        resource: "workspace-selection",
        message: "The requested workspace is unavailable for this session.",
        path: "/v1/workspace-options",
        status: null,
      },
    };
  }

  const selectedWorkspaceId =
    requestedWorkspaceId ??
    (preferredWorkspaceId && workspaceIds.has(preferredWorkspaceId) ? preferredWorkspaceId : null) ??
    workspaceOptions[0]?.id ??
    null;

  return {
    workspaceOptions,
    selectedWorkspaceId,
    selectionStatus: selectedWorkspaceId ? "selected" : workspaceOptions.length > 0 ? "needs-selection" : "missing",
    requestedWorkspaceId,
    issue: null,
  };
}
