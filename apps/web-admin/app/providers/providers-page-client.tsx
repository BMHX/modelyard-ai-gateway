"use client";

import { EmptyState } from "@/components/shared/empty-state";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppShell } from "../components/app-shell";
import { useProvidersPageQuery } from "../lib/console-api-client";
import { useT } from "../lib/i18n-client";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import { ProvidersWorkspaceView } from "./providers-workspace-view";
import { MotionDiv } from "@/app/components/client-motion";

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

export function ProvidersPageClient() {
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
  const hasInventoryIssue = Boolean(selectedWorkspaceId && providersIssue);
  const primaryStateAction = hasInventoryIssue
    ? {
        label: tr("primaryState.retryInventory"),
        href: providersHref,
      }
    : null;
  const showPrimaryState = !selectedWorkspaceId || Boolean(providersIssue);
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
      <div className="space-y-8">
        {!hasMounted || (providersQuery.isLoading && !response) ? (
          <MotionDiv
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/40 border border-border/60 rounded-3xl p-8 backdrop-blur-sm"
          >
            <div className="space-y-4">
              <div className="h-6 w-32 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-80 max-w-full animate-pulse rounded-full bg-muted" />
            </div>
          </MotionDiv>
        ) : null}
        {showPrimaryState ? (
          <MotionDiv
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex min-h-[400px] flex-col items-center justify-center bg-card/40 border border-border/60 rounded-3xl p-12 text-center backdrop-blur-md"
          >
            <EmptyState
              action={primaryStateAction ? <a className="button" href={primaryStateAction.href}>{primaryStateAction.label}</a> : undefined}
              description={primaryStateMessage}
              title={primaryStateTitle}
              className="text-foreground"
            />
          </MotionDiv>
        ) : null}

        {selectedWorkspaceId && !providersIssue ? (
          <MotionDiv
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
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
          </MotionDiv>
        ) : null}
      </div>
    </AppShell>
  );
}
