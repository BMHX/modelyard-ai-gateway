import assert from "node:assert/strict";
import test from "node:test";

import { parseProviderModelConfig } from "@teamops/contracts";

import {
  addProviderCustomModelItem,
  buildProviderModelConfigFromMetadata,
  buildProviderModelConfigJson,
  createProviderModelConfig,
  getExactModelsValue,
  getLegacyModelIdsFromMetadata,
  upsertProviderModelItem,
} from "./provider-model-config";

test("provider model config serializes normalized items", () => {
  const config = createProviderModelConfig([
    {
      id: " GPT-4.1 ",
      label: "GPT-4.1",
      source: "preset",
    },
    {
      id: "custom-reasoner",
      label: " Custom Reasoner ",
      source: "custom",
    },
  ]);

  const parsed = parseProviderModelConfig(buildProviderModelConfigJson(config));
  assert.deepEqual(parsed, {
    version: 1,
    items: [
      {
        id: "gpt-4.1",
        label: "GPT-4.1",
        source: "preset",
      },
      {
        id: "custom-reasoner",
        label: "Custom Reasoner",
        source: "custom",
      },
    ],
  });
  assert.equal(getExactModelsValue(config), "gpt-4.1, custom-reasoner");
});

test("provider model config falls back to legacy models metadata", () => {
  const presetModelIds = new Set(["gpt-4.1-mini"]);
  const config = buildProviderModelConfigFromMetadata(
    {
      models: "gpt-4.1-mini, custom-proxy-model",
    },
    presetModelIds,
  );

  assert.deepEqual(config.items, [
    {
      id: "gpt-4.1-mini",
      label: "gpt-4.1-mini",
      source: "preset",
    },
    {
      id: "custom-proxy-model",
      label: "custom-proxy-model",
      source: "custom",
    },
  ]);
  assert.deepEqual(
    [...getLegacyModelIdsFromMetadata({ models: "gpt-4.1-mini, custom-proxy-model" }, presetModelIds)].sort(),
    ["custom-proxy-model"],
  );
});

test("provider model config upsert deduplicates by normalized model id", () => {
  const config = upsertProviderModelItem(
    createProviderModelConfig([
      {
        id: "gpt-4.1-mini",
        label: "GPT-4.1 mini",
        source: "preset",
      },
    ]),
    {
      id: " GPT-4.1-MINI ",
      label: "Override label",
      source: "catalog",
    },
  );

  assert.deepEqual(config.items, [
    {
      id: "gpt-4.1-mini",
      label: "Override label",
      source: "catalog",
    },
  ]);
});

test("manual custom model input keeps matching preset ids in the custom source list", () => {
  const config = addProviderCustomModelItem(
    createProviderModelConfig([]),
    {
      id: "gpt-4.1",
      label: "Customer GPT 4.1",
    },
  );

  assert.deepEqual(config.items, [
    {
      id: "gpt-4.1",
      label: "Customer GPT 4.1",
      source: "custom",
    },
  ]);
});

test("manual custom model input keeps matching catalog ids in the custom source list", () => {
  const config = addProviderCustomModelItem(
    createProviderModelConfig([]),
    {
      id: "customer-gpt",
      label: "Customer Gateway GPT",
    },
  );

  assert.deepEqual(config.items, [
    {
      id: "customer-gpt",
      label: "Customer Gateway GPT",
      source: "custom",
    },
  ]);
});

test("manual custom model input trims and normalizes the provided id", () => {
  const config = addProviderCustomModelItem(
    createProviderModelConfig([]),
    {
      id: "  Customer-GPT  ",
      label: "Customer GPT",
    },
  );

  assert.deepEqual(config.items, [
    {
      id: "customer-gpt",
      label: "Customer GPT",
      source: "custom",
    },
  ]);
});

test("manual custom model input deduplicates repeated ids after normalization", () => {
  const config = addProviderCustomModelItem(
    createProviderModelConfig([
      {
        id: "customer-gpt",
        label: "Customer GPT",
        source: "custom",
      },
    ]),
    {
      id: " CUSTOMER-GPT ",
      label: "Customer GPT Production",
    },
  );

  assert.deepEqual(config.items, [
    {
      id: "customer-gpt",
      label: "Customer GPT Production",
      source: "custom",
    },
  ]);
});
