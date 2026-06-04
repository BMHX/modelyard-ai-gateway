import { GatewayHttpError } from "../errors.js";

import type { GatewayProviderRequest, GatewayProviderResult } from "./types.js";
import { getConfiguredRequestHeaders, performProviderPassthrough } from "./shared.js";

export async function invokeOpenAiCompatible(request: GatewayProviderRequest): Promise<GatewayProviderResult> {
  const configuredBaseUrl = request.metadata.baseUrl?.trim() || request.metadata.apiBase?.trim();
  const baseUrl =
    request.providerConnection.provider === "openai" ? configuredBaseUrl || "https://api.openai.com" : configuredBaseUrl;

  if (!baseUrl) {
    throw new GatewayHttpError(424, "OpenAI-compatible provider connection is missing metadata.baseUrl", {
      providerConnectionId: request.providerConnection.id,
    });
  }

  const headers: Record<string, string> = {
    ...getConfiguredRequestHeaders(request.metadata),
    authorization: `Bearer ${request.apiKey}`,
  };
  if (request.method !== "GET") {
    headers["content-type"] = "application/json";
  }

  const forwardedHeaders = [
    "accept",
    "user-agent",
    "openai-organization",
    "openai-project",
    "openai-beta",
    "idempotency-key",
    "x-stainless-arch",
    "x-stainless-lang",
    "x-stainless-os",
    "x-stainless-package-version",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
  ];
  for (const headerName of forwardedHeaders) {
    const headerValue = request.requestHeaders[headerName];
    if (headerValue) {
      headers[headerName] = headerValue;
    }
  }

  return performProviderPassthrough({
    request,
    url: baseUrl.replace(/\/+$/, "") + request.path + request.search,
    headers,
  });
}
