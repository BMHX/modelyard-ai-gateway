import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET } from "./route";

test("auth callback redirects to login with callback diagnostics when control api rejects oidc callback", async () => {
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
          code: "OIDC_NO_ACTIVE_MEMBERSHIP",
          message: "No active workspace membership was found for this login",
          details: {
            authStage: "oidc_callback",
            organizationSlug: "pilot-demo-org",
            returnTo: "/providers",
          },
        },
      }),
      {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-callback-1",
          "x-correlation-id": "corr-callback-1",
        },
      },
    )) as typeof fetch;

  try {
    const response = await GET(
      new NextRequest("http://127.0.0.1:3001/auth/callback?code=oidc-code&state=oidc-state"),
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
      "No active workspace membership was found for this login",
    );
    assert.equal(redirectUrl.searchParams.get("errorCode"), "OIDC_NO_ACTIVE_MEMBERSHIP");
    assert.equal(redirectUrl.searchParams.get("errorStage"), "oidc_callback");
    assert.equal(redirectUrl.searchParams.get("requestId"), "req-callback-1");
    assert.equal(redirectUrl.searchParams.get("correlationId"), "corr-callback-1");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.CONTROL_API_BASE_URL = originalControlApiBaseUrl;
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_ADMIN_TOKEN = originalAdminToken;
  }
});

test("auth callback sets a secure session cookie on successful oidc login", async () => {
  const originalFetch = globalThis.fetch;
  const originalControlApiBaseUrl = process.env.CONTROL_API_BASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalAdminToken = process.env.CONTROL_API_ADMIN_TOKEN;

  process.env.CONTROL_API_BASE_URL = "http://127.0.0.1:4001";
  Object.assign(process.env, { NODE_ENV: "production" });
  process.env.WEB_ADMIN_AUTH_MODE = "bootstrap_admin";
  process.env.CONTROL_API_ADMIN_TOKEN = "test-admin-token";

  globalThis.fetch = (async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/v1/auth/login/callback")) {
      return new Response(
        JSON.stringify({
          sessionHandle: "s".repeat(32),
          returnTo: "/providers",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    if (url.endsWith("/v1/auth/session/identities")) {
      return new Response(
        JSON.stringify([
          {
            membershipId: "member-1",
            workspaceId: "workspace-1",
            workspaceName: "Workspace 1",
            roles: ["workspace_admin"],
          },
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await GET(
      new NextRequest("https://admin.example.com/auth/callback?code=oidc-code&state=oidc-state"),
    );

    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://admin.example.com/providers");
    const setCookie = response.headers.get("set-cookie");
    assert.ok(setCookie);
    assert.match(setCookie, /teamops_cp_session=/u);
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /Secure/u);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.CONTROL_API_BASE_URL = originalControlApiBaseUrl;
    Object.assign(process.env, { NODE_ENV: originalNodeEnv });
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_ADMIN_TOKEN = originalAdminToken;
  }
});

test("auth callback redirects to identity selection when the session has multiple identity options", async () => {
  const originalFetch = globalThis.fetch;
  const originalControlApiBaseUrl = process.env.CONTROL_API_BASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalAdminToken = process.env.CONTROL_API_ADMIN_TOKEN;
  let identitiesAuthHeader = "";

  process.env.CONTROL_API_BASE_URL = "http://127.0.0.1:4001";
  Object.assign(process.env, { NODE_ENV: "production" });
  process.env.WEB_ADMIN_AUTH_MODE = "bootstrap_admin";
  process.env.CONTROL_API_ADMIN_TOKEN = "test-admin-token";

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/v1/auth/login/callback")) {
      return new Response(
        JSON.stringify({
          sessionHandle: "s".repeat(32),
          returnTo: "/providers",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    if (url.endsWith("/v1/auth/session/identities")) {
      const headers = new Headers(init?.headers);
      identitiesAuthHeader = headers.get("x-teamops-web-admin-auth") ?? "";
      return new Response(
        JSON.stringify([
          {
            membershipId: "member-1",
            workspaceId: "workspace-1",
            workspaceName: "Workspace 1",
            roles: ["workspace_admin", "developer"],
          },
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await GET(
      new NextRequest("https://admin.example.com/auth/callback?code=oidc-code&state=oidc-state"),
    );

    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "https://admin.example.com/auth/select-identity?returnTo=%2Fproviders",
    );
    assert.equal(identitiesAuthHeader, `session ${"s".repeat(32)}`);
    const setCookie = response.headers.get("set-cookie");
    assert.ok(setCookie);
    assert.match(setCookie, /teamops_cp_session=/u);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.CONTROL_API_BASE_URL = originalControlApiBaseUrl;
    Object.assign(process.env, { NODE_ENV: originalNodeEnv });
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_ADMIN_TOKEN = originalAdminToken;
  }
});
