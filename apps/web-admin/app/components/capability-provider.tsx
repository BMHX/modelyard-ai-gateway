"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import type {
  ConsoleBootstrapResponse,
  WorkspaceIdentityResolution,
} from "../lib/console-api-contracts";
import { postConsoleVoid, useConsoleBootstrapQuery } from "../lib/console-api-client";
import { stripLocalePrefix } from "../lib/i18n";
import { type Capabilities, EMPTY_CAPABILITIES } from "../lib/capabilities";

type WorkspaceIdentityState = {
  status: "idle" | "switching" | "failed" | "ready";
  workspaceId: string | null;
  selectedMembershipId: string | null;
  selectedRole: string | null;
  failureReason: "timeout" | "request_failed" | null;
};

type ShellSessionContextValue = {
  session: ConsoleBootstrapResponse | null;
  capabilities: Capabilities;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  workspaceIdentityState: WorkspaceIdentityState;
  retryWorkspaceIdentitySync: () => void;
};

const defaultWorkspaceIdentityState: WorkspaceIdentityState = {
  status: "idle",
  workspaceId: null,
  selectedMembershipId: null,
  selectedRole: null,
  failureReason: null,
};

const defaultValue: ShellSessionContextValue = {
  session: null,
  capabilities: EMPTY_CAPABILITIES,
  isLoading: true,
  isError: false,
  error: null,
  workspaceIdentityState: defaultWorkspaceIdentityState,
  retryWorkspaceIdentitySync: () => {},
};

const workspaceIdentitySyncTimeoutMs = 8_000;
const ShellSessionContext = createContext<ShellSessionContextValue>(defaultValue);

function resolutionToState(
  resolution: WorkspaceIdentityResolution | null | undefined,
  fallbackWorkspaceId: string | null,
): WorkspaceIdentityState {
  if (!resolution || resolution.status === "matched") {
    return {
      status: fallbackWorkspaceId ? "ready" : "idle",
      workspaceId: fallbackWorkspaceId,
      selectedMembershipId: resolution?.selectedMembershipId ?? null,
      selectedRole: resolution?.selectedRole ?? null,
      failureReason: null,
    };
  }

  return {
    status: resolution.status === "switch_failed" ? "failed" : "idle",
    workspaceId: resolution.workspaceId,
    selectedMembershipId: resolution.selectedMembershipId,
    selectedRole: resolution.selectedRole,
    failureReason: resolution.status === "switch_failed" ? "request_failed" : null,
  };
}

function hasSameWorkspaceIdentityTarget(
  state: WorkspaceIdentityState,
  resolution: WorkspaceIdentityResolution,
) {
  return (
    state.workspaceId === resolution.workspaceId &&
    state.selectedMembershipId === resolution.selectedMembershipId &&
    state.selectedRole === resolution.selectedRole
  );
}

export function CapabilityProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const normalizedPathname = stripLocalePrefix(pathname);
  const isAuthenticationPublicPath =
    normalizedPathname === "/login" || normalizedPathname.startsWith("/auth/");
  const requestedWorkspaceId = searchParams?.get("workspaceId")?.trim() || null;
  const bootstrapQuery = useConsoleBootstrapQuery({
    workspaceId: requestedWorkspaceId,
    enabled: !isAuthenticationPublicPath,
  });
  const shellSession = bootstrapQuery.data ?? null;
  const [workspaceIdentityState, setWorkspaceIdentityState] = useState<WorkspaceIdentityState>(
    defaultWorkspaceIdentityState,
  );
  const attemptedSyncKeysRef = useRef<Set<string>>(new Set());
  const identityResolution = shellSession?.workspace.identityResolution ?? null;
  const activeWorkspaceId = shellSession?.workspace.activeWorkspaceId ?? null;

  useEffect(() => {
    if (isAuthenticationPublicPath) {
      setWorkspaceIdentityState(defaultWorkspaceIdentityState);
      attemptedSyncKeysRef.current.clear();
      return;
    }

    if (bootstrapQuery.isPending) {
      return;
    }

    if (!identityResolution || identityResolution.status === "matched") {
      attemptedSyncKeysRef.current.clear();
      setWorkspaceIdentityState(
        resolutionToState(identityResolution, activeWorkspaceId),
      );
      return;
    }

    setWorkspaceIdentityState((current) => {
      if (current.status === "switching" && hasSameWorkspaceIdentityTarget(current, identityResolution)) {
        return current;
      }

      if (current.status === "failed" && hasSameWorkspaceIdentityTarget(current, identityResolution)) {
        return current;
      }

      return resolutionToState(identityResolution, activeWorkspaceId);
    });
  }, [
    activeWorkspaceId,
    bootstrapQuery.isPending,
    identityResolution,
    isAuthenticationPublicPath,
  ]);

  const runWorkspaceIdentitySync = useCallback(
    async (resolution: WorkspaceIdentityResolution, options?: { force?: boolean }) => {
      const targetKey = [
        resolution.workspaceId,
        resolution.selectedMembershipId,
        resolution.selectedRole,
      ].join(":");

      if (!options?.force && attemptedSyncKeysRef.current.has(targetKey)) {
        return;
      }

      attemptedSyncKeysRef.current.add(targetKey);
      setWorkspaceIdentityState({
        status: "switching",
        workspaceId: resolution.workspaceId,
        selectedMembershipId: resolution.selectedMembershipId,
        selectedRole: resolution.selectedRole,
        failureReason: null,
      });

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), workspaceIdentitySyncTimeoutMs);

      try {
        await postConsoleVoid(
          "/api/auth/session/active-identity",
          {
            membershipId: resolution.selectedMembershipId,
            role: resolution.selectedRole,
          },
          {
            signal: controller.signal,
          },
        );

        const refreshed = await bootstrapQuery.refetch();
        await queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === "console",
        });

        if (refreshed.data?.workspace.identityResolution.status === "matched") {
          setWorkspaceIdentityState({
            status: "ready",
            workspaceId: refreshed.data.workspace.activeWorkspaceId,
            selectedMembershipId:
              refreshed.data.workspace.identityResolution.selectedMembershipId,
            selectedRole: refreshed.data.workspace.identityResolution.selectedRole,
            failureReason: null,
          });
          router.refresh();
          return;
        }

        setWorkspaceIdentityState({
          status: "failed",
          workspaceId: resolution.workspaceId,
          selectedMembershipId: resolution.selectedMembershipId,
          selectedRole: resolution.selectedRole,
          failureReason: "request_failed",
        });
      } catch (error) {
        setWorkspaceIdentityState({
          status: "failed",
          workspaceId: resolution.workspaceId,
          selectedMembershipId: resolution.selectedMembershipId,
          selectedRole: resolution.selectedRole,
          failureReason:
            error instanceof DOMException && error.name === "AbortError"
              ? "timeout"
              : "request_failed",
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    [bootstrapQuery, queryClient, router],
  );

  useEffect(() => {
    if (
      isAuthenticationPublicPath ||
      bootstrapQuery.isPending ||
      shellSession?.auth.status !== "authenticated" ||
      !identityResolution ||
      identityResolution.status !== "switch_required" ||
      !identityResolution.selectedMembershipId ||
      !identityResolution.selectedRole ||
      workspaceIdentityState.status === "switching"
    ) {
      return;
    }

    void runWorkspaceIdentitySync(identityResolution);
  }, [
    bootstrapQuery.isPending,
    identityResolution,
    isAuthenticationPublicPath,
    runWorkspaceIdentitySync,
    shellSession?.auth.status,
    workspaceIdentityState.status,
  ]);

  const retryWorkspaceIdentitySync = useCallback(() => {
    if (
      !identityResolution ||
      identityResolution.status !== "switch_required" ||
      !identityResolution.selectedMembershipId ||
      !identityResolution.selectedRole
    ) {
      return;
    }

    const targetKey = [
      identityResolution.workspaceId,
      identityResolution.selectedMembershipId,
      identityResolution.selectedRole,
    ].join(":");
    attemptedSyncKeysRef.current.delete(targetKey);
    void runWorkspaceIdentitySync(identityResolution, { force: true });
  }, [identityResolution, runWorkspaceIdentitySync]);

  const value = useMemo<ShellSessionContextValue>(
    () => ({
      session: shellSession,
      capabilities: shellSession?.capabilities ?? EMPTY_CAPABILITIES,
      isLoading: !isAuthenticationPublicPath && bootstrapQuery.isPending,
      isError: bootstrapQuery.isError,
      error: bootstrapQuery.error instanceof Error ? bootstrapQuery.error : null,
      workspaceIdentityState,
      retryWorkspaceIdentitySync,
    }),
    [
      bootstrapQuery.error,
      bootstrapQuery.isError,
      bootstrapQuery.isPending,
      isAuthenticationPublicPath,
      retryWorkspaceIdentitySync,
      shellSession,
      workspaceIdentityState,
    ],
  );

  return <ShellSessionContext.Provider value={value}>{children}</ShellSessionContext.Provider>;
}

export function useShellSession() {
  return useContext(ShellSessionContext);
}

export function useCapabilities() {
  return useShellSession().capabilities;
}
