import {
  analyzeProviderSelection,
  getProviderConfiguredModelCatalogItems,
  getProviderModelPricingCoverageStatus,
  providerConnectionSupportsProtocol,
  providerMetadataMatchesRequestedModel,
  type WorkspaceModelAvailability,
} from "@teamops/contracts";
import {
  listAssignedCatalogModelsForWorkspace,
  listCatalogModelsForWorkspace,
  listProviderConnectionCandidatesForWorkspace,
  type ProviderConnectionCandidate,
  type Database,
} from "@teamops/database";

function buildWorkspaceModelAvailability(args: {
  model: Awaited<ReturnType<typeof listCatalogModelsForWorkspace>>[number];
  providerCandidates: Awaited<ReturnType<typeof listProviderConnectionCandidatesForWorkspace>>;
}): WorkspaceModelAvailability {
  const matchingCandidates = args.providerCandidates.filter(
    (candidate) =>
      providerConnectionSupportsProtocol(candidate.connection.provider, args.model.protocol) &&
      providerMetadataMatchesRequestedModel(
        candidate.metadata,
        args.model.modelId,
        candidate.connection.pricingConfig,
      ),
  );

  if (matchingCandidates.length === 0) {
    return {
      ...args.model,
      availabilityStatus: "no_provider",
      candidateConnectionIds: [],
      candidateConnectionLabels: [],
      uncoveredConnectionIds: [],
      routingConflict: null,
    };
  }

  const pricingCoveredCandidates = matchingCandidates.filter(
    (candidate) =>
      getProviderModelPricingCoverageStatus({
        provider: candidate.connection.provider,
        model: args.model.modelId,
        pricingConfig: candidate.connection.pricingConfig,
        metadata: candidate.metadata,
      }) !== "uncovered",
  );

  if (pricingCoveredCandidates.length === 0) {
    return {
      ...args.model,
      availabilityStatus: "pricing_uncovered",
      candidateConnectionIds: matchingCandidates.map((candidate) => candidate.connection.id),
      candidateConnectionLabels: matchingCandidates.map((candidate) => candidate.connection.label),
      uncoveredConnectionIds: matchingCandidates.map((candidate) => candidate.connection.id),
      routingConflict: null,
    };
  }

  const selection = analyzeProviderSelection<ProviderConnectionCandidate>({
    providers: pricingCoveredCandidates,
    protocol: args.model.protocol,
    requestedModel: args.model.modelId,
    headers: {},
  });

  if (!selection.ok) {
    return {
      ...args.model,
      availabilityStatus: "routing_ambiguous",
      candidateConnectionIds: pricingCoveredCandidates.map((candidate) => candidate.connection.id),
      candidateConnectionLabels: pricingCoveredCandidates.map((candidate) => candidate.connection.label),
      uncoveredConnectionIds: [],
      routingConflict: {
        message: selection.message,
        candidateConnectionIds:
          selection.candidates?.map((candidate) => candidate.id) ??
          pricingCoveredCandidates.map((candidate) => candidate.connection.id),
      },
    };
  }

  return {
    ...args.model,
    availabilityStatus: "ready",
    candidateConnectionIds: pricingCoveredCandidates.map((candidate) => candidate.connection.id),
    candidateConnectionLabels: pricingCoveredCandidates.map((candidate) => candidate.connection.label),
    uncoveredConnectionIds: [],
    routingConflict: null,
  };
}

function buildFallbackCatalogModels(args: {
  workspaceId: string;
  protocol: WorkspaceModelAvailability["protocol"];
  providerCandidates: Awaited<ReturnType<typeof listProviderConnectionCandidatesForWorkspace>>;
}) {
  const models = new Map<string, Awaited<ReturnType<typeof listCatalogModelsForWorkspace>>[number]>();

  for (const candidate of args.providerCandidates) {
    if (!providerConnectionSupportsProtocol(candidate.connection.provider, args.protocol)) {
      continue;
    }

    const configuredItems = getProviderConfiguredModelCatalogItems(
      candidate.metadata,
      candidate.connection.pricingConfig,
    );

    for (const item of configuredItems) {
      const key = `${candidate.connection.id}:${item.id}`;
      if (models.has(key)) {
        continue;
      }

      models.set(key, {
        id: key,
        organizationId: candidate.connection.organizationId ?? args.workspaceId,
        modelId: item.id,
        label: item.label,
        protocol: args.protocol,
        sourceProviderConnectionId: candidate.connection.id,
        sourceProviderConnectionLabel: candidate.connection.label,
        sourceProvider: candidate.connection.provider,
        status: "active",
        createdAt: candidate.connection.createdAt,
        updatedAt: candidate.connection.updatedAt,
        assigned: true,
      });
    }
  }

  return [...models.values()];
}

export async function listWorkspaceModelCatalogAvailability(
  db: Database,
  workspaceId: string,
) {
  const [catalogModels, providerCandidates] = await Promise.all([
    listCatalogModelsForWorkspace(db, workspaceId),
    listProviderConnectionCandidatesForWorkspace(db, workspaceId),
  ]);

  return catalogModels.map((model) =>
    buildWorkspaceModelAvailability({
      model,
      providerCandidates,
    }),
  );
}

export async function listReadyAssignedWorkspaceModels(
  db: Database,
  workspaceId: string,
  protocol: WorkspaceModelAvailability["protocol"],
) {
  const [catalogModels, providerCandidates] = await Promise.all([
    listAssignedCatalogModelsForWorkspace(db, workspaceId, protocol),
    listProviderConnectionCandidatesForWorkspace(db, workspaceId),
  ]);

  const candidateModels =
    catalogModels.length > 0
      ? catalogModels.map((model) => ({
          ...model,
          assigned: true,
        }))
      : buildFallbackCatalogModels({
          workspaceId,
          protocol,
          providerCandidates,
        });

  return candidateModels
    .map((model) =>
      buildWorkspaceModelAvailability({
        model,
        providerCandidates,
      }),
    )
    .filter((model) => model.availabilityStatus === "ready");
}
