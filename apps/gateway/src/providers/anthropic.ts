import type { GatewayProviderRequest, GatewayProviderResult } from "./types.js";
import { getConfiguredRequestHeaders, performProviderPassthrough } from "./shared.js";

export async function invokeAnthropic(request: GatewayProviderRequest): Promise<GatewayProviderResult> {
  const baseUrl = request.metadata.baseUrl?.trim() || request.metadata.apiBase?.trim() || "https://api.anthropic.com";
  const headers: Record<string, string> = {
    ...getConfiguredRequestHeaders(request.metadata),
    "x-api-key": request.apiKey,
    "anthropic-version":
      request.requestHeaders["anthropic-version"] || request.metadata.anthropicVersion || "2023-06-01",
  };
  if (request.method !== "GET") {
    headers["content-type"] = "application/json";
  }

  if (request.requestHeaders.accept) {
    headers.accept = request.requestHeaders.accept;
  }

  const forwardedHeaders = [
    "anthropic-beta",
    "user-agent",
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

  if (request.metadata.anthropicBeta && !headers["anthropic-beta"]) {
    headers["anthropic-beta"] = request.metadata.anthropicBeta;
  }

  return performProviderPassthrough({
    request,
    url: baseUrl.replace(/\/+$/, "") + request.path + request.search,
    headers,
  });
}
