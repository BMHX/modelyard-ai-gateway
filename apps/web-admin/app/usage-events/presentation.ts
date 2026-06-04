import type { UsageEvent } from "@teamops/contracts";

export function getMetadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

export function getUsageEventMetadataString(event: Pick<UsageEvent, "metadata">, key: string) {
  const metadata = getMetadataRecord(event.metadata);
  const value = metadata[key];
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

export function getUsageEventBudgetPolicyId(event: Pick<UsageEvent, "metadata">) {
  return getUsageEventMetadataString(event, "budgetPolicyId");
}

export function humanizeReason(value: string | null) {
  if (!value) {
    return null;
  }

  return value.replace(/_/g, " ");
}

export type UsageEventTagTone = "default" | "warning" | "critical" | "resolved";

type UsageEventTag = {
  label: string;
  tone?: UsageEventTagTone;
};

function readHttpStatus(metadata: Record<string, unknown>) {
  if (typeof metadata.httpStatusCode === "number") {
    return metadata.httpStatusCode;
  }

  if (typeof metadata.upstreamStatusCode === "number") {
    return metadata.upstreamStatusCode;
  }

  return null;
}

function readPath(metadata: Record<string, unknown>) {
  return typeof metadata.path === "string" ? metadata.path : null;
}

function readProtocol(metadata: Record<string, unknown>) {
  return typeof metadata.protocol === "string" ? metadata.protocol : null;
}

function isMetadataPath(path: string | null) {
  return path === "/v1/models" || path?.startsWith("/v1/models/") === true;
}

function getMetadataDisplayName(path: string | null) {
  if (!path) {
    return null;
  }

  if (path === "/v1/models") {
    return "usage.presentation.modelCatalog";
  }

  if (!path.startsWith("/v1/models/")) {
    return null;
  }

  const rawModelId = path.slice("/v1/models/".length);
  if (!rawModelId) {
    return "usage.presentation.modelDetail";
  }

  try {
    return decodeURIComponent(rawModelId);
  } catch {
    return rawModelId;
  }
}

export function getTagClassName(tone: UsageEventTagTone = "default") {
  switch (tone) {
    case "warning":
      return "tag tag--warning";
    case "critical":
      return "tag tag--critical";
    case "resolved":
      return "tag tag--resolved";
    default:
      return "tag";
  }
}

export function getUsageEventStatusTone(status: UsageEvent["status"]): UsageEventTagTone {
  if (status === "success") {
    return "resolved";
  }

  if (status === "error") {
    return "warning";
  }

  return "critical";
}

export function getUsageEventSurface(event: UsageEvent) {
  const metadata = getMetadataRecord(event.metadata);
  const path = readPath(metadata);
  const protocol = readProtocol(metadata);
  const httpStatus = readHttpStatus(metadata);
  const streamError = typeof metadata.streamError === "string" && metadata.streamError.trim() ? metadata.streamError : null;
  const streamInterrupted = metadata.streamInterrupted === true || streamError !== null;
  const streamed = metadata.streamed === true;
  const demoMode = metadata.demoMode === true;
  const metadataRequest = isMetadataPath(path);
  const tags: UsageEventTag[] = [];

  if (metadataRequest) {
    tags.push({
      label: "metadata",
    });
  }
  if (streamed) {
    tags.push({
      label: "streamed",
    });
  }
  if (streamInterrupted) {
    tags.push({
      label: "interrupted",
      tone: "warning",
    });
  }
  if (demoMode) {
    tags.push({
      label: "demo",
    });
  }
  if (httpStatus !== null) {
    tags.push({
      label: `HTTP ${httpStatus}`,
      tone: httpStatus >= 500 ? "critical" : httpStatus >= 400 ? "warning" : httpStatus >= 200 ? "resolved" : "default",
    });
  }

  return {
    path,
    protocol,
    httpStatus,
    streamInterrupted,
    streamError,
    streamed,
    demoMode,
    metadataRequest,
    displayName: event.model ?? getMetadataDisplayName(path) ?? "unknown model",
    tags,
  };
}

export function describeUsageEventOutcome(event: UsageEvent) {
  const metadata = getMetadataRecord(event.metadata);
  const upstreamError = getMetadataRecord(metadata.upstreamError);
  const streamInterrupted = metadata.streamInterrupted === true;
  const streamError = typeof metadata.streamError === "string" && metadata.streamError.trim() ? metadata.streamError : null;
  const httpStatus =
    typeof metadata.httpStatusCode === "number"
      ? `HTTP ${metadata.httpStatusCode}`
      : typeof metadata.upstreamStatusCode === "number"
        ? `HTTP ${metadata.upstreamStatusCode}`
        : null;
  const explicitReason = typeof metadata.reason === "string" ? humanizeReason(metadata.reason) : null;
  const upstreamErrorCode = typeof upstreamError.code === "string" ? humanizeReason(upstreamError.code) : null;
  const finishReason =
    typeof metadata.finishReason === "string"
      ? metadata.finishReason
      : typeof metadata.stopReason === "string"
        ? metadata.stopReason
        : null;
  const fallbackReason =
    streamInterrupted
      ? "stream interrupted"
      : event.status === "success"
      ? "usage.presentation.completed"
      : event.status === "blocked"
        ? "usage.presentation.blockedWithoutReason"
        : "usage.presentation.errorWithoutReason";
  const reasonLabel = explicitReason ?? upstreamErrorCode ?? finishReason ?? fallbackReason;
  const reasonKey = reasonLabel.toLowerCase();
  const upstreamMessage =
    typeof upstreamError.message === "string"
      ? upstreamError.message
      : streamError
        ? streamError
      : typeof metadata.error === "string"
        ? metadata.error
        : null;

  return {
    headline: [httpStatus, reasonLabel].filter(Boolean).join(" · ") || (event.status === "success" ? "usage.presentation.completedTitle" : "usage.presentation.noContext"),
    detail: upstreamMessage,
    reasonKey,
    reasonLabel,
  };
}

export function formatUsageEventMetadata(value: unknown) {
  const metadata = getMetadataRecord(value);
  if (!Object.keys(metadata).length) {
    return null;
  }

  return JSON.stringify(metadata, null, 2);
}
