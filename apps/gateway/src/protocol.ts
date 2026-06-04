import { providerConnectionSupportsProtocol, type ProviderRoutingProtocol } from "@teamops/contracts";

export type GatewayRequestPath =
  | "/v1/messages"
  | "/v1/chat/completions"
  | "/v1/responses"
  | "/v1/models"
  | `/v1/models/${string}`;
export type GatewayProtocol = ProviderRoutingProtocol;

export function getProtocolForPath(path: GatewayRequestPath): GatewayProtocol {
  if (path === "/v1/messages") {
    return "anthropic";
  }

  return "openai-compatible";
}

export function isMetadataRequestPath(path: GatewayRequestPath) {
  return path === "/v1/models" || path.startsWith("/v1/models/");
}

export function providerSupportsProtocol(
  provider: Parameters<typeof providerConnectionSupportsProtocol>[0],
  protocol: GatewayProtocol,
): boolean {
  return providerConnectionSupportsProtocol(provider, protocol);
}
