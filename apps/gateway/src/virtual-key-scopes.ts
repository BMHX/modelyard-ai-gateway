import {
  getReservedVirtualKeyScopes,
  type VirtualKey,
  type VirtualKeyGatewayScope,
} from "@teamops/contracts";

import type { GatewayRequestPath } from "./protocol.js";

const virtualKeyScopeWildcard: VirtualKeyGatewayScope = "gateway:*";

export function getRequiredVirtualKeyScope(path: GatewayRequestPath): VirtualKeyGatewayScope {
  if (path === "/v1/messages") {
    return "gateway:messages";
  }

  if (path === "/v1/chat/completions") {
    return "gateway:chat-completions";
  }

  if (path === "/v1/responses") {
    return "gateway:responses";
  }

  return "gateway:models";
}

export function evaluateVirtualKeyScopes(virtualKey: Pick<VirtualKey, "scopes">, path: GatewayRequestPath) {
  const reservedScopes = getReservedVirtualKeyScopes(virtualKey.scopes);
  const requiredScope = getRequiredVirtualKeyScope(path);

  if (reservedScopes.length === 0) {
    return {
      allowed: true,
      enforced: false,
      requiredScope,
      reservedScopes,
    };
  }

  return {
    allowed: reservedScopes.includes(virtualKeyScopeWildcard) || reservedScopes.includes(requiredScope),
    enforced: true,
    requiredScope,
    reservedScopes,
  };
}
