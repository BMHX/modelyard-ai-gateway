import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET } from "./route";

test("auth start redirects to login with error diagnostics when control api rejects oidc start", async () => {
  const originalFetch = globalThis.fetch;
  const originalControlApiBaseUrl = process.env.CONTROL_API_BASE_URL;
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalAdminToken = process.env.CONTROL_API_ADMIN_TOKEN;

  process.env.CONTROL_API_BASE_URL = "http://127.0.0.1:4001";
  process.env.WEB_ADMIN_AUTH_MODE = "bootstrap_admin";
  process.env.CONTROL_API_ADMIN_TOKEN = "test-admin-token";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "OIDC_PROVIDER_NOT_CONFIGURED",
          message: "OIDC login is not configured for this organization",
          details: {
            authStage: "oidc_start",
            organizationSlug: "pilot-demo-org",
            returnTo: "/providers",
          },
        },
      }),
      {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-start-1",
          "x-correlation-id": "corr-start-1",
        },
      },
    )) as typeof fetch;

  try {
    const response = await GET(
      new NextRequest("http://127.0.0.1:3001/auth/start?org=pilot-demo-org&returnTo=%2Fproviders"),
    );

    assert.equal(response.status, 307);
    const location = response.headers.get("location");
    assert.ok(location);

    const redirectUrl = new URL(location);
    assert.equal(redirectUrl.pathname, "/login");
    assert.equal(redirectUrl.searchParams.get("org"), "pilot-demo-org");
    assert.equal(redirectUrl.searchParams.get("returnTo"), "/providers");
    assert.equal(
      redirectUrl.searchParams.get("error"),
      "OIDC login is not configured for this organization",
    );
    assert.equal(redirectUrl.searchParams.get("errorCode"), "OIDC_PROVIDER_NOT_CONFIGURED");
    assert.equal(redirectUrl.searchParams.get("errorStage"), "oidc_start");
    assert.equal(redirectUrl.searchParams.get("requestId"), "req-start-1");
    assert.equal(redirectUrl.searchParams.get("correlationId"), "corr-start-1");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.CONTROL_API_BASE_URL = originalControlApiBaseUrl;
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_ADMIN_TOKEN = originalAdminToken;
  }
});
