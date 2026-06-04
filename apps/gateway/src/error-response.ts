import type { GatewayProtocol } from "./protocol.js";

function getGatewayErrorType(protocol: GatewayProtocol, statusCode: number) {
  if (statusCode === 401) {
    return "authentication_error";
  }

  if (statusCode === 403) {
    return "permission_error";
  }

  if (statusCode === 429) {
    return "rate_limit_error";
  }

  if (statusCode >= 500 || statusCode === 424 || statusCode === 499) {
    return "api_error";
  }

  if (protocol === "anthropic") {
    return "invalid_request_error";
  }

  return "invalid_request_error";
}

const gatewayReasonCodes: Record<string, string> = {
  budget_hard_limit_exceeded: "teamops_budget_hard_limit_exceeded",
  budget_preflight_estimate_exceeds_remaining_headroom:
    "teamops_budget_preflight_estimate_exceeds_remaining_headroom",
  invalid_request_body: "teamops_invalid_request_body",
  invalid_virtual_key: "teamops_invalid_virtual_key",
  missing_bearer_token: "teamops_missing_bearer_token",
  model_not_allowed_for_provider_connection:
    "teamops_model_not_allowed_for_provider_connection",
  pricing_not_configured_for_budget_enforcement:
    "teamops_pricing_not_configured_for_budget_enforcement",
  virtual_key_expired: "teamops_virtual_key_expired",
  virtual_key_not_active: "teamops_virtual_key_not_active",
  virtual_key_provider_binding_required:
    "teamops_virtual_key_provider_binding_required",
  virtual_key_provider_connection_unavailable:
    "teamops_virtual_key_provider_connection_unavailable",
  virtual_key_provider_protocol_mismatch:
    "teamops_virtual_key_provider_protocol_mismatch",
  virtual_key_scope_denied: "teamops_virtual_key_scope_denied",
};

function getGatewayErrorCode(reason?: string) {
  if (!reason) {
    return "teamops_gateway_error";
  }

  if (gatewayReasonCodes[reason]) {
    return gatewayReasonCodes[reason];
  }

  const normalized = reason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return "teamops_gateway_error";
  }

  return `teamops_${normalized}`;
}

export function buildGatewayErrorBody(args: {
  protocol: GatewayProtocol;
  statusCode: number;
  message: string;
  requestId: string;
  reason?: string;
}) {
  const errorType = getGatewayErrorType(args.protocol, args.statusCode);
  const errorCode = getGatewayErrorCode(args.reason);

  if (args.protocol === "anthropic") {
    return {
      type: "error",
      error: {
        type: errorType,
        code: errorCode,
        message: args.message,
      },
      request_id: args.requestId,
    };
  }

  return {
    error: {
      message: args.message,
      type: errorType,
      param: null,
      code: errorCode,
    },
  };
}
