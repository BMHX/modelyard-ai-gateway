import {
  analyzeProviderSelection,
  type ProviderConnection,
  type ProviderSelectionCandidate as SharedProviderSelectionCandidate,
} from "@teamops/contracts";

import { GatewayHttpError } from "./errors.js";
import type { GatewayProtocol } from "./protocol.js";

export type ProviderSelectionCandidate = SharedProviderSelectionCandidate & {
  connection: ProviderConnection;
};

export type ResolvedProviderCredentials = ProviderSelectionCandidate & {
  apiKey: string;
};

export function selectProviderForProtocol<T extends ProviderSelectionCandidate>(args: {
  providers: T[];
  protocol: GatewayProtocol;
  headers: Record<string, string>;
  requestedModel?: string;
}): T {
  const result = analyzeProviderSelection(args);
  if (result.ok) {
    return result.candidate;
  }

  const details = {
    protocol: result.protocol,
    ...(result.connectionId ? { connectionId: result.connectionId } : {}),
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.requestedModel ? { requestedModel: result.requestedModel } : {}),
    ...(result.candidates ? { candidates: result.candidates } : {}),
  };

  throw new GatewayHttpError(result.statusCode, result.message, details);
}
