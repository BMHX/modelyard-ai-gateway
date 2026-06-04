import type { ProviderConnection } from "@teamops/contracts";

export type ProviderPresetModel = {
  id: string;
  label: string;
};

const providerPresetModelsByTemplateId = {
  "anthropic-public": [
    { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4", label: "Claude Opus 4" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ],
  "openai-public": [
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano" },
    { id: "o4-mini", label: "o4-mini" },
  ],
  "private-model-cluster": [
    { id: "qwen-coder", label: "Qwen Coder" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    { id: "llama-3", label: "Llama 3" },
  ],
  "qwen-cluster": [
    { id: "qwen-max", label: "Qwen Max" },
    { id: "qwen-plus", label: "Qwen Plus" },
    { id: "qwen-coder", label: "Qwen Coder" },
  ],
  "deepseek-cluster": [
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    { id: "deepseek-v3", label: "DeepSeek V3" },
  ],
  "internal-endpoint": [
    { id: "internal-coder", label: "Internal Coder" },
    { id: "internal-reasoner", label: "Internal Reasoner" },
    { id: "internal-embedding", label: "Internal Embedding" },
  ],
  "customer-gateway": [
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "customer-gpt", label: "Customer GPT" },
    { id: "customer-reasoner", label: "Customer Reasoner" },
  ],
} as const satisfies Record<string, ProviderPresetModel[]>;

const providerPresetModelsByProvider: Record<
  ProviderConnection["provider"],
  ProviderPresetModel[]
> = {
  anthropic: providerPresetModelsByTemplateId["anthropic-public"],
  openai: providerPresetModelsByTemplateId["openai-public"],
  "openai-compatible": [
    ...providerPresetModelsByTemplateId["private-model-cluster"],
    ...providerPresetModelsByTemplateId["qwen-cluster"],
    ...providerPresetModelsByTemplateId["deepseek-cluster"],
    ...providerPresetModelsByTemplateId["internal-endpoint"],
    ...providerPresetModelsByTemplateId["customer-gateway"],
  ],
  bedrock: [],
  vertex: [],
};

function dedupeModels(models: ProviderPresetModel[]) {
  const deduped = new Map<string, ProviderPresetModel>();

  for (const model of models) {
    const normalizedId = model.id.trim().toLowerCase();
    if (!normalizedId) {
      continue;
    }

    deduped.set(normalizedId, {
      id: normalizedId,
      label: model.label,
    });
  }

  return [...deduped.values()];
}

export function getPresetModelsForTemplate(templateId: string) {
  return dedupeModels(providerPresetModelsByTemplateId[templateId as keyof typeof providerPresetModelsByTemplateId] ?? []);
}

export function getPresetModelsForProvider(provider: ProviderConnection["provider"]) {
  return dedupeModels(providerPresetModelsByProvider[provider] ?? []);
}

export function getAllPresetModelIds() {
  return new Set(
    Object.values(providerPresetModelsByTemplateId)
      .flat()
      .map((item) => item.id.trim().toLowerCase())
      .filter(Boolean),
  );
}
