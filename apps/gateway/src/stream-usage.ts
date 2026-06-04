import type { GatewayProviderUsageEvent } from "./providers/types.js";

function formatStreamError(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "unknown stream pipeline error";
}

export function finalizeStreamUsageEvent(args: {
  usageEvent: GatewayProviderUsageEvent;
  streamError: unknown | null;
  clientDisconnected: boolean;
}): GatewayProviderUsageEvent {
  const existingMetadata = args.usageEvent.metadata as Record<string, unknown>;
  const existingReason = typeof existingMetadata.reason === "string" ? existingMetadata.reason : undefined;
  const metadata: Record<string, unknown> = {
    ...existingMetadata,
    streamError: args.streamError ? formatStreamError(args.streamError) : null,
    streamInterrupted: args.streamError !== null,
  };

  if (!args.streamError) {
    return {
      ...args.usageEvent,
      metadata,
    };
  }

  return {
    ...args.usageEvent,
    status: "error",
    metadata: {
      ...metadata,
      reason: existingReason ?? (args.clientDisconnected ? "client_disconnected" : "stream_pipeline_terminated"),
    },
  };
}
