import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  CLIENT_DISCONNECT_ABORT_REASON,
  createUpstreamAbortSignal,
} from "./request-abort.js";

function createAbortCapablePair() {
  const requestRaw = Object.assign(new EventEmitter(), {
    aborted: false,
    destroyed: false,
  });
  const replyRaw = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
  });

  return {
    requestRaw,
    replyRaw,
  };
}

test("createUpstreamAbortSignal aborts when request is aborted", () => {
  const { requestRaw, replyRaw } = createAbortCapablePair();
  const handle = createUpstreamAbortSignal({
    requestRaw,
    replyRaw,
    timeoutMs: 10_000,
  });

  requestRaw.aborted = true;
  requestRaw.emit("aborted");

  assert.equal(handle.signal.aborted, true);
  assert.equal(handle.signal.reason, CLIENT_DISCONNECT_ABORT_REASON);
  handle.cleanup();
});

test("createUpstreamAbortSignal ignores normal reply close after writable end", () => {
  const { requestRaw, replyRaw } = createAbortCapablePair();
  const handle = createUpstreamAbortSignal({
    requestRaw,
    replyRaw,
    timeoutMs: 10_000,
  });

  replyRaw.writableEnded = true;
  replyRaw.emit("close");

  assert.equal(handle.signal.aborted, false);
  handle.cleanup();
});

test("createUpstreamAbortSignal does not treat a destroyed request stream as a disconnect by itself", () => {
  const { requestRaw, replyRaw } = createAbortCapablePair();
  requestRaw.destroyed = true;

  const handle = createUpstreamAbortSignal({
    requestRaw,
    replyRaw,
    timeoutMs: 10_000,
  });

  assert.equal(handle.signal.aborted, false);
  handle.cleanup();
});

test("createUpstreamAbortSignal aborts when reply is already destroyed before write end", () => {
  const { requestRaw, replyRaw } = createAbortCapablePair();
  replyRaw.destroyed = true;

  const handle = createUpstreamAbortSignal({
    requestRaw,
    replyRaw,
    timeoutMs: 10_000,
  });

  assert.equal(handle.signal.aborted, true);
  assert.equal(handle.signal.reason, CLIENT_DISCONNECT_ABORT_REASON);
  handle.cleanup();
});
