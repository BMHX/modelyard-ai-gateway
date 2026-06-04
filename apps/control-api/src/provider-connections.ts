import type {
  CreateProviderConnectionInput,
  ProviderConnection,
  ProviderConnectionTestResponse,
  UpdateProviderConnectionInput,
} from "@teamops/contracts";
import {
  DatabaseValidationError,
  normalizeProviderConnectionMetadata,
} from "@teamops/database";

const managedProviderKinds = new Set<ProviderConnection["provider"]>([
  "anthropic",
  "openai",
  "openai-compatible",
]);

const blockedConfiguredRequestHeaders = new Set([
  "authorization",
  "content-length",
  "connection",
  "host",
  "x-api-key",
]);

function getConfiguredRequestHeaders(metadata: Record<string, string>) {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }

    const prefix = key.startsWith("header.")
      ? "header."
      : key.startsWith("headers.")
        ? "headers."
        : null;
    if (!prefix) {
      continue;
    }

    const headerName = key.slice(prefix.length).trim();
    if (!headerName || blockedConfiguredRequestHeaders.has(headerName.toLowerCase())) {
      continue;
    }

    headers[headerName] = value;
  }

  return headers;
}

function assertManagedProviderKind(provider: ProviderConnection["provider"]) {
  if (managedProviderKinds.has(provider)) {
    return;
  }

  throw new DatabaseValidationError(
    `Provider kind ${provider} is not supported by provider connection management yet`,
  );
}

function summarizeErrorPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.error && typeof record.error === "object" && record.error && !Array.isArray(record.error)) {
    const nestedMessage = (record.error as Record<string, unknown>).message;
    if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
      return nestedMessage.trim();
    }
  }

  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message.trim();
  }

  return null;
}

async function readTestFailureMessage(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      const payload = (await response.json()) as unknown;
      const summarized = summarizeErrorPayload(payload);
      if (summarized) {
        return summarized.slice(0, 240);
      }
    } catch {
      // Fall through to plain-text handling.
    }
  }

  try {
    const rawBody = (await response.text()).trim();
    if (rawBody) {
      return rawBody.slice(0, 240);
    }
  } catch {
    // Ignore body parse failures and fall back to status text.
  }

  return response.statusText || `Connection test failed with HTTP ${response.status}`;
}

function normalizeModelCatalogPayload(
  payload: unknown,
): Array<{ id: string; label: string; ownedBy: string | null }> {
  const rawItems =
    Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
        ? (payload as { data: unknown[] }).data
        : [];

  const deduped = new Map<string, { id: string; label: string; ownedBy: string | null }>();
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const rawId = typeof record.id === "string" ? record.id.trim() : "";
    if (!rawId) {
      continue;
    }

    deduped.set(rawId, {
      id: rawId,
      label: rawId,
      ownedBy: typeof record.owned_by === "string" && record.owned_by.trim().length > 0
        ? record.owned_by.trim()
        : null,
    });
  }

  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function buildProviderTestRequest(args: {
  provider: ProviderConnection["provider"];
  apiKey: string;
  metadata: Record<string, string>;
}) {
  const metadata = normalizeProviderConnectionMetadata(args.metadata);
  const configuredHeaders = getConfiguredRequestHeaders(metadata);
  const apiKey = args.apiKey.trim();

  if (apiKey.length < 8) {
    throw new DatabaseValidationError("Provider API key must be at least 8 characters");
  }

  if (args.provider === "anthropic") {
    const baseUrl = metadata.baseUrl ?? "https://api.anthropic.com";
    return {
      url: `${baseUrl}/v1/models`,
      headers: {
        ...configuredHeaders,
        accept: "application/json",
        "x-api-key": apiKey,
        "anthropic-version": metadata.anthropicVersion ?? "2023-06-01",
      },
    };
  }

  if (args.provider === "openai" || args.provider === "openai-compatible") {
    const baseUrl = metadata.baseUrl ?? (args.provider === "openai" ? "https://api.openai.com" : null);
    if (!baseUrl) {
      throw new DatabaseValidationError("OpenAI-compatible provider connections require metadata.baseUrl");
    }

    return {
      url: `${baseUrl}/v1/models`,
      headers: {
        ...configuredHeaders,
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    };
  }

  throw new DatabaseValidationError(
    `Provider kind ${args.provider} is not supported by provider connection management yet`,
  );
}

export function normalizeManagedProviderConnectionInput(input: CreateProviderConnectionInput): CreateProviderConnectionInput {
  assertManagedProviderKind(input.provider);

  const normalizedMetadata = normalizeProviderConnectionMetadata(input.metadata);
  if (input.provider === "openai-compatible" && !normalizedMetadata.baseUrl) {
    throw new DatabaseValidationError("OpenAI-compatible provider connections require a base URL");
  }

  return {
    ...input,
    label: input.label.trim(),
    apiKey: input.apiKey.trim(),
    metadata: normalizedMetadata,
  };
}

export function normalizeManagedProviderConnectionUpdate(
  provider: ProviderConnection["provider"],
  input: UpdateProviderConnectionInput,
): UpdateProviderConnectionInput {
  assertManagedProviderKind(provider);

  const nextInput: UpdateProviderConnectionInput = {};

  if (input.label !== undefined) {
    nextInput.label = input.label.trim();
  }

  if (input.apiKey !== undefined) {
    nextInput.apiKey = input.apiKey.trim();
  }

  if (input.metadata !== undefined) {
    nextInput.metadata = normalizeProviderConnectionMetadata(input.metadata);
  }

  if (input.pricingConfig !== undefined) {
    nextInput.pricingConfig = input.pricingConfig;
  }

  if (Object.keys(nextInput).length === 0) {
    throw new DatabaseValidationError("At least one provider connection field must be updated");
  }

  if (provider === "openai-compatible" && nextInput.metadata && !nextInput.metadata.baseUrl) {
    throw new DatabaseValidationError("OpenAI-compatible provider connections require a base URL");
  }

  return nextInput;
}

export async function testManagedProviderConnection(args: {
  connection: {
    id: string | null;
    provider: ProviderConnection["provider"];
  };
  apiKey: string;
  metadata: Record<string, string>;
}): Promise<ProviderConnectionTestResponse> {
  const testedAt = new Date().toISOString();
  const startedAt = Date.now();

  try {
    assertManagedProviderKind(args.connection.provider);

    const request = buildProviderTestRequest({
      provider: args.connection.provider,
      apiKey: args.apiKey,
      metadata: args.metadata,
    });
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      signal: AbortSignal.timeout(15_000),
    });

    return {
      providerConnectionId: args.connection.id,
      ok: response.ok,
      statusCode: response.status,
      message: response.ok
        ? `Connection verified with HTTP ${response.status}`
        : await readTestFailureMessage(response),
      testedAt,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      providerConnectionId: args.connection.id,
      ok: false,
      statusCode: null,
      message: error instanceof Error ? error.message : "Connection test failed",
      testedAt,
      latencyMs: Date.now() - startedAt,
    };
  }
}

export async function listManagedProviderConnectionModels(args: {
  connection: {
    id: string | null;
    provider: ProviderConnection["provider"];
  };
  apiKey: string;
  metadata: Record<string, string>;
}): Promise<
  | {
      ok: true;
      providerConnectionId: string | null;
      fetchedAt: string;
      items: Array<{ id: string; label: string; ownedBy: string | null }>;
    }
  | {
      ok: false;
      providerConnectionId: string | null;
      fetchedAt: string;
      statusCode: number | null;
      message: string;
    }
> {
  const fetchedAt = new Date().toISOString();

  try {
    assertManagedProviderKind(args.connection.provider);

    const request = buildProviderTestRequest({
      provider: args.connection.provider,
      apiKey: args.apiKey,
      metadata: args.metadata,
    });
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        providerConnectionId: args.connection.id,
        fetchedAt,
        statusCode: response.status,
        message: await readTestFailureMessage(response),
      };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    return {
      ok: true,
      providerConnectionId: args.connection.id,
      fetchedAt,
      items: normalizeModelCatalogPayload(payload),
    };
  } catch (error) {
    return {
      ok: false,
      providerConnectionId: args.connection.id,
      fetchedAt,
      statusCode: null,
      message: error instanceof Error ? error.message : "Failed to read model catalog",
    };
  }
}
