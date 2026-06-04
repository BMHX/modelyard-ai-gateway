import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST as postRevoke } from "./[virtualKeyId]/revoke/route";
import { POST as postRotate } from "./[virtualKeyId]/rotate/route";
import { GET as getBootstrap } from "./bootstrap/route";
import { POST as postIssue } from "./issue/route";
import { GET as getModels } from "./models/route";

const workspaceId = "48d1b8fb-a6a9-40a6-9492-3b36faf0ac99";
const projectId = "c62d384a-b94f-43d3-beb9-b33ce12cad4e";
const providerConnectionId = "b37a50d4-7e8a-4f01-8509-997faf77f9df";
const virtualKeyId = "11111111-1111-4111-8111-111111111111";

function withMockedControlApiEnv() {
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalMemberEmail = process.env.CONTROL_API_MEMBER_EMAIL;
  const originalControlApiBaseUrl = process.env.CONTROL_API_BASE_URL;

  process.env.WEB_ADMIN_AUTH_MODE = "bootstrap_member_email";
  process.env.CONTROL_API_MEMBER_EMAIL = "developer@example.com";
  process.env.CONTROL_API_BASE_URL = "http://127.0.0.1:4001";

  return () => {
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_MEMBER_EMAIL = originalMemberEmail;
    process.env.CONTROL_API_BASE_URL = originalControlApiBaseUrl;
  };
}

function withMockedSessionEnv() {
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalControlApiBaseUrl = process.env.CONTROL_API_BASE_URL;

  process.env.WEB_ADMIN_AUTH_MODE = "session";
  process.env.CONTROL_API_BASE_URL = "http://127.0.0.1:4001";

  return () => {
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_BASE_URL = originalControlApiBaseUrl;
  };
}

function createJsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

test("bootstrap route proxies the non-trailing-slash path to the control api", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = withMockedControlApiEnv();
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input) => {
    requestedUrls.push(String(input));
    return createJsonResponse(
      {
        allowed: true,
        allowedProjects: [],
        availableTargets: [],
        providerConnections: [],
        availableModels: [],
        activeTokens: [],
        defaults: {
          ttlHours: 24,
          environmentRuntime: "development",
          projectId: null,
        },
      },
      200,
    );
  }) as typeof fetch;

  try {
    const response = await getBootstrap(
      new NextRequest(
        `http://127.0.0.1:3001/api/console/self-serve-virtual-keys/bootstrap?workspaceId=${workspaceId}`,
      ),
    );

    assert.equal(response.status, 200);
    assert.equal(
      requestedUrls[0],
      `http://127.0.0.1:4001/v1/workspaces/${workspaceId}/self-serve-virtual-keys/bootstrap`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("issue route proxies only the issue payload fields to the control api", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = withMockedControlApiEnv();
  const requestedUrls: string[] = [];
  let receivedBody = "";

  globalThis.fetch = (async (input, init) => {
    requestedUrls.push(String(input));
    receivedBody = String(init?.body ?? "");
    return createJsonResponse(
      {
        id: virtualKeyId,
        workspaceId,
        providerConnectionId,
        projectId,
        environmentId: null,
        label: "self-serve-campaign-automation-admin-user",
        owner: "developer@example.com",
        team: null,
        service: "self-serve",
        environment: "development",
        status: "active",
        keyPrefix: "vk_test",
        scopes: ["gateway:models"],
        expiresAt: "2026-04-27T00:00:00.000Z",
        lastUsedAt: null,
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z",
        issuanceMode: "self_serve",
        issuedByMemberId: "a1a6a5e5-46af-42f3-b40c-dc664b9696ac",
        token: "vk_live_test",
      },
      201,
    );
  }) as typeof fetch;

  try {
    const response = await postIssue(
      new NextRequest(
        "http://127.0.0.1:3001/api/console/self-serve-virtual-keys/issue",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId,
            projectId,
            providerConnectionId,
            protocol: "openai-compatible",
          }),
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    assert.equal(response.status, 201);
    assert.equal(
      requestedUrls[0],
      `http://127.0.0.1:4001/v1/workspaces/${workspaceId}/self-serve-virtual-keys/issue`,
    );
    assert.equal(
      receivedBody,
      JSON.stringify({
        projectId,
        protocol: "openai-compatible",
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("models route proxies the provider query to the control api", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = withMockedControlApiEnv();
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input) => {
    requestedUrls.push(String(input));
    return createJsonResponse(
      {
        providerConnectionId,
        models: [],
      },
      200,
    );
  }) as typeof fetch;

  try {
    const response = await getModels(
      new NextRequest(
        `http://127.0.0.1:3001/api/console/self-serve-virtual-keys/models?workspaceId=${workspaceId}&providerConnectionId=${providerConnectionId}`,
      ),
    );

    assert.equal(response.status, 200);
    assert.equal(
      requestedUrls[0],
      `http://127.0.0.1:4001/v1/workspaces/${workspaceId}/self-serve-virtual-keys/models?providerConnectionId=${providerConnectionId}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("bootstrap, models, issue, rotate, and revoke all forward the current session cookie in session auth mode", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = withMockedSessionEnv();
  const receivedAuthHeaders: string[] = [];

  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers);
    receivedAuthHeaders.push(headers.get("x-teamops-web-admin-auth") ?? "");
    return createJsonResponse({ ok: true }, 200);
  }) as typeof fetch;

  const requestHeaders = {
    cookie: "teamops_cp_session=session-handle-123",
    "content-type": "application/json",
  };

  try {
    await getBootstrap(
      new NextRequest(
        `http://127.0.0.1:3001/api/console/self-serve-virtual-keys/bootstrap?workspaceId=${workspaceId}`,
        {
          headers: requestHeaders,
        },
      ),
    );

    await getModels(
      new NextRequest(
        `http://127.0.0.1:3001/api/console/self-serve-virtual-keys/models?workspaceId=${workspaceId}&providerConnectionId=${providerConnectionId}`,
        {
          headers: requestHeaders,
        },
      ),
    );

    await postIssue(
      new NextRequest(
        "http://127.0.0.1:3001/api/console/self-serve-virtual-keys/issue",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId,
            projectId,
            protocol: "openai-compatible",
          }),
          headers: requestHeaders,
        },
      ),
    );

    await postRotate(
      new NextRequest(
        `http://127.0.0.1:3001/api/console/self-serve-virtual-keys/${virtualKeyId}/rotate`,
        {
          method: "POST",
          body: JSON.stringify({ workspaceId }),
          headers: requestHeaders,
        },
      ),
      {
        params: Promise.resolve({ virtualKeyId }),
      },
    );

    await postRevoke(
      new NextRequest(
        `http://127.0.0.1:3001/api/console/self-serve-virtual-keys/${virtualKeyId}/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ workspaceId }),
          headers: requestHeaders,
        },
      ),
      {
        params: Promise.resolve({ virtualKeyId }),
      },
    );

    assert.deepEqual(receivedAuthHeaders, [
      "session session-handle-123",
      "session session-handle-123",
      "session session-handle-123",
      "session session-handle-123",
      "session session-handle-123",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("models route rejects a missing providerConnectionId before calling the control api", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = withMockedControlApiEnv();
  let fetchCalled = false;

  globalThis.fetch = (async () => {
    fetchCalled = true;
    return createJsonResponse({ ok: true }, 200);
  }) as typeof fetch;

  try {
    const response = await getModels(
      new NextRequest(
        `http://127.0.0.1:3001/api/console/self-serve-virtual-keys/models?workspaceId=${workspaceId}`,
      ),
    );

    assert.equal(response.status, 400);
    assert.equal(fetchCalled, false);
    assert.deepEqual(await response.json(), {
      error: {
        message: "providerConnectionId is required",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("rotate route rejects a missing workspaceId before calling the control api", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = withMockedControlApiEnv();
  let fetchCalled = false;

  globalThis.fetch = (async () => {
    fetchCalled = true;
    return createJsonResponse({ ok: true }, 200);
  }) as typeof fetch;

  try {
    const response = await postRotate(
      new NextRequest(
        `http://127.0.0.1:3001/api/console/self-serve-virtual-keys/${virtualKeyId}/rotate`,
        {
          method: "POST",
          body: JSON.stringify({}),
          headers: {
            "content-type": "application/json",
          },
        },
      ),
      {
        params: Promise.resolve({ virtualKeyId }),
      },
    );

    assert.equal(response.status, 400);
    assert.equal(fetchCalled, false);
    assert.deepEqual(await response.json(), {
      error: {
        message: "workspaceId is required",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
