import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGatewayDirectUrl,
  buildGatewayEndpoint,
  buildGatewayProxyUpstreamUrl,
  buildGatewayRequestUrl,
  normalizeConsoleWorkspaceDefaults,
  normalizeAbsoluteUrl,
  normalizeRequestPath,
  normalizeTimeoutMs,
} from "./console-settings";

test("normalizeAbsoluteUrl trims trailing slash", () => {
  assert.equal(normalizeAbsoluteUrl("https://gateway.example.com/"), "https://gateway.example.com");
});

test("normalizeRequestPath adds a leading slash and removes trailing slash", () => {
  assert.equal(normalizeRequestPath("chat/completions/"), "/chat/completions");
});

test("buildGatewayEndpoint joins base url and request base path", () => {
  assert.equal(
    buildGatewayEndpoint({
      gatewayBaseUrl: "https://gateway.example.com/",
      gatewayRequestBasePath: "openai/v1/",
    }),
    "https://gateway.example.com/openai/v1",
  );
});

test("buildGatewayRequestUrl appends a configured request path", () => {
  assert.equal(
    buildGatewayRequestUrl(
      {
        gatewayBaseUrl: "https://gateway.example.com",
        gatewayRequestBasePath: "/openai/v1",
      },
      "/chat/completions",
    ),
    "https://gateway.example.com/openai/v1/chat/completions",
  );
});

test("buildGatewayProxyUpstreamUrl keeps the search string", () => {
  assert.equal(
    buildGatewayProxyUpstreamUrl(
      {
        gatewayBaseUrl: "https://gateway.example.com",
        gatewayRequestBasePath: "/openai/v1",
      },
      ["models"],
      "?limit=10",
    ),
    "https://gateway.example.com/openai/v1/models?limit=10",
  );
});

test("buildGatewayDirectUrl appends a direct gateway path outside the request base path", () => {
  assert.equal(
    buildGatewayDirectUrl(
      {
        gatewayBaseUrl: "https://gateway.example.com",
      },
      "/healthz",
    ),
    "https://gateway.example.com/healthz",
  );
});

test("normalizeTimeoutMs keeps valid integer values", () => {
  assert.equal(normalizeTimeoutMs("12000"), 12000);
});

test("normalizeConsoleWorkspaceDefaults normalizes ids, ttl, and scopes", () => {
  const defaults = normalizeConsoleWorkspaceDefaults({
    defaultProviderConnectionId: "11111111-1111-4111-8111-111111111111",
    defaultProjectId: "22222222-2222-4222-8222-222222222222",
    defaultVirtualKeyTtlHours: "48",
    defaultVirtualKeyScopesTemplate: "gateway:models, gateway:responses, qa",
  });

  assert.equal(
    defaults.defaultProviderConnectionId,
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(defaults.defaultVirtualKeyTtlHours, 48);
  assert.deepEqual(defaults.defaultVirtualKeyScopesTemplate, [
    "gateway:models",
    "gateway:responses",
    "qa",
  ]);
});
