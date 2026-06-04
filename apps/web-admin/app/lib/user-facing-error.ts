const technicalErrorPattern =
  /control api|fetch failed|econnrefused|json|schema|route|status code|stack|trace|unexpected|uuid|\/v1\/|x-member-email|admin token|base url|api key|network\/unavailable|control-plane|valkey|postgres|database|migration|endpoint|payload|header/i;

const errorCodeMessages: Record<string, string> = {
  ACCESS_DENIED: "You don't have permission to do this.",
  AUTH_REQUIRED: "Authentication is required for this route.",
  CONFLICT: "This name is already in use.",
  CROSS_ORIGIN_FORBIDDEN: "This request is not allowed from the current browser context.",
  INVALID_REQUEST_BODY: "The content format is not correct.",
  INVALID_REQUEST_PARAMETER: "Please enter a valid value.",
  INVALID_UUID: "This link is invalid. Please reopen the page and try again.",
  LOGIN_DENIED: "You don't have permission to do this.",
  REFERENCED_RESOURCE_MISSING: "The selected item is no longer available.",
  RESOURCE_NOT_FOUND: "The selected item is no longer available.",
  RESOURCE_SCOPE_FORBIDDEN: "The selected item is outside the current allowed scope.",
  SELF_SERVE_FORBIDDEN: "This item can't be edited here yet.",
  SELF_SERVE_MEMBERSHIP_REQUIRED: "You don't have permission to do this.",
  SELF_SERVE_PROJECT_NOT_FOUND: "The selected item is no longer available.",
  SELF_SERVE_PROJECT_SCOPE_FORBIDDEN: "The selected item is outside the current allowed scope.",
  SELF_SERVE_PROVIDER_CONNECTION_NOT_FOUND: "The selected item is no longer available.",
  SERVICE_UNAVAILABLE: "Can't connect right now. Please try again.",
  SESSION_EXPIRED: "Your session expired. Please sign in again.",
  SESSION_REVOKED: "Your session is no longer active. Please sign in again.",
  TEAMOPS_MISSING_TABLE: "This page is not ready yet.",
};

function stripRequestTrace(message: string) {
  return message.replace(/\s+\[(?:requestId|correlationId|sourceRequestId)=[^\]]+\]$/i, "").trim();
}

function getFieldLabel(key: string) {
  const normalized = key.trim();
  const labels: Record<string, string> = {
    name: "a name",
    slug: "an ID",
    label: "a name",
    organizationId: "an organization",
    workspaceId: "a workspace",
    projectId: "a project",
    environmentId: "an environment",
    providerConnectionId: "a connection",
    apiKey: "an access key",
    format: "a format",
    filtersJson: "the current filters",
    alertId: "an alert",
    ownerLabel: "an owner",
    surface: "a page",
    memberId: "a member",
    savedViewId: "a saved view",
  };

  return labels[normalized] ?? "the required information";
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("errorCode" in error && typeof error.errorCode === "string" && error.errorCode.trim()) {
    return error.errorCode.trim();
  }

  if ("code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/u.test(error.code.trim())) {
    return error.code.trim();
  }

  if ("error" in error && error.error && typeof error.error === "object") {
    return getErrorCode(error.error);
  }

  if ("cause" in error && error.cause) {
    return getErrorCode(error.cause);
  }

  return null;
}

function getErrorResource(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("errorResource" in error && typeof error.errorResource === "string" && error.errorResource.trim()) {
    return error.errorResource.trim();
  }

  if ("resource" in error && typeof error.resource === "string" && error.resource.trim()) {
    return error.resource.trim();
  }

  if ("error" in error && error.error && typeof error.error === "object") {
    return getErrorResource(error.error);
  }

  if ("cause" in error && error.cause) {
    return getErrorResource(error.cause);
  }

  return null;
}

export function toFriendlyRequiredMessage(key: string) {
  return `Please enter ${getFieldLabel(key)}.`;
}

export function getUserErrorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  const errorCode = getErrorCode(error);
  const errorResource = getErrorResource(error);
  if (errorCode === "TEAMOPS_MISSING_TABLE" && errorResource === "provider_connections") {
    return "Providers can't be saved until database migrations are up to date.";
  }

  if (errorCode === "TEAMOPS_MISSING_TABLE" && errorResource === "workspace_model_catalog") {
    return "Developer access models aren't ready until database migrations are up to date.";
  }

  if (errorCode === "INVALID_REQUEST" || errorCode === "UNEXPECTED_ERROR") {
    return fallback;
  }

  if (errorCode && errorCodeMessages[errorCode]) {
    return errorCodeMessages[errorCode];
  }

  const rawMessage = error instanceof Error ? stripRequestTrace(error.message.trim()) : "";

  if (!rawMessage) {
    return fallback;
  }

  const requiredMatch = rawMessage.match(/^([A-Za-z0-9_.-]+) is required$/i);
  if (requiredMatch) {
    return toFriendlyRequiredMessage(requiredMatch[1] ?? "");
  }

  if (/must be valid json|must be a json object/i.test(rawMessage)) {
    return "The content format is not correct.";
  }

  if (/already exists|duplicate key|unique constraint/i.test(rawMessage)) {
    return "This name is already in use.";
  }

  if (/organization slug already exists/i.test(rawMessage)) {
    return "This organization ID is already in use.";
  }

  if (/slug must contain at least one letter or number/i.test(rawMessage)) {
    return "Please enter a valid ID.";
  }

  if (/name must contain at least one letter or number/i.test(rawMessage)) {
    return "Please enter a valid name.";
  }

  if (/must be a valid uuid|not a valid uuid|invalid uuid/i.test(rawMessage)) {
    return "This link is invalid. Please reopen the page and try again.";
  }

  if (/must be a valid date time|must be a valid datetime/i.test(rawMessage)) {
    return "Please enter a valid time.";
  }

  if (/must be a positive number|must be between/i.test(rawMessage)) {
    return "Please enter a valid number.";
  }

  if (/provide a name or slug to update/i.test(rawMessage)) {
    return "Please enter something to save.";
  }

  if (/select at least one/i.test(rawMessage)) {
    return "Please select at least one item.";
  }

  if (/not editable from the current admin flow yet/i.test(rawMessage)) {
    return "This item can't be edited here yet.";
  }

  if (/not found|no longer available/i.test(rawMessage)) {
    return "The selected item is no longer available.";
  }

  if (/forbidden|permission|unauthorized|not allowed/i.test(rawMessage)) {
    return "You don't have permission to do this.";
  }

  if (/unavailable|timeout|timed out|temporarily unavailable/i.test(rawMessage)) {
    return "Can't connect right now. Please try again.";
  }

  if (/unable to update the selected alerts right now/i.test(rawMessage)) {
    return "Can't update this right now. Please try again.";
  }

  if (/unexpected control api error/i.test(rawMessage)) {
    return fallback;
  }

  if (technicalErrorPattern.test(rawMessage)) {
    return fallback;
  }

  return rawMessage;
}
