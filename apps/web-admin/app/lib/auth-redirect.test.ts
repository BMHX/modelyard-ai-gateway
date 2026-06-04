import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { buildRequestScopedCurrentUrl, buildRequestScopedUrl } from "./auth-redirect";

test("buildRequestScopedUrl keeps the forwarded request host", () => {
  const request = new NextRequest("http://localhost:3001/auth/start?org=pilot-demo-org&returnTo=%2F", {
    headers: {
      host: "127.0.0.1:3001",
    },
  });

  const redirectUrl = buildRequestScopedUrl(request, "/login?returnTo=%2F");

  assert.equal(redirectUrl.toString(), "http://127.0.0.1:3001/login?returnTo=%2F");
});

test("buildRequestScopedCurrentUrl preserves the current path and query on the forwarded host", () => {
  const request = new NextRequest("http://localhost:3001/auth/test-login?org=pilot-demo-org&returnTo=%2F", {
    headers: {
      host: "127.0.0.1:3001",
    },
  });

  const currentUrl = buildRequestScopedCurrentUrl(request);

  assert.equal(
    currentUrl.toString(),
    "http://127.0.0.1:3001/auth/test-login?org=pilot-demo-org&returnTo=%2F",
  );
});
