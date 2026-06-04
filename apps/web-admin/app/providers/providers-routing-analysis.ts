import {
  analyzeProviderRoutingConflicts,
  providerConnectionSupportsProtocol,
  type ProviderConnection,
  type ProviderRoutingConflict,
} from "@teamops/contracts";

export type RoutingProtocol = "anthropic" | "openai-compatible";
export type RoutingSummaryTone =
  | "default"
  | "success"
  | "warning"
  | "critical";

export type AdvancedRoutingRecommendation = {
  protocol: RoutingProtocol;
  kind: "resolve-conflict";
  connection: ProviderConnection;
  reason: string;
};

export type WorkspaceRoutingProtocolSummary = {
  protocol: RoutingProtocol;
  label: string;
  summary: string;
  tone: RoutingSummaryTone;
};

export type WorkspaceRoutingDefaultsSummary = {
  label: string;
  tone: RoutingSummaryTone;
  protocols: WorkspaceRoutingProtocolSummary[];
};

export type RoutingConflict = ProviderRoutingConflict<{
  connection: ProviderConnection;
  metadata: Record<string, string>;
}>;

export type ProtocolDiagnostic = {
  protocol: RoutingProtocol;
  candidates: ProviderConnection[];
  defaultCandidates: ProviderConnection[];
  routingConflicts: RoutingConflict[];
  ambiguousRoutingConflicts: RoutingConflict[];
  recommendedConflictResolutionCandidate: ProviderConnection | null;
  recommendedDefaultCandidate: ProviderConnection | null;
};

export function getProtocolLabel(protocol: RoutingProtocol) {
  return protocol === "anthropic"
    ? "Anthropic protocol"
    : "OpenAI-compatible protocol";
}

function compareRecommendationPriority(
  left: ProviderConnection,
  right: ProviderConnection,
) {
  const score = (connection: ProviderConnection) => {
    if (connection.lastTestStatus === "passed") {
      return 3;
    }

    if (connection.lastTestedAt) {
      return 2;
    }

    return 1;
  };

  const scoreDelta = score(right) - score(left);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const testedAtDelta =
    new Date(right.lastTestedAt ?? right.createdAt).getTime() -
    new Date(left.lastTestedAt ?? left.createdAt).getTime();
  if (testedAtDelta !== 0) {
    return testedAtDelta;
  }

  return left.label.localeCompare(right.label);
}

export function describeRoutingConflict(conflict: RoutingConflict) {
  if (conflict.kind === "exact_model") {
    return `Exact model ${conflict.token} is claimed by multiple active connections.`;
  }

  if (conflict.kind === "exact_vs_prefix") {
    return `Exact model ${conflict.token} is also matched by prefixes (${conflict.matchingPrefixes.join(", ")}).`;
  }

  return `Model prefixes overlap around ${conflict.token}.`;
}

export function buildProtocolDiagnostic(
  connections: ProviderConnection[],
  protocol: RoutingProtocol,
): ProtocolDiagnostic {
  const candidates = connections.filter(
    (connection) =>
      connection.status === "active" &&
      providerConnectionSupportsProtocol(connection.provider, protocol),
  );
  const routingConflicts = analyzeProviderRoutingConflicts({
    providers: candidates.map((connection) => ({
      connection,
      metadata: connection.metadata,
    })),
    protocol,
  });

  return {
    protocol,
    candidates,
    defaultCandidates: [],
    routingConflicts,
    ambiguousRoutingConflicts: routingConflicts.filter(
      (conflict) => conflict.resolution === "ambiguous",
    ),
    recommendedConflictResolutionCandidate: null,
    recommendedDefaultCandidate: null,
  };
}

function describeRecommendationReason(
  connection: ProviderConnection,
  protocol: RoutingProtocol,
  kind: AdvancedRoutingRecommendation["kind"],
) {
  if (kind === "resolve-conflict") {
    if (connection.lastTestStatus === "passed") {
      return `${connection.label} has the strongest passing test for ${getProtocolLabel(protocol)}.`;
    }

    if (connection.lastTestedAt) {
      return `${connection.label} was tested most recently.`;
    }

    return `${connection.label} is the best remaining default.`;
  }

  return `${connection.label} is the strongest available target.`;
}

export function buildWorkspaceRoutingRecommendations(
  diagnostics: ProtocolDiagnostic[],
): AdvancedRoutingRecommendation[] {
  const recommendations: AdvancedRoutingRecommendation[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic.recommendedConflictResolutionCandidate) {
      recommendations.push({
        protocol: diagnostic.protocol,
        kind: "resolve-conflict",
        connection: diagnostic.recommendedConflictResolutionCandidate,
        reason: describeRecommendationReason(
          diagnostic.recommendedConflictResolutionCandidate,
          diagnostic.protocol,
          "resolve-conflict",
        ),
      });
    }
  }

  return recommendations;
}

function getProtocolInventoryLabel(protocol: RoutingProtocol) {
  return protocol === "anthropic" ? "Anthropic" : "OpenAI-compatible";
}

function buildProtocolSummary(
  diagnostic: ProtocolDiagnostic,
): WorkspaceRoutingProtocolSummary {
  if (!diagnostic.candidates.length) {
    return {
      protocol: diagnostic.protocol,
      label: getProtocolInventoryLabel(diagnostic.protocol),
      summary: "No route",
      tone: "default",
    };
  }

  if (diagnostic.ambiguousRoutingConflicts.length > 0) {
    return {
      protocol: diagnostic.protocol,
      label: getProtocolInventoryLabel(diagnostic.protocol),
      summary: `${diagnostic.ambiguousRoutingConflicts.length} conflict${diagnostic.ambiguousRoutingConflicts.length === 1 ? "" : "s"}`,
      tone: "critical",
    };
  }

  return {
    protocol: diagnostic.protocol,
    label: getProtocolInventoryLabel(diagnostic.protocol),
    summary: "Clear",
    tone: "success",
  };
}

export function buildWorkspaceRoutingDefaultsSummary(
  providerConnections: ProviderConnection[],
): WorkspaceRoutingDefaultsSummary {
  const activeConnections = providerConnections.filter(
    (connection) => connection.status === "active",
  );
  const diagnostics = (
    ["anthropic", "openai-compatible"] as const
  ).map((protocol) => buildProtocolDiagnostic(activeConnections, protocol));
  const protocols = diagnostics.map(buildProtocolSummary);

  if (!activeConnections.length) {
    return {
      label: "No active routes",
      tone: "default",
      protocols,
    };
  }

  if (protocols.some((protocol) => protocol.tone === "critical")) {
    return {
      label: "Routing review needed",
      tone: "critical",
      protocols,
    };
  }

  return {
    label: "Routing clear",
    tone: "success",
    protocols,
  };
}

export function buildWorkspaceRoutingDiagnostics(
  providerConnections: ProviderConnection[],
) {
  const activeConnections = providerConnections.filter(
    (connection) => connection.status === "active",
  );
  const protocolDiagnostics = (
    ["anthropic", "openai-compatible"] as const
  ).map((protocol) => buildProtocolDiagnostic(activeConnections, protocol));
  const ambiguousRoutingConflicts = protocolDiagnostics.flatMap(
    (diagnostic) => diagnostic.ambiguousRoutingConflicts,
  );
  const workspaceRecommendations =
    buildWorkspaceRoutingRecommendations(protocolDiagnostics);
  const diagnosticsTone: RoutingSummaryTone = protocolDiagnostics.some(
    (diagnostic) => diagnostic.ambiguousRoutingConflicts.length > 0,
  )
    ? "critical"
    : "success";

  return {
    protocolDiagnostics,
    ambiguousRoutingConflicts,
    workspaceRecommendations,
    diagnosticsTone,
  };
}
