import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient } from "@tanstack/react-query";

import {
  ConsoleAuthRedirectError,
  ConsoleHttpError,
  fetchProviderConnectionModelCatalogPreview,
  fetchSelfServeProviderModels,
  postConsoleJson,
  postConsoleVoid,
  prefetchConsoleRouteData,
} from "./console-api-client";

function setMockWindow(pathname: string, search: string) {
  const originalWindow = globalThis.window;
  let assignedUrl = "";
  const mockWindow = {
    location: {
      origin: "https://console.example.com",
      pathname,
      search,
      assign(url: string) {
        assignedUrl = url;
      },
    },
  } as Window & typeof globalThis;

  Object.defineProperty(globalThis, "window", {
    value: mockWindow,
    configurable: true,
    writable: true,
  });

  return {
    getAssignedUrl() {
      return assignedUrl;
    },
    restore() {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    },
  };
}

test("postConsoleJson preserves console error status and code", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "SELF_SERVE_MISSING_DEFAULT",
          message: "No default route",
        },
      }),
      {
        status: 409,
        headers: {
          "content-type": "application/json",
        },
      },
    );

  try {
    await assert.rejects(
      postConsoleJson("/api/console/self-serve-virtual-keys/issue", {
        workspaceId: "workspace_123",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ConsoleHttpError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "SELF_SERVE_MISSING_DEFAULT");
        assert.equal(error.message, "No default route");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postConsoleVoid preserves console error status and code", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "LOGIN_DENIED",
          message: "The requested membership is not available in this session",
        },
      }),
      {
        status: 403,
        headers: {
          "content-type": "application/json",
        },
      },
    );

  try {
    await assert.rejects(
      postConsoleVoid("/api/auth/session/active-identity", {
        membershipId: "member-1",
        role: "workspace_admin",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ConsoleHttpError);
        assert.equal(error.status, 403);
        assert.equal(error.code, "LOGIN_DENIED");
        assert.equal(
          error.message,
          "The requested membership is not available in this session",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postConsoleJson redirects to login on session auth failures", async () => {
  const originalFetch = globalThis.fetch;
  const windowControl = setMockWindow("/access", "?workspaceId=abc");

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "SESSION_EXPIRED",
          message: "Your session expired. Please sign in again.",
        },
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      },
    );

  try {
    await assert.rejects(
      postConsoleJson("/api/console/self-serve-virtual-keys/issue", {
        workspaceId: "workspace_123",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ConsoleAuthRedirectError);
        assert.equal(error.message, "Your session expired. Please sign in again.");
        return true;
      },
    );

    assert.equal(
      windowControl.getAssignedUrl(),
      "/login?returnTo=%2Faccess%3FworkspaceId%3Dabc",
    );
  } finally {
    globalThis.fetch = originalFetch;
    windowControl.restore();
  }
});

test("postConsoleVoid redirects to login on auth-required responses", async () => {
  const originalFetch = globalThis.fetch;
  const windowControl = setMockWindow("/providers", "?workspaceId=abc");

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication is required for this route",
        },
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      },
    );

  try {
    await assert.rejects(
      postConsoleVoid("/api/auth/session/active-identity", {
        membershipId: "member-1",
        role: "workspace_admin",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ConsoleAuthRedirectError);
        assert.equal(error.message, "Authentication is required for this route");
        return true;
      },
    );

    assert.equal(
      windowControl.getAssignedUrl(),
      "/login?returnTo=%2Fproviders%3FworkspaceId%3Dabc",
    );
  } finally {
    globalThis.fetch = originalFetch;
    windowControl.restore();
  }
});

test("postConsoleVoid forwards abort signals to fetch", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null = null;

  globalThis.fetch = (async (_input, init) => {
    receivedSignal = init?.signal ?? null;
    if (init?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }) as typeof fetch;

  controller.abort();

  try {
    await assert.rejects(
      postConsoleVoid(
        "/api/auth/session/active-identity",
        {
          membershipId: "member-1",
          role: "workspace_admin",
        },
        {
          signal: controller.signal,
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof DOMException);
        assert.equal(error.name, "AbortError");
        assert.equal(receivedSignal, controller.signal);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchProviderConnectionModelCatalogPreview serializes baseUrl into metadata for openai-compatible relays", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";

  globalThis.fetch = (async (_input, init) => {
    requestBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        providerConnectionId: null,
        fetchedAt: new Date().toISOString(),
        status: "ready",
        message: null,
        items: [{ id: "gpt-4.1", label: "gpt-4.1", ownedBy: null }],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    await fetchProviderConnectionModelCatalogPreview({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      provider: "openai-compatible",
      label: "New API relay platform",
      apiKey: "sk-test-12345678",
      baseUrl: "https://relay.example.com/v1",
    });

    assert.deepEqual(JSON.parse(requestBody), {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      provider: "openai-compatible",
      label: "New API relay platform",
      apiKey: "sk-test-12345678",
      metadata: {
        baseUrl: "https://relay.example.com/v1",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("prefetchConsoleRouteData skips route prefetch work when requested", async () => {
  let called = false;
  const queryClient = {
    prefetchQuery: async () => {
      called = true;
      return null;
    },
  } as unknown as QueryClient;

  await prefetchConsoleRouteData(
    queryClient,
    "/providers?workspaceId=11111111-1111-4111-8111-111111111111",
    { skip: true },
  );

  assert.equal(called, false);
});

test("fetchSelfServeProviderModels forwards workspace and provider connection identifiers", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        providerConnectionId: "11111111-1111-4111-8111-111111111111",
        fetchedAt: "2026-04-25T00:00:00.000Z",
        items: [{ id: "gpt-4.1-mini", label: "gpt-4.1-mini", ownedBy: "openai" }],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    const response = await fetchSelfServeProviderModels({
      workspaceId: "22222222-2222-4222-8222-222222222222",
      providerConnectionId: "11111111-1111-4111-8111-111111111111",
    });

    assert.match(
      requestedUrl,
      /\/api\/console\/self-serve-virtual-keys\/models\?workspaceId=22222222-2222-4222-8222-222222222222&providerConnectionId=11111111-1111-4111-8111-111111111111$/,
    );
    assert.equal(response.items[0]?.id, "gpt-4.1-mini");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
