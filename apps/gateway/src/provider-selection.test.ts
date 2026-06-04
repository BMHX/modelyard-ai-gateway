import test from "node:test";
import assert from "node:assert/strict";

import { analyzeProviderRoutingConflicts } from "@teamops/contracts";

import { GatewayHttpError } from "./errors.js";
import { selectProviderForProtocol, type ProviderSelectionCandidate } from "./provider-selection.js";

function createCandidate(args: {
  id: string;
  provider: ProviderSelectionCandidate["connection"]["provider"];
  label?: string;
  metadata?: Record<string, string>;
}): ProviderSelectionCandidate {
  return {
    connection: {
      id: args.id,
      workspaceId: "workspace-1",
      provider: args.provider,
      label: args.label ?? args.id,
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
      updatedAt: "2026-04-03T00:00:00.000Z",
    },
    metadata: args.metadata ?? {},
  };
}

test("selectProviderForProtocol returns the only candidate for a protocol", () => {
  const selected = selectProviderForProtocol({
    providers: [
      createCandidate({
        id: "anthropic-primary",
        provider: "anthropic",
      }),
    ],
    protocol: "anthropic",
    headers: {},
  });

  assert.equal(selected.connection.id, "anthropic-primary");
});

test("selectProviderForProtocol honors explicit provider kind hint", () => {
  const selected = selectProviderForProtocol({
    providers: [
      createCandidate({
        id: "openai-primary",
        provider: "openai",
      }),
      createCandidate({
        id: "groq-compatible",
        provider: "openai-compatible",
      }),
    ],
    protocol: "openai-compatible",
    headers: {
      "x-provider-kind": "openai-compatible",
    },
  });

  assert.equal(selected.connection.id, "groq-compatible");
});

test("selectProviderForProtocol honors metadata default markers", () => {
  const selected = selectProviderForProtocol({
    providers: [
      createCandidate({
        id: "anthropic-a",
        provider: "anthropic",
      }),
      createCandidate({
        id: "anthropic-b",
        provider: "anthropic",
        metadata: {
          defaultForProtocol: "anthropic",
        },
      }),
    ],
    protocol: "anthropic",
    headers: {},
  });

  assert.equal(selected.connection.id, "anthropic-b");
});

test("selectProviderForProtocol routes by requested model prefix metadata", () => {
  const selected = selectProviderForProtocol({
    providers: [
      createCandidate({
        id: "openai-main",
        provider: "openai",
        metadata: {
          modelPrefixes: "gpt-,o",
        },
      }),
      createCandidate({
        id: "deepseek-proxy",
        provider: "openai-compatible",
        metadata: {
          modelPrefixes: "deepseek-",
        },
      }),
    ],
    protocol: "openai-compatible",
    headers: {},
    requestedModel: "deepseek-chat",
  });

  assert.equal(selected.connection.id, "deepseek-proxy");
});

test("selectProviderForProtocol uses protocol default to break model-match ties", () => {
  const selected = selectProviderForProtocol({
    providers: [
      createCandidate({
        id: "compatible-a",
        provider: "openai-compatible",
        metadata: {
          modelPrefixes: "llama-",
        },
      }),
      createCandidate({
        id: "compatible-b",
        provider: "openai-compatible",
        metadata: {
          modelPrefixes: "llama-",
          defaultForProtocol: "openai-compatible",
        },
      }),
    ],
    protocol: "openai-compatible",
    headers: {},
    requestedModel: "llama-3.3-70b",
  });

  assert.equal(selected.connection.id, "compatible-b");
});

test("selectProviderForProtocol rejects ambiguous candidates without hint", () => {
  assert.throws(
    () =>
      selectProviderForProtocol({
        providers: [
          createCandidate({
            id: "openai-a",
            provider: "openai",
          }),
          createCandidate({
            id: "openai-b",
            provider: "openai-compatible",
          }),
        ],
        protocol: "openai-compatible",
        headers: {},
      }),
    (error) =>
      error instanceof GatewayHttpError &&
      error.statusCode === 409 &&
      error.message.includes("Multiple provider connections are available"),
  );
});

test("selectProviderForProtocol rejects ambiguous model matches without default", () => {
  assert.throws(
    () =>
      selectProviderForProtocol({
        providers: [
          createCandidate({
            id: "compatible-a",
            provider: "openai-compatible",
            metadata: {
              modelPrefixes: "mixtral-",
            },
          }),
          createCandidate({
            id: "compatible-b",
            provider: "openai-compatible",
            metadata: {
              modelPrefixes: "mixtral-",
            },
          }),
        ],
        protocol: "openai-compatible",
        headers: {},
        requestedModel: "mixtral-8x7b",
      }),
    (error) =>
      error instanceof GatewayHttpError &&
      error.statusCode === 409 &&
      error.message.includes("requested model"),
  );
});

test("analyzeProviderRoutingConflicts flags exact models that are also captured by another provider prefix", () => {
  const conflicts = analyzeProviderRoutingConflicts({
    providers: [
      createCandidate({
        id: "exact-owner",
        provider: "openai-compatible",
        metadata: {
          models: "gpt-4.1-mini",
        },
      }),
      createCandidate({
        id: "prefix-owner",
        provider: "openai-compatible",
        metadata: {
          modelPrefixes: "gpt-",
        },
      }),
    ],
    protocol: "openai-compatible",
  });

  assert.deepEqual(conflicts, [
    {
      protocol: "openai-compatible",
      kind: "exact_vs_prefix",
      token: "gpt-4.1-mini",
      sampleModel: "gpt-4.1-mini",
      candidates: [
        {
          id: "exact-owner",
          label: "exact-owner",
          provider: "openai-compatible",
        },
        {
          id: "prefix-owner",
          label: "prefix-owner",
          provider: "openai-compatible",
        },
      ],
      defaultCandidates: [],
      matchingPrefixes: ["gpt-"],
      resolution: "ambiguous",
    },
  ]);
});

test("analyzeProviderRoutingConflicts marks overlapping prefixes as default-resolved when one default exists", () => {
  const conflicts = analyzeProviderRoutingConflicts({
    providers: [
      createCandidate({
        id: "broad-prefix",
        provider: "openai-compatible",
        metadata: {
          modelPrefixes: "llama-",
        },
      }),
      createCandidate({
        id: "narrow-default",
        provider: "openai-compatible",
        metadata: {
          modelPrefixes: "llama-3-",
          defaultForProtocol: "openai-compatible",
        },
      }),
    ],
    protocol: "openai-compatible",
  });

  assert.deepEqual(conflicts, [
    {
      protocol: "openai-compatible",
      kind: "prefix_overlap",
      token: "llama-3-",
      sampleModel: "llama-3-sample",
      candidates: [
        {
          id: "broad-prefix",
          label: "broad-prefix",
          provider: "openai-compatible",
        },
        {
          id: "narrow-default",
          label: "narrow-default",
          provider: "openai-compatible",
        },
      ],
      defaultCandidates: [
        {
          id: "narrow-default",
          label: "narrow-default",
          provider: "openai-compatible",
        },
      ],
      matchingPrefixes: ["llama-", "llama-3-"],
      resolution: "default_resolved",
    },
  ]);
});
