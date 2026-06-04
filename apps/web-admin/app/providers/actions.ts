"use server";

import type {
  CreateProviderConnectionInput,
  ProviderConnection,
  ProviderModelConfigItem,
  ProviderPricingConfig,
  ProviderConnectionTestResponse,
  ProviderRoutingProtocol,
  UpdateProviderConnectionInput,
} from "@teamops/contracts";
import {
  getProviderModelIdsFromModelConfig,
  normalizeCanonicalModel,
  parseProviderModelConfig,
  providerConnectionSupportsProtocol,
  providerMetadataMarksDefault,
  serializeProviderModelConfig,
} from "@teamops/contracts";

import {
  createProviderConnection,
  listProviderConnections,
  revokeProviderConnection,
  testProviderConnection,
  testProviderConnectionDraft,
  updateProviderConnection,
} from "../lib/control-api";
import { getUserErrorMessage, toFriendlyRequiredMessage } from "../lib/user-facing-error";

function getErrorMessage(error: unknown) {
  return getUserErrorMessage(error, "Can't save this connection right now.");
}

type ManagedProviderKind = "anthropic" | "openai" | "openai-compatible";

function isManagedProvider(provider: ProviderConnection["provider"]): provider is ManagedProviderKind {
  return provider === "anthropic" || provider === "openai" || provider === "openai-compatible";
}

export type ProviderConnectionFormInput = {
  workspaceId: string;
  provider: ProviderConnection["provider"];
  label: string;
  apiKey: string;
  baseUrl?: string;
  anthropicVersion?: string;
  defaultForProtocol?: "none" | "provider" | "all";
  modelPrefixes?: string;
  models?: string;
  modelConfigJson?: string;
  pricingConfig?: ProviderPricingConfig | null;
  existingMetadata?: Record<string, string>;
  existingPricingConfig?: ProviderPricingConfig | null;
};

const controlledMetadataKeys = new Set([
  "baseUrl",
  "apiBase",
  "anthropicVersion",
  "anthropicBeta",
  "defaultForProtocol",
  "gatewayProtocol",
  "protocol",
  "protocols",
  "modelPrefixes",
  "defaultModelPrefixes",
  "routing.modelPrefixes",
  "models",
  "defaultModels",
  "routing.models",
  "ui.modelConfig",
]);

function buildManagedMetadata(input: ProviderConnectionFormInput) {
  if (!isManagedProvider(input.provider)) {
    throw new Error(`Provider ${input.provider} is not editable from the current admin flow yet`);
  }

  const metadata: Record<string, string> = {};
  const baseUrl = input.baseUrl?.trim();
  const anthropicVersion = input.anthropicVersion?.trim();
  const modelPrefixes = input.modelPrefixes?.trim();
  const parsedModelConfig = parseProviderModelConfig(input.modelConfigJson);
  const configuredModelItems = new Map<string, ProviderModelConfigItem>();

  for (const item of parsedModelConfig?.items ?? []) {
    configuredModelItems.set(item.id, item);
  }

  for (const rule of input.pricingConfig?.mode === "manual" ? input.pricingConfig.rules : []) {
    if (rule.matchType !== "canonical" || !rule.model) {
      continue;
    }

    const canonicalModel = normalizeCanonicalModel(rule.model);
    if (!canonicalModel || configuredModelItems.has(canonicalModel)) {
      continue;
    }

    configuredModelItems.set(canonicalModel, {
      id: canonicalModel,
      label: canonicalModel,
      source: "custom",
    });
  }

  const mergedModelConfig =
    configuredModelItems.size > 0
      ? {
          version: 1 as const,
          items: [...configuredModelItems.values()],
        }
      : null;
  const models =
    mergedModelConfig
      ? getProviderModelIdsFromModelConfig(mergedModelConfig).join(", ")
      : input.models?.trim() ?? "";

  if (baseUrl) {
    metadata.baseUrl = baseUrl;
  }

  if (input.provider === "anthropic" && anthropicVersion) {
    metadata.anthropicVersion = anthropicVersion;
  }

  if (input.defaultForProtocol === "all") {
    metadata.defaultForProtocol = "all";
  } else if (input.defaultForProtocol === "provider") {
    metadata.defaultForProtocol = input.provider === "anthropic" ? "anthropic" : "openai-compatible";
  }

  if (modelPrefixes) {
    metadata.modelPrefixes = modelPrefixes;
    metadata["routing.modelPrefixes"] = modelPrefixes;
  }

  if (mergedModelConfig) {
    metadata["ui.modelConfig"] = serializeProviderModelConfig(mergedModelConfig);
  }

  if (models) {
    metadata.models = models;
    metadata["routing.models"] = models;
  }

  return metadata;
}

function getPreferredMetadataValue(metadata: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return "";
}

function getStoredDefaultMode(connection: ProviderConnection, protocol: ProviderRoutingProtocol) {
  const marker = connection.metadata.defaultForProtocol?.trim().toLowerCase();
  if (!marker) {
    return "none" as const;
  }

  if (marker === "all" || marker === "default") {
    return "all" as const;
  }

  if (protocol === "anthropic") {
    return marker === "anthropic" || marker === "messages" ? "provider" : "none";
  }

  return marker === "openai" || marker === "openai-compatible" || marker === "chat-completions"
    ? "provider"
    : "none";
}

function buildCreateInput(input: ProviderConnectionFormInput): CreateProviderConnectionInput {
  const metadata = buildManagedMetadata(input);
  const pricingConfig =
    input.pricingConfig?.mode === "manual" ? input.pricingConfig : null;

  return {
    workspaceId: input.workspaceId,
    provider: input.provider,
    label: input.label.trim(),
    apiKey: input.apiKey.trim(),
    metadata,
    pricingConfig,
  };
}

function buildUpdateInput(input: ProviderConnectionFormInput & { newApiKey?: string }): UpdateProviderConnectionInput {
  const payload = buildCreateInput(input);
  const mergedMetadata: Record<string, string> = {};

  for (const [key, value] of Object.entries(input.existingMetadata ?? {})) {
    if (controlledMetadataKeys.has(key)) {
      continue;
    }

    mergedMetadata[key] = value;
  }

  Object.assign(mergedMetadata, payload.metadata);
  const nextInput: UpdateProviderConnectionInput = {
    label: payload.label,
    metadata: mergedMetadata,
  };

  if (input.pricingConfig !== undefined) {
    nextInput.pricingConfig =
      input.pricingConfig?.mode === "manual" ? input.pricingConfig : null;
  }

  const newApiKey = input.newApiKey?.trim();
  if (newApiKey) {
    nextInput.apiKey = newApiKey;
  }

  return nextInput;
}

export type CreateProviderConnectionActionResult =
  | {
      status: "idle";
      message: null;
      connection: null;
    }
  | {
      status: "error";
      message: string;
      connection: null;
    }
  | {
      status: "success";
      message: string;
      connection: ProviderConnection;
    };

export async function createProviderConnectionAction(
  input: ProviderConnectionFormInput,
): Promise<CreateProviderConnectionActionResult> {
  try {
    const payload = buildCreateInput(input);

    if (!payload.label) {
      return {
        status: "error",
        message: toFriendlyRequiredMessage("label"),
        connection: null,
      };
    }

    if (!payload.apiKey) {
      return {
        status: "error",
        message: toFriendlyRequiredMessage("apiKey"),
        connection: null,
      };
    }

    const connection = await createProviderConnection(payload);
    return {
      status: "success",
      message: `Saved provider connection ${connection.label}.`,
      connection,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      connection: null,
    };
  }
}

export type TestProviderConnectionActionResult =
  | {
      status: "idle";
      message: null;
      result: null;
      connection: null;
    }
  | {
      status: "error";
      message: string;
      result: ProviderConnectionTestResponse | null;
      connection: ProviderConnection | null;
    }
  | {
      status: "success";
      message: string;
      result: ProviderConnectionTestResponse;
      connection: ProviderConnection | null;
    };

export async function testProviderConnectionAction(
  workspaceId: string,
  providerConnectionId: string,
): Promise<TestProviderConnectionActionResult> {
  try {
    const result = await testProviderConnection(workspaceId, providerConnectionId);
    const connections = await listProviderConnections(workspaceId);
    const connection = connections.find((item) => item.id === providerConnectionId) ?? null;

    return {
      status: result.ok ? "success" : "error",
      message: result.ok ? result.message : getUserErrorMessage(new Error(result.message), "Can't test this connection right now."),
      result,
      connection,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      result: null,
      connection: null,
    };
  }
}

export async function testProviderConnectionDraftAction(
  input: ProviderConnectionFormInput,
): Promise<TestProviderConnectionActionResult> {
  try {
    const payload = buildCreateInput(input);

    if (!payload.label) {
      return {
        status: "error",
        message: toFriendlyRequiredMessage("label"),
        result: null,
        connection: null,
      };
    }

    if (!payload.apiKey) {
      return {
        status: "error",
        message: toFriendlyRequiredMessage("apiKey"),
        result: null,
        connection: null,
      };
    }

    const result = await testProviderConnectionDraft(payload);
    return {
      status: result.ok ? "success" : "error",
      message: result.ok ? result.message : getUserErrorMessage(new Error(result.message), "Can't test this connection right now."),
      result,
      connection: null,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      result: null,
      connection: null,
    };
  }
}

export type RevokeProviderConnectionActionResult =
  | {
      status: "success";
      message: string;
      connection: ProviderConnection;
    }
  | {
      status: "error";
      message: string;
      connection: null;
  };

export type UpdateProviderConnectionActionResult =
  | {
      status: "success";
      message: string;
      connection: ProviderConnection;
    }
  | {
      status: "error";
      message: string;
      connection: null;
    };

export async function updateProviderConnectionAction(
  workspaceId: string,
  providerConnectionId: string,
  input: ProviderConnectionFormInput & { newApiKey?: string },
): Promise<UpdateProviderConnectionActionResult> {
  try {
    const connection = await updateProviderConnection(
      workspaceId,
      providerConnectionId,
      buildUpdateInput(input),
    );

    return {
      status: "success",
      message: input.newApiKey?.trim()
        ? `Rotated key and updated routing for ${connection.label}.`
        : `Updated provider connection ${connection.label}.`,
      connection,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      connection: null,
    };
  }
}

export type ResolveProviderDefaultConflictActionResult =
  | {
      status: "success";
      message: string;
      connections: ProviderConnection[];
    }
  | {
      status: "error";
      message: string;
      connections: null;
    };

export async function resolveProviderProtocolDefaultConflictAction(args: {
  workspaceId: string;
  protocol: ProviderRoutingProtocol;
  keepConnectionId: string;
  connections: ProviderConnection[];
}): Promise<ResolveProviderDefaultConflictActionResult> {
  try {
    const conflictingConnections = args.connections.filter(
      (connection) =>
        connection.status === "active" &&
        providerConnectionSupportsProtocol(connection.provider, args.protocol) &&
        providerMetadataMarksDefault(connection.metadata, args.protocol),
    );

    if (conflictingConnections.length <= 1) {
      return {
        status: "error",
        message: `No conflicting ${args.protocol} defaults were found.`,
        connections: null,
      };
    }

    const keepConnection = conflictingConnections.find((connection) => connection.id === args.keepConnectionId);
    if (!keepConnection) {
      return {
        status: "error",
        message: "The selected default candidate is no longer part of the conflicting set.",
        connections: null,
      };
    }

    const updatedConnections: ProviderConnection[] = [];
    for (const connection of conflictingConnections) {
      const defaultForProtocol = connection.id === keepConnection.id
        ? getStoredDefaultMode(connection, args.protocol) === "all"
          ? "all"
          : "provider"
        : "none";

      const updated = await updateProviderConnection(args.workspaceId, connection.id, buildUpdateInput({
        workspaceId: args.workspaceId,
        provider: connection.provider,
        label: connection.label,
        apiKey: "",
        baseUrl: connection.baseUrl ?? "",
        anthropicVersion: connection.anthropicVersion ?? "",
        defaultForProtocol,
        modelPrefixes: getPreferredMetadataValue(connection.metadata, [
          "modelPrefixes",
          "defaultModelPrefixes",
          "routing.modelPrefixes",
        ]),
        models: getPreferredMetadataValue(connection.metadata, [
          "models",
          "defaultModels",
          "routing.models",
        ]),
        existingMetadata: connection.metadata,
      }));

      updatedConnections.push(updated);
    }

    return {
      status: "success",
      message: `Kept ${keepConnection.label} as the only ${args.protocol} default and cleared the remaining conflicts.`,
      connections: updatedConnections,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      connections: null,
    };
  }
}

export async function revokeProviderConnectionAction(
  workspaceId: string,
  providerConnectionId: string,
): Promise<RevokeProviderConnectionActionResult> {
  try {
    const connection = await revokeProviderConnection(workspaceId, providerConnectionId);

    return {
      status: "success",
      message: `Revoked provider connection ${connection.label}.`,
      connection,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      connection: null,
    };
  }
}
