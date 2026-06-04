import test from "node:test";
import assert from "node:assert/strict";

import { getConfiguredRequestHeaders } from "./shared.js";

test("getConfiguredRequestHeaders extracts configured upstream headers", () => {
  const headers = getConfiguredRequestHeaders({
    "header.HTTP-Referer": "https://example.com/app",
    "headers.X-Title": "Token Team Ops",
    ignored: "value",
  });

  assert.deepEqual(headers, {
    "HTTP-Referer": "https://example.com/app",
    "X-Title": "Token Team Ops",
  });
});

test("getConfiguredRequestHeaders refuses sensitive header overrides", () => {
  const headers = getConfiguredRequestHeaders({
    "header.Authorization": "Bearer should-not-pass",
    "header.x-api-key": "should-not-pass",
    "header.Content-Length": "999",
    "header.X-Trace-Source": "gateway",
  });

  assert.deepEqual(headers, {
    "X-Trace-Source": "gateway",
  });
});
