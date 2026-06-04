import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET as getSettings } from "./route";
import { POST as postRuntime } from "./runtime/route";
import { POST as postWorkspaceDefaults } from "./workspace-defaults/route";
import { POST as postProbe } from "./probe/route";

test("settings routes persist runtime and workspace defaults into the configured file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "teamops-settings-"));
  const previousPath = process.env.WEB_ADMIN_SETTINGS_FILE;
  process.env.WEB_ADMIN_SETTINGS_FILE = path.join(tempDir, "console-settings.json");

  try {
    const runtimeResponse = await postRuntime(
      new NextRequest("http://127.0.0.1:3001/api/console/settings/runtime", {
        method: "POST",
        body: JSON.stringify({
          gatewayBaseUrl: "https://gateway.example.com",
          gatewayRequestBasePath: "/v1",
          gatewayChatCompletionsPath: "/chat/completions",
          gatewayResponsesPath: "/responses",
          gatewayModelsPath: "/models",
          gatewayHealthPath: "/healthz",
          gatewayRequestTimeoutMs: 12000,
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    assert.equal(runtimeResponse.status, 200);

    const workspaceResponse = await postWorkspaceDefaults(
      new NextRequest(
        "http://127.0.0.1:3001/api/console/settings/workspace-defaults",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId: "11111111-1111-4111-8111-111111111111",
            defaultProviderConnectionId: "22222222-2222-4222-8222-222222222222",
            defaultModelCatalogSourceHint: "customer-gateway",
            defaultVirtualKeyTtlHours: 36,
            defaultVirtualKeyScopesTemplate: ["gateway:models", "qa"],
            defaultProjectId: "33333333-3333-4333-8333-333333333333",
          }),
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    assert.equal(workspaceResponse.status, 200);

    const settingsResponse = await getSettings();
    const payload = (await settingsResponse.json()) as Awaited<
      ReturnType<typeof settingsResponse.json>
    >;

    assert.equal(payload.runtimeSettings.gatewayBaseUrl, "https://gateway.example.com");
    assert.equal(
      payload.workspaceDefaultsById["11111111-1111-4111-8111-111111111111"]
        ?.defaultVirtualKeyTtlHours,
      36,
    );
    assert.deepEqual(
      payload.workspaceDefaultsById["11111111-1111-4111-8111-111111111111"]
        ?.defaultVirtualKeyScopesTemplate,
      ["gateway:models", "qa"],
    );
  } finally {
    process.env.WEB_ADMIN_SETTINGS_FILE = previousPath;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("settings probe route returns live probe diagnostics", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        service: "gateway",
        timestamp: "2026-04-26T00:00:00.000Z",
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    )) as typeof fetch;

  try {
    const response = await postProbe(
      new NextRequest("http://127.0.0.1:3001/api/console/settings/probe", {
        method: "POST",
        body: JSON.stringify({
          gatewayBaseUrl: "https://gateway.example.com",
          gatewayRequestBasePath: "/v1",
          gatewayChatCompletionsPath: "/chat/completions",
          gatewayResponsesPath: "/responses",
          gatewayModelsPath: "/models",
          gatewayHealthPath: "/healthz",
          gatewayRequestTimeoutMs: 12000,
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const payload = (await response.json()) as Awaited<
      ReturnType<typeof response.json>
    >;

    assert.equal(payload.ok, true);
    assert.equal(payload.service, "gateway");
    assert.equal(payload.url, "https://gateway.example.com/healthz");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
