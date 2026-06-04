"use client";

import { type ProviderConnection } from "@teamops/contracts";

import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/app/lib/i18n-client";
import { ProviderAvatar, getProviderVisualMetaForConnection } from "./provider-visuals";
import {
  buildWorkspaceRoutingDiagnostics,
  type AdvancedRoutingRecommendation,
  type RoutingProtocol,
} from "./providers-routing-analysis";

function RoutingStatusBadge({
  tone,
  children,
}: {
  tone: "default" | "success" | "warning" | "critical";
  children: string;
}) {
  const status =
    tone === "success"
      ? "healthy"
      : tone === "warning"
        ? "warning"
        : tone === "critical"
          ? "critical"
          : "default";

  return (
    <StatusBadge className="min-h-5 px-2 py-0 text-[10px]" status={status}>
      {children}
    </StatusBadge>
  );
}

function getProtocolLabel(
  protocol: RoutingProtocol,
  tr: ReturnType<typeof useT>,
) {
  return protocol === "anthropic"
    ? tr("providerKinds.anthropic")
    : tr("providerKinds.openaiCompatible");
}

function getDiagnosticStateLabel(
  diagnostic: ReturnType<typeof buildWorkspaceRoutingDiagnostics>["protocolDiagnostics"][number],
  tr: ReturnType<typeof useT>,
) {
  if (diagnostic.ambiguousRoutingConflicts.length > 0) {
    return tr("advancedDiagnostics.state.overlaps", {
      count: diagnostic.ambiguousRoutingConflicts.length,
    });
  }

  return diagnostic.candidates.length > 0
    ? tr("advancedDiagnostics.state.clear")
    : tr("advancedDiagnostics.state.noRoute");
}

function getDiagnosticStateDescription(
  diagnostic: ReturnType<typeof buildWorkspaceRoutingDiagnostics>["protocolDiagnostics"][number],
  tr: ReturnType<typeof useT>,
) {
  if (diagnostic.ambiguousRoutingConflicts.length > 0) {
    return tr("advancedDiagnostics.detail.overlaps");
  }

  return diagnostic.candidates.length > 0
    ? tr("advancedDiagnostics.detail.clear")
    : tr("advancedDiagnostics.detail.noRoute");
}

function getConflictDescription(
  conflict: ReturnType<typeof buildWorkspaceRoutingDiagnostics>["ambiguousRoutingConflicts"][number],
  tr: ReturnType<typeof useT>,
) {
  if (conflict.kind === "exact_model") {
    return tr("advancedDiagnostics.conflicts.exactModel", {
      token: conflict.token,
    });
  }

  if (conflict.kind === "exact_vs_prefix") {
    return tr("advancedDiagnostics.conflicts.exactVsPrefix", {
      token: conflict.token,
      prefixes: conflict.matchingPrefixes.join(", "),
    });
  }

  return tr("advancedDiagnostics.conflicts.prefixOverlap", {
    token: conflict.token,
  });
}

export function ProvidersAdvancedDiagnostics({
  isWorkspaceRemediationPending,
  onApplyRecommendedDefault,
  onApplyWorkspaceRecommendations,
  onResolveDefaultConflict,
  providerConnections,
  updatePendingId,
}: {
  isWorkspaceRemediationPending: boolean;
  onApplyRecommendedDefault: (connection: ProviderConnection) => void;
  onApplyWorkspaceRecommendations: (
    recommendations: AdvancedRoutingRecommendation[],
  ) => void;
  onResolveDefaultConflict: (
    protocol: RoutingProtocol,
    connection: ProviderConnection,
  ) => void;
  providerConnections: ProviderConnection[];
  updatePendingId: string | null;
}) {
  const tr = useT("providers");
  const {
    ambiguousRoutingConflicts,
    diagnosticsTone,
    protocolDiagnostics,
    workspaceRecommendations,
  } = buildWorkspaceRoutingDiagnostics(providerConnections);

  const sortedDiagnostics = [...protocolDiagnostics].sort((left, right) => {
    const score = (diagnostic: (typeof protocolDiagnostics)[number]) => {
      if (diagnostic.ambiguousRoutingConflicts.length > 0) return 0;
      if (!diagnostic.candidates.length) return 4;
      return 1;
    };

    return score(left) - score(right);
  });

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-sm font-semibold text-foreground">
              {tr("advancedDiagnostics.title")}
            </h3>
            <RoutingStatusBadge tone={diagnosticsTone}>
              {tr(
                ambiguousRoutingConflicts.length || workspaceRecommendations.length
                  ? "advancedDiagnostics.reviewNeeded"
                  : "advancedDiagnostics.clear",
              )}
            </RoutingStatusBadge>
          </div>
          <p className="text-sm text-muted-foreground">
            {tr("advancedDiagnostics.description")}
          </p>
        </div>

        {workspaceRecommendations.length ? (
          <Button
            disabled={isWorkspaceRemediationPending}
            onClick={() =>
              onApplyWorkspaceRecommendations(workspaceRecommendations)
            }
            size="sm"
            type="button"
            variant="secondary"
          >
            {tr(
              isWorkspaceRemediationPending
                ? "advancedDiagnostics.applying"
                : "advancedDiagnostics.applySuggestions",
            )}
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,var(--surface-canvas)_5%)]">
        <Table className="w-full text-sm">
          <TableHeader className="bg-[color:color-mix(in_srgb,var(--surface-2)_74%,var(--surface-1)_26%)]">
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-4 py-3">{tr("advancedDiagnostics.headers.protocol")}</TableHead>
              <TableHead className="px-4 py-3">{tr("advancedDiagnostics.headers.state")}</TableHead>
              <TableHead className="px-4 py-3">{tr("advancedDiagnostics.headers.recommended")}</TableHead>
              <TableHead className="px-4 py-3">{tr("advancedDiagnostics.headers.action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedDiagnostics.map((diagnostic) => {
              const suggestedConnection =
                diagnostic.recommendedConflictResolutionCandidate ??
                diagnostic.recommendedDefaultCandidate;
              const suggestedReason = suggestedConnection
                ? workspaceRecommendations.find(
                    (item) =>
                      item.protocol === diagnostic.protocol &&
                      item.connection.id === suggestedConnection.id,
                  )?.reason ?? null
                : null;
              const stateTone =
                diagnostic.ambiguousRoutingConflicts.length > 0
                  ? "critical"
                  : diagnostic.candidates.length > 0
                    ? "success"
                    : "default";
              const stateLabel =
                getDiagnosticStateLabel(diagnostic, tr);
              const suggestedMeta = suggestedConnection
                ? getProviderVisualMetaForConnection(suggestedConnection)
                : null;

              return (
                <TableRow className="align-top last:border-b-0" key={diagnostic.protocol}>
                  <TableCell className="px-4 py-3.5">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">
                        {getProtocolLabel(diagnostic.protocol, tr)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {tr("advancedDiagnostics.candidateCount", {
                          count: diagnostic.candidates.length,
                        })}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3.5">
                    <div className="space-y-1.5">
                      <RoutingStatusBadge tone={stateTone}>
                        {stateLabel}
                      </RoutingStatusBadge>
                      <p className="text-sm text-muted-foreground">
                        {getDiagnosticStateDescription(diagnostic, tr)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3.5">
                    {suggestedConnection && suggestedMeta ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <ProviderAvatar meta={suggestedMeta} size="sm" />
                          <p className="font-medium text-foreground">
                            {suggestedConnection.label}
                          </p>
                        </div>
                        {suggestedReason ? (
                          <p className="text-sm text-muted-foreground">
                            {tr("advancedDiagnostics.reasons.keepRecommended")}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {tr("advancedDiagnostics.noRecommendation")}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3.5">
                    {suggestedConnection ? (
                      <Button
                        disabled={updatePendingId === suggestedConnection.id}
                        onClick={() =>
                          onResolveDefaultConflict(
                            diagnostic.protocol,
                            suggestedConnection,
                          )
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {tr("advancedDiagnostics.keepAction", {
                          label: suggestedConnection.label,
                        })}
                      </Button>
                    ) : (
                      <Badge variant="outline">{tr("advancedDiagnostics.none")}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {ambiguousRoutingConflicts.length ? (
        <div className="rounded-lg border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-canvas)_8%)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {tr("advancedDiagnostics.conflictSamples")}
            </p>
            <Badge variant="outline">{tr("advancedDiagnostics.reviewLane")}</Badge>
          </div>
          <ul className="mt-3 grid gap-1 text-sm text-muted-foreground">
            {ambiguousRoutingConflicts.slice(0, 3).map((conflict) => (
              <li key={`${conflict.protocol}-${conflict.sampleModel}-${conflict.token}`}>
                {getConflictDescription(conflict, tr)}
              </li>
            ))}
          </ul>
          {ambiguousRoutingConflicts.length > 3 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {tr("advancedDiagnostics.moreOverlaps", {
                count: ambiguousRoutingConflicts.length - 3,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
