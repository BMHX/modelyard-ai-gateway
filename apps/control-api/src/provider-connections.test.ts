import assert from "node:assert/strict";
import test from "node:test";

import { ProviderPricingConfigSchema } from "@teamops/contracts";

import {
  listManagedProviderConnectionModels,
  normalizeManagedProviderConnectionInput,
  normalizeManagedProviderConnectionUpdate,
  testManagedProviderConnection,
} from "./provider-connections.js";

test("normalizeManagedProviderConnectionInput trims and normalizes provider metadata", () => {
  const normalized = normalizeManagedProviderConnectionInput({
    workspaceId: "17c0776a-a415-47a6-accc-f2e6ee1b6e1b",
    provider: "openai-compatible",
    label: "  Gateway  ",
    apiKey: "  sk-test-12345678  ",
    metadata: {
      baseUrl: "https://gateway.example.com/v1/",
    },
  });

  assert.equal(normalized.label, "Gateway");
  assert.equal(normalized.apiKey, "sk-test-12345678");
  assert.equal(normalized.metadata.baseUrl, "https://gateway.example.com");
});

test("normalizeManagedProviderConnectionUpdate keeps routing metadata normalized for openai-compatible providers", () => {
  const normalized = normalizeManagedProviderConnectionUpdate("openai-compatible", {
    label: "  DeepSeek Proxy  ",
    metadata: {
      baseUrl: "https://gateway.example.com/v1/",
      defaultForProtocol: " openai-compatible ",
      modelPrefixes: " deepseek-, qwen- ",
      models: " deepseek-chat ",
    },
  });

  assert.equal(normalized.label, "DeepSeek Proxy");
  assert.equal(normalized.metadata?.baseUrl, "https://gateway.example.com");
  assert.equal(normalized.metadata?.defaultForProtocol, "openai-compatible");
  assert.equal(normalized.metadata?.modelPrefixes, "deepseek-, qwen-");
  assert.equal(normalized.metadata?.models, "deepseek-chat");
});

test("normalizeManagedProviderConnectionUpdate keeps manual pricing config intact", () => {
  const pricingConfig = ProviderPricingConfigSchema.parse({
    mode: "manual",
    rules: [
      {
        matchType: "fallback",
        model: null,
        rates: {
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
        },
      },
    ],
  });

  const normalized = normalizeManagedProviderConnectionUpdate("openai-compatible", {
    pricingConfig,
  });

  assert.deepEqual(normalized.pricingConfig, pricingConfig);
});

test("testManagedProviderConnection validates Anthropic credentials via models endpoint", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://api.anthropic.com/v1/models");
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "sk-ant-test-1234");
    assert.equal((init?.headers as Record<string, string>)["anthropic-version"], "2023-06-01");

    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    const result = await testManagedProviderConnection({
      connection: {
        id: "b80efc4f-db96-4a83-b18e-7e88f31bb7ca",
        provider: "anthropic",
      },
      apiKey: "sk-ant-test-1234",
      metadata: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testManagedProviderConnection returns upstream error messages for OpenAI-compatible failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://gateway.example.com/v1/models");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer sk-openai-compatible-test");

    return new Response(
      JSON.stringify({
        error: {
          message: "Invalid API key",
        },
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    const result = await testManagedProviderConnection({
      connection: {
        id: "313e3690-c4f0-493d-b868-cf65e6db1943",
        provider: "openai-compatible",
      },
      apiKey: "sk-openai-compatible-test",
      metadata: {
        baseUrl: "https://gateway.example.com/v1/",
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 401);
    assert.equal(result.message, "Invalid API key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listManagedProviderConnectionModels normalizes and sorts upstream catalog items", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        data: [
          { id: "gpt-4.1-mini", owned_by: "openai" },
          { id: "gpt-4.1", owned_by: "openai" },
          { id: "gpt-4.1-mini", owned_by: "openai" },
        ],
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
    const result = await listManagedProviderConnectionModels({
      connection: {
        id: "313e3690-c4f0-493d-b868-cf65e6db1943",
        provider: "openai",
      },
      apiKey: "sk-openai-compatible-test",
      metadata: {},
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.items, [
      {
        id: "gpt-4.1",
        label: "gpt-4.1",
        ownedBy: "openai",
      },
      {
        id: "gpt-4.1-mini",
        label: "gpt-4.1-mini",
        ownedBy: "openai",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
