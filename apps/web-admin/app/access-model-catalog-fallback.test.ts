import assert from "node:assert/strict";
import test from "node:test";

import {
  getConfiguredSelfServeModelItems,
  mergeSelfServeModelCatalog,
} from "./[locale]/access/model-catalog-fallback";

test("getConfiguredSelfServeModelItems returns configured models for the selected connection", () => {
  const items = getConfiguredSelfServeModelItems(
    {
      allowed: true,
      allowedProjects: [],
      availableTargets: [],
      providerConnections: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          label: "Primary",
          provider: "openai-compatible",
          configuredModels: [
            {
              id: "deepseek-v3-custom",
              label: "DeepSeek V3 Custom",
              ownedBy: null,
            },
          ],
        },
      ],
      availableModels: [],
      availableSources: [],
      activeTokens: [],
      defaults: {
        ttlHours: 24,
        environmentRuntime: "development",
        projectId: null,
      },
    },
    "11111111-1111-4111-8111-111111111111",
  );

  assert.deepEqual(items, [
    {
      id: "deepseek-v3-custom",
      label: "DeepSeek V3 Custom",
      ownedBy: null,
    },
  ]);
});

test("mergeSelfServeModelCatalog appends configured models that are missing from the live catalog", () => {
  const catalog = mergeSelfServeModelCatalog({
    providerConnectionId: "11111111-1111-4111-8111-111111111111",
    liveCatalog: {
      providerConnectionId: "11111111-1111-4111-8111-111111111111",
      fetchedAt: "2026-04-28T00:00:00.000Z",
      items: [
        {
          id: "gpt-4.1",
          label: "gpt-4.1",
          ownedBy: "openai",
        },
      ],
    },
    configuredItems: [
      {
        id: "deepseek-v3-custom",
        label: "DeepSeek V3 Custom",
        ownedBy: null,
      },
      {
        id: "gpt-4.1",
        label: "GPT 4.1",
        ownedBy: null,
      },
    ],
  });

  assert.deepEqual(catalog, {
    providerConnectionId: "11111111-1111-4111-8111-111111111111",
    fetchedAt: "2026-04-28T00:00:00.000Z",
    items: [
      {
        id: "gpt-4.1",
        label: "gpt-4.1",
        ownedBy: "openai",
      },
      {
        id: "deepseek-v3-custom",
        label: "DeepSeek V3 Custom",
        ownedBy: null,
      },
    ],
  });
});

test("mergeSelfServeModelCatalog falls back to configured models when the live catalog is unavailable", () => {
  const catalog = mergeSelfServeModelCatalog({
    providerConnectionId: "11111111-1111-4111-8111-111111111111",
    liveCatalog: null,
    configuredItems: [
      {
        id: "deepseek-v3-custom",
        label: "DeepSeek V3 Custom",
        ownedBy: null,
      },
    ],
    fetchedAt: "2026-04-28T00:00:00.000Z",
  });

  assert.deepEqual(catalog, {
    providerConnectionId: "11111111-1111-4111-8111-111111111111",
    fetchedAt: "2026-04-28T00:00:00.000Z",
    items: [
      {
        id: "deepseek-v3-custom",
        label: "DeepSeek V3 Custom",
        ownedBy: null,
      },
    ],
  });
});
