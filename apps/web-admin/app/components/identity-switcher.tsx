"use client";

import { useState } from "react";
import { ChevronDown, Code, Shield, User } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import type { ConsoleBootstrapResponse } from "@/app/lib/console-api-contracts";
import {
  fetchConsoleBootstrap,
  getConsoleBootstrapQueryKey,
} from "@/app/lib/console-api-client";
import { canAccessConsoleRoute } from "@/app/lib/route-access";
import { usePathLocale, useT } from "@/app/lib/i18n-client";
import { translateInlineText } from "@/app/lib/i18n";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { EMPTY_CAPABILITIES } from "@/app/lib/capabilities";
import { getActiveIdentity, getVisibleIdentityRoleOptions } from "./identity-switcher-state";

import {
  DropdownMenu as Dropdown,
  DropdownMenuContent as Content,
  DropdownMenuItem as Item,
  DropdownMenuLabel as Label,
  DropdownMenuSeparator as Separator,
  DropdownMenuTrigger as Trigger,
} from "@/components/ui/dropdown-menu";

type IdentitySwitcherProps = {
  shellSession: ConsoleBootstrapResponse | null;
  currentPathname: string;
  currentWorkspaceId: string | null;
  isLoading: boolean;
  isError: boolean;
};

export function IdentitySwitcher({
  shellSession,
  currentPathname,
  currentWorkspaceId,
  isLoading,
  isError,
}: IdentitySwitcherProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useT("shell");
  const locale = usePathLocale();
  const [isSwitching, setIsSwitching] = useState(false);

  const auth = shellSession?.auth ?? null;
  const identities = shellSession?.identities ?? [];
  const activeMembershipId = auth?.activeMembershipId ?? null;
  const activeRole = auth?.activeRole ?? null;
  const authStatus = auth?.status ?? "unauthenticated";

  function formatRoleLabel(role: string) {
    switch (role) {
      case "developer":
        return locale === "zh" ? translateInlineText(locale, "developer") : "Developer";
      case "workspace_admin":
        return locale === "zh" ? "工作区管理员" : "Workspace admin";
      case "organization_owner":
        return locale === "zh" ? "组织所有者" : "Organization owner";
      default:
        return locale === "zh" ? translateInlineText(locale, "admin") : "Admin";
    }
  }

  const visibleRoleOptions = getVisibleIdentityRoleOptions({
    identities,
    currentWorkspaceId,
    activeMembershipId,
  });
  const activeIdentity = getActiveIdentity({
    identities,
    visibleRoleOptions,
    activeMembershipId,
    activeRole,
  });
  const hasWorkspaceContext = Boolean(currentWorkspaceId);
  const resolvedActiveRole = activeRole ?? activeIdentity?.roles[0] ?? null;
  const activeRoleLabel =
    isLoading && !shellSession
      ? "Syncing session"
      : isError && !shellSession
        ? "Session unavailable"
        : hasWorkspaceContext && !visibleRoleOptions.length && !activeIdentity
          ? t("No permission")
          : resolvedActiveRole
            ? formatRoleLabel(resolvedActiveRole)
            : t("No permission");

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "workspace_admin":
      case "organization_owner":
        return <Shield className="size-3.5" />;
      case "developer":
        return <Code className="size-3.5" />;
      default:
        return <Shield className="size-3.5" />;
    }
  };

  async function handleSwitch(membershipId: string, role: string) {
    if (
      authStatus !== "authenticated" ||
      isSwitching ||
      (membershipId === activeMembershipId && role === activeRole)
    ) {
      return;
    }

    setIsSwitching(true);
    try {
      const response = await fetch("/api/auth/session/active-identity", {
        method: "POST",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          membershipId,
          role,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to switch identity: ${response.status}`);
      }

      const nextSession = await queryClient.fetchQuery({
        queryKey: getConsoleBootstrapQueryKey(currentWorkspaceId),
        queryFn: () => fetchConsoleBootstrap(currentWorkspaceId),
        staleTime: 0,
      });

      await queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === "console" &&
          !(
            query.queryKey[1] === "bootstrap" &&
            query.queryKey[2] === (currentWorkspaceId ?? null)
          ),
      });

      const nextActiveWorkspaceId = nextSession.workspace.activeWorkspaceId;
      const nextPathnameAccessible = canAccessConsoleRoute(
        currentPathname,
        nextSession.capabilities ?? EMPTY_CAPABILITIES,
      );

      if (!currentWorkspaceId || nextActiveWorkspaceId !== currentWorkspaceId) {
        router.replace("/workspaces");
        router.refresh();
        return;
      }

      if (!nextPathnameAccessible) {
        router.replace({
          pathname: "/",
          query: { workspaceId: currentWorkspaceId },
        });
        router.refresh();
        return;
      }

      router.refresh();
    } catch (error) {
      console.error("Failed to switch identity", error);
    } finally {
      setIsSwitching(false);
    }
  }

  return (
    <Dropdown>
      <Trigger asChild>
        <button
          className="flex items-center gap-2 rounded-lg border border-border/40 bg-surface-2 px-3 py-1.5 text-sm font-medium transition-all hover:bg-surface-selected focus:outline-none"
          disabled={authStatus !== "authenticated" || isSwitching}
          type="button"
        >
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
            {resolvedActiveRole ? getRoleIcon(resolvedActiveRole) : <User className="size-3" />}
          </div>
          <div className="flex flex-col items-start leading-tight">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("Permissions")}
            </span>
            <span className="max-w-[120px] truncate text-xs">
              {activeRoleLabel}
            </span>
          </div>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </Trigger>
      <Content align="start" className="w-64">
        <Label>{hasWorkspaceContext ? t("Switch permission") : t("Switch identity")}</Label>
        <Separator />
        <div className="max-h-[300px] overflow-y-auto py-1">
          {authStatus !== "authenticated" ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              {isLoading ? "Syncing session" : isError ? "Session unavailable" : t("No permission")}
            </div>
          ) : visibleRoleOptions.length ? (
            visibleRoleOptions.map(({ identity, role }) => {
              const isActive =
                identity.membershipId === activeMembershipId && role === resolvedActiveRole;
              const showWorkspaceName =
                !currentWorkspaceId || identity.workspaceId !== currentWorkspaceId;

              return (
                <Item
                  key={`${identity.membershipId}-${role}`}
                  className={cn(
                    "flex flex-col items-start gap-0.5 px-3 py-2",
                    isActive && "bg-surface-selected",
                  )}
                  onSelect={() => void handleSwitch(identity.membershipId, role)}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-medium text-foreground">{formatRoleLabel(role)}</span>
                    {isActive ? <div className="size-1.5 rounded-full bg-primary" /> : null}
                  </div>
                  {showWorkspaceName ? (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      <span>{identity.workspaceName}</span>
                    </div>
                  ) : null}
                </Item>
              );
            })
          ) : (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              {t("No permission")}
            </div>
          )}
        </div>
        {isSwitching ? (
          <>
            <Separator />
            <div className="flex items-center justify-center py-2">
              <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          </>
        ) : null}
      </Content>
    </Dropdown>
  );
}
