"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppShell } from "../components/app-shell";
import { useShellSession } from "../components/capability-provider";
import { useProvidersPageQuery } from "../lib/console-api-client";
import { useT } from "../lib/i18n-client";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import { ProvidersWorkspaceView } from "./providers-workspace-view";

type ProviderConnectionViewFilter = "all" | "ready" | "attention" | "revoked";
type ProviderKindFilter = "all" | "anthropic" | "openai" | "openai-compatible";

function parseConnectionViewFilter(
  value: string | undefined,
): ProviderConnectionViewFilter {
  return value === "ready" || value === "attention" || value === "revoked"
    ? value
    : "all";
}

function parseProviderKindFilter(
  value: string | undefined,
): ProviderKindFilter {
  return value === "anthropic" ||
    value === "openai" ||
    value === "openai-compatible"
    ? value
    : "all";
}

function buildProvidersHref(args: {
  workspaceId?: string | null;
  q?: string | null;
  view?: ProviderConnectionViewFilter;
  kind?: ProviderKindFilter;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();

  if (args.workspaceId) {
    params.set("workspaceId", args.workspaceId);
  }

  if (args.q?.trim()) {
    params.set("q", args.q.trim());
  }

  if (args.view && args.view !== "all") {
    params.set("view", args.view);
  }

  if (args.kind && args.kind !== "all") {
    params.set("kind", args.kind);
  }

  const href = params.toString()
    ? `/providers?${params.toString()}`
    : "/providers";
  return buildContextualHref(href, args.returnTo);
}

export default function ProvidersPage() {
  const [hasMounted, setHasMounted] = useState(false);
  const tr = useT("providers");
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const requestedWorkspaceId = searchParams.get("workspaceId");
  const returnTo = getSafeReturnTo(searchParams.get("returnTo"));
  const connectionSearchQuery = searchParams.get("q")?.trim() ?? "";
  const connectionViewFilter = parseConnectionViewFilter(
    searchParams.get("view") ?? undefined,
  );
  const providerKindFilter = parseProviderKindFilter(searchParams.get("kind") ?? undefined);
  useEffect(() => {
    setHasMounted(true);
  }, []);
  const shellSession = useShellSession();
  const providersQuery = useProvidersPageQuery({
    workspaceId: requestedWorkspaceId,
  });
  const response = providersQuery.data;
  const selectedWorkspaceId = response?.selectedWorkspaceId ?? null;
  const selectedWorkspace = useMemo(
    () =>
      selectedWorkspaceId
        ? response?.workspaceOptions.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
        : null,
    [response?.workspaceOptions, selectedWorkspaceId],
  );
  const providerConnections = response?.providerConnections ?? [];
  const providersIssue = response?.issue ?? null;
  const selectionStatus = response?.selectionStatus ?? "needs-selection";

  const providersHref = buildProvidersHref({
    workspaceId: selectedWorkspaceId,
    q: connectionSearchQuery,
    view: connectionViewFilter,
    kind: providerKindFilter,
    returnTo,
  });
  const hasInvalidWorkspaceSelection =
    selectionStatus === "invalid" ||
    providersIssue?.resource === "workspace-selection";
  const identitySwitchInProgress =
    shellSession.session?.workspace.identityResolution.status === "switch_required" ||
    shellSession.workspaceIdentityState.status === "switching";
  const identitySwitchFailed =
    shellSession.workspaceIdentityState.status === "failed" &&
    shellSession.workspaceIdentityState.workspaceId === selectedWorkspaceId;
  const hasInventoryIssue = Boolean(selectedWorkspaceId && providersIssue);
  const primaryStateAction = hasInventoryIssue
    ? {
        label: tr("primaryState.retryInventory"),
        href: providersHref,
      }
    : null;
  const showPrimaryState =
    !identitySwitchInProgress &&
    !identitySwitchFailed &&
    (!selectedWorkspaceId || Boolean(providersIssue));
  const primaryStateTitle = hasInvalidWorkspaceSelection
    ? tr("primaryState.workspaceUnavailableTitle")
    : hasInventoryIssue
      ? tr("primaryState.inventoryUnavailableTitle")
      : tr("primaryState.workspaceRequiredTitle");
  const primaryStateMessage = hasInvalidWorkspaceSelection
    ? tr("primaryState.workspaceUnavailableMessage")
    : hasInventoryIssue
      ? tr("primaryState.inventoryUnavailableMessage")
      : tr("primaryState.workspaceRequiredMessage");

  return (
    <AppShell
      headerMode="compact"
      showOperatorContextCards={false}
      showSupportPanels={false}
      sidebarVariant="minimal"
      title={tr("Providers")}
      subtitle=""
      workspaceId={selectedWorkspaceId}
      workspaceOptions={
        response?.workspaceOptions.map((workspace) => ({
          id: workspace.id,
          label: `${workspace.organizationName} / ${workspace.name}`,
        })) ?? undefined
      }
      workspaceLabel={
        selectedWorkspace
          ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}`
          : null
      }
    >
      <section className="space-y-4">
        {!hasMounted || (providersQuery.isLoading && !response) ? (
          <section className="rounded-lg border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-5">
            <div className="space-y-2">
              <div className="h-4 w-28 animate-pulse rounded-full bg-foreground/10" />
              <div className="h-3.5 w-72 max-w-full animate-pulse rounded-full bg-foreground/8" />
            </div>
          </section>
        ) : null}
        {showPrimaryState ? (
          <section className="rounded-lg border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  {primaryStateTitle}
                </p>
                <p className="text-sm text-muted-foreground">
                  {primaryStateMessage}
                </p>
              </div>

              {primaryStateAction ? (
                <a className="button" href={primaryStateAction.href}>
                  {primaryStateAction.label}
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        {selectedWorkspaceId &&
        !providersIssue &&
        !identitySwitchInProgress &&
        !identitySwitchFailed ? (
          <ProvidersWorkspaceView
            initialConnectionSearchQuery={connectionSearchQuery}
            initialConnectionViewFilter={connectionViewFilter}
            initialProviderConnections={providerConnections}
            initialProviderKindFilter={providerKindFilter}
            pageHref={providersHref}
            workspaceId={selectedWorkspaceId}
            workspaceLabel={
              selectedWorkspace
                ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}`
                : null
            }
          />
        ) : null}
      </section>
    </AppShell>
  );
}
