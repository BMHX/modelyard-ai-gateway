import type { Readable } from "node:stream";

import type { ProviderConnection, RecordUsageEventInput } from "@teamops/contracts";

import type { GatewayProtocol, GatewayRequestPath } from "../protocol.js";

export type GatewayProviderUsageEvent = Omit<
  RecordUsageEventInput,
  "workspaceId" | "projectId" | "environmentId" | "virtualKeyId" | "providerConnectionId" | "requestId" | "latencyMs"
>;

export type GatewayProviderRequest = {
  method: "GET" | "POST";
  path: GatewayRequestPath;
  search: string;
  protocol: GatewayProtocol;
  body: Record<string, unknown>;
  providerConnection: ProviderConnection;
  apiKey: string;
  metadata: Record<string, string>;
  demoMode: boolean;
  requestHeaders: Record<string, string>;
  signal: AbortSignal;
};

export type GatewayProviderResult = {
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseKind: "json" | "text" | "stream";
  responseBody: Record<string, unknown> | string | Readable;
  upstreamDebug: {
    upstreamRequestId: string | null;
    providerRequestId: string | null;
    contentType: string | null;
  };
  usageEventPromise: Promise<GatewayProviderUsageEvent>;
};
