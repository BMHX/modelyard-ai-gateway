import {
  ProviderModelConfigSchema,
  collectProviderMetadataTokens,
  getProviderModelConfigFromMetadata,
  normalizeProviderModelConfig,
  normalizeProviderModelId,
  serializeProviderModelConfig,
  type ProviderModelConfig,
  type ProviderModelConfigItem,
} from "@teamops/contracts";

export type ProviderModelDraft = ProviderModelConfigItem & {
  legacy?: boolean;
};

export function createProviderModelConfig(items: ProviderModelConfigItem[]): ProviderModelConfig {
  return normalizeProviderModelConfig(
    ProviderModelConfigSchema.parse({
      version: 1,
      items,
    }),
  );
}

export function buildProviderModelConfigFromMetadata(
  metadata: Record<string, string>,
  presetModelIds: Set<string>,
): ProviderModelConfig {
  const savedConfig = getProviderModelConfigFromMetadata(metadata);
  if (savedConfig) {
    return savedConfig;
  }

  const exactModels = collectProviderMetadataTokens(
    metadata.models,
    metadata.defaultModels,
    metadata["routing.models"],
  );

  return createProviderModelConfig(
    exactModels.map((modelId) => ({
      id: modelId,
      label: modelId,
      source: presetModelIds.has(modelId) ? "preset" : "custom",
    })),
  );
}

export function getLegacyModelIdsFromMetadata(
  metadata: Record<string, string>,
  presetModelIds: Set<string>,
) {
  if (getProviderModelConfigFromMetadata(metadata)) {
    return new Set<string>();
  }

  return new Set(
    collectProviderMetadataTokens(
      metadata.models,
      metadata.defaultModels,
      metadata["routing.models"],
    ).filter((modelId) => !presetModelIds.has(modelId)),
  );
}

export function buildProviderModelConfigJson(config: ProviderModelConfig) {
  return serializeProviderModelConfig(config);
}

export function getExactModelsFromConfig(config: ProviderModelConfig) {
  return normalizeProviderModelConfig(config).items.map((item) => item.id);
}

export function getExactModelsValue(config: ProviderModelConfig) {
  return getExactModelsFromConfig(config).join(", ");
}

export function upsertProviderModelItem(
  config: ProviderModelConfig,
  item: ProviderModelConfigItem,
) {
  const normalizedId = normalizeProviderModelId(item.id);
  const nextItems = normalizeProviderModelConfig(config).items.filter(
    (entry) => entry.id !== normalizedId,
  );

  if (!normalizedId) {
    return createProviderModelConfig(nextItems);
  }

  return createProviderModelConfig([
    ...nextItems,
    {
      id: normalizedId,
      label: item.label?.trim() ? item.label.trim() : null,
      source: item.source,
    },
  ]);
}

export function addProviderCustomModelItem(
  config: ProviderModelConfig,
  input: {
    id: string;
    label: string;
  },
) {
  return upsertProviderModelItem(config, {
    id: input.id,
    label: input.label,
    source: "custom",
  });
}

export function removeProviderModelItem(
  config: ProviderModelConfig,
  modelId: string,
) {
  const normalizedId = normalizeProviderModelId(modelId);
  return createProviderModelConfig(
    normalizeProviderModelConfig(config).items.filter((item) => item.id !== normalizedId),
  );
}
