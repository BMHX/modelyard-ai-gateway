export const CLIENT_DISCONNECT_ABORT_REASON = "client_disconnect";

type AbortCapableIncomingMessage = {
  on(event: "aborted", listener: () => void): unknown;
  off(event: "aborted", listener: () => void): unknown;
  aborted?: boolean;
  destroyed?: boolean;
};

type AbortCapableServerResponse = {
  on(event: "close", listener: () => void): unknown;
  off(event: "close", listener: () => void): unknown;
  destroyed?: boolean;
  writableEnded?: boolean;
};

function abortWithClientDisconnect(controller: AbortController) {
  if (!controller.signal.aborted) {
    controller.abort(CLIENT_DISCONNECT_ABORT_REASON);
  }
}

export function isClientDisconnectAbortReason(reason: unknown) {
  return reason === CLIENT_DISCONNECT_ABORT_REASON;
}

export function createUpstreamAbortSignal(args: {
  requestRaw: AbortCapableIncomingMessage;
  replyRaw: AbortCapableServerResponse;
  timeoutMs: number;
}) {
  const clientAbortController = new AbortController();

  const onRequestAborted = () => {
    abortWithClientDisconnect(clientAbortController);
  };
  const onReplyClose = () => {
    if (args.replyRaw.writableEnded) {
      return;
    }

    abortWithClientDisconnect(clientAbortController);
  };

  args.requestRaw.on("aborted", onRequestAborted);
  args.replyRaw.on("close", onReplyClose);

  if (args.requestRaw.aborted || (args.replyRaw.destroyed && !args.replyRaw.writableEnded)) {
    abortWithClientDisconnect(clientAbortController);
  }

  const signal = AbortSignal.any([AbortSignal.timeout(args.timeoutMs), clientAbortController.signal]);
  const cleanup = () => {
    args.requestRaw.off("aborted", onRequestAborted);
    args.replyRaw.off("close", onReplyClose);
  };

  return {
    signal,
    cleanup,
  };
}
