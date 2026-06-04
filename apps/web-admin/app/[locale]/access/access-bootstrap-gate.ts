import type { WorkspaceIdentityResolution } from "@/app/lib/console-api-contracts";

type WorkspaceIdentityState = {
  status: "idle" | "switching" | "failed" | "ready";
  workspaceId: string | null;
};

export function getAccessBootstrapGate(args: {
  workspaceId: string | null;
  shellSessionStatus: "loading" | "authenticated" | "unauthenticated";
  identityResolution: WorkspaceIdentityResolution | null;
  workspaceIdentityState: WorkspaceIdentityState;
}) {
  if (!args.workspaceId) {
    return "ready" as const;
  }

  if (args.shellSessionStatus === "loading") {
    return "loading_session" as const;
  }

  if (args.shellSessionStatus !== "authenticated") {
    return "ready" as const;
  }

  const identityResolution = args.identityResolution;
  const resolutionMatchesWorkspace =
    identityResolution?.workspaceId === args.workspaceId ||
    args.workspaceIdentityState.workspaceId === args.workspaceId;

  if (!identityResolution || identityResolution.status === "matched" || !resolutionMatchesWorkspace) {
    return "ready" as const;
  }

  if (args.workspaceIdentityState.status === "failed") {
    return "switch_failed" as const;
  }

  return "switching_identity" as const;
}
