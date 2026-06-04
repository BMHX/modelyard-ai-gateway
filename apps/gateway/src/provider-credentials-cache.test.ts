import test from "node:test";
import assert from "node:assert/strict";

import { encryptSecret, type ProviderConnectionCandidate } from "@teamops/database";

import {
  clearProviderCredentialCache,
  getDecryptedProviderCredential,
} from "./provider-credentials-cache.js";

const encryptionKeyBase64 = Buffer.alloc(32, 7).toString("base64");

function createCandidate(args: {
  id?: string;
  updatedAt?: string;
  apiKey: string;
  metadata?: Record<string, string>;
}): ProviderConnectionCandidate {
  return {
    connection: {
      id: args.id ?? "provider-1",
      workspaceId: "workspace-1",
      provider: "anthropic",
      label: "Anthropic",
      metadata: args.metadata ?? {},
      pricingConfig: null,
      baseUrl: null,
      anthropicVersion: null,
      status: "active",
      revokedAt: null,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      lastTestStatusCode: null,
      lastTestLatencyMs: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: args.updatedAt ?? "2026-04-03T00:00:00.000Z",
    },
    metadata: args.metadata ?? {},
    encryptedApiKey: encryptSecret(args.apiKey, encryptionKeyBase64),
  };
}

test("getDecryptedProviderCredential reuses cached credentials before expiry", () => {
  clearProviderCredentialCache();
  const candidate = createCandidate({
    apiKey: "sk-ant-test-1",
  });

  const first = getDecryptedProviderCredential(candidate, encryptionKeyBase64, {
    now: 1_000,
    ttlMs: 100,
  });
  const second = getDecryptedProviderCredential(candidate, encryptionKeyBase64, {
    now: 1_050,
    ttlMs: 100,
  });

  assert.equal(first, second);
  assert.equal(second.apiKey, "sk-ant-test-1");
});

test("getDecryptedProviderCredential refreshes cache after expiry", () => {
  clearProviderCredentialCache();
  const candidate = createCandidate({
    apiKey: "sk-ant-test-2",
  });

  const first = getDecryptedProviderCredential(candidate, encryptionKeyBase64, {
    now: 2_000,
    ttlMs: 50,
  });
  const second = getDecryptedProviderCredential(candidate, encryptionKeyBase64, {
    now: 2_051,
    ttlMs: 50,
  });

  assert.notEqual(first, second);
  assert.equal(second.apiKey, "sk-ant-test-2");
});

test("getDecryptedProviderCredential invalidates cache when connection version changes", () => {
  clearProviderCredentialCache();
  const firstCandidate = createCandidate({
    id: "provider-rotated",
    updatedAt: "2026-04-03T00:00:00.000Z",
    apiKey: "sk-ant-old",
  });
  const rotatedCandidate = createCandidate({
    id: "provider-rotated",
    updatedAt: "2026-04-04T00:00:00.000Z",
    apiKey: "sk-ant-new",
  });

  const first = getDecryptedProviderCredential(firstCandidate, encryptionKeyBase64, {
    now: 3_000,
    ttlMs: 500,
  });
  const second = getDecryptedProviderCredential(rotatedCandidate, encryptionKeyBase64, {
    now: 3_100,
    ttlMs: 500,
  });

  assert.notEqual(first, second);
  assert.equal(first.apiKey, "sk-ant-old");
  assert.equal(second.apiKey, "sk-ant-new");
});
