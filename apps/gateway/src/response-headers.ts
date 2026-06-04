import type { ProviderConnection } from "@teamops/contracts";

import type { GatewayProtocol } from "./protocol.js";

const gatewayVaryHeaders = [
  "authorization",
  "accept",
  "x-provider-connection-id",
  "x-provider-kind",
  "x-teamops-provider",
] as const;

export function buildGatewayResponseHeaders(args: {
  requestId: string;
  protocol: GatewayProtocol;
  provider?: ProviderConnection["provider"] | null;
  providerConnectionId?: string | null;
  demoMode?: boolean;
}) {
  const headers: Record<string, string> = {
    "x-teamops-request-id": args.requestId,
    "x-teamops-gateway-protocol": args.protocol,
    "cache-control": "no-store",
    vary: gatewayVaryHeaders.join(", "),
    "x-content-type-options": "nosniff",
  };

  if (args.provider) {
    headers["x-teamops-provider"] = args.provider;
  }

  if (args.providerConnectionId) {
    headers["x-teamops-provider-connection-id"] = args.providerConnectionId;
  }

  if (args.demoMode) {
    headers["x-teamops-demo-mode"] = "1";
  }

  return headers;
}

export function buildUpstreamResponseHeaders(args: {
  upstreamStatusCode: number;
  upstreamRequestId?: string | null;
  providerRequestId?: string | null;
  upstreamContentType?: string | null;
}) {
  const headers: Record<string, string> = {
    "x-teamops-upstream-status": String(args.upstreamStatusCode),
  };

  if (args.upstreamRequestId) {
    headers["x-teamops-upstream-request-id"] = args.upstreamRequestId;
  }

  if (args.providerRequestId) {
    headers["x-teamops-provider-request-id"] = args.providerRequestId;
  }

  if (args.upstreamContentType) {
    headers["x-teamops-upstream-content-type"] = args.upstreamContentType;
  }

  return headers;
}

export function mergeResponseHeaders(...parts: Array<Record<string, string> | null | undefined>) {
  const merged: Record<string, string> = {};

  for (const part of parts) {
    if (!part) {
      continue;
    }

    for (const [name, value] of Object.entries(part)) {
      if (name.toLowerCase() === "vary" && merged.vary) {
        const existing = merged.vary
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean);
        const incoming = value
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean);
        merged.vary = [...new Set([...existing, ...incoming])].join(", ");
        continue;
      }

      merged[name] = value;
    }
  }

  return merged;
}
