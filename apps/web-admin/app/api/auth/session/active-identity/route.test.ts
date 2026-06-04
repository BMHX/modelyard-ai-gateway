import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST } from "./route";

test("active identity route forwards the current session cookie to the control api", async () => {
  const originalFetch = globalThis.fetch;
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalControlApiBaseUrl = process.env.CONTROL_API_BASE_URL;
  let receivedAuthHeader = "";

  process.env.WEB_ADMIN_AUTH_MODE = "session";
  process.env.CONTROL_API_BASE_URL = "http://127.0.0.1:4001";

  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers);
    receivedAuthHeader = headers.get("x-teamops-web-admin-auth") ?? "";
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const response = await POST(
      new NextRequest("http://127.0.0.1:3001/api/auth/session/active-identity", {
        method: "POST",
        body: JSON.stringify({
          membershipId: "member-1",
          role: "developer",
        }),
        headers: {
          "content-type": "application/json",
          cookie: "teamops_cp_session=session-handle-456",
        },
      }),
    );

    assert.equal(response.status, 204);
    assert.equal(receivedAuthHeader, "session session-handle-456");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_BASE_URL = originalControlApiBaseUrl;
  }
});
