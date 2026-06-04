import test from "node:test";
import assert from "node:assert/strict";

import { createEvidence } from "./normalize.js";
import { scoreEvidence } from "./score.js";
import type { DetectionTask } from "./types.js";

const baseTask: DetectionTask = {
  caseId: "case_test",
  mode: "offline",
  targets: [
    {
      type: "source-tree",
      value: "/tmp/source",
    },
  ],
  options: {
    enableActiveProbes: false,
    captureScreenshots: false,
    headlessBrowser: false,
    maxDepth: 3,
    strictFalsePositiveMode: true,
    outputDir: null,
    timeoutMs: 5_000,
  },
};

test("scoreEvidence promotes multi-family strong evidence to possible match or above", () => {
  const evidence = [
    createEvidence({
      family: "runtimeHeader",
      signal: "x-teamops-gateway-protocol",
      matchedValue: "openai-compatible",
      location: {
        kind: "http-header",
        target: "https://target.example",
        path: "/v1/models",
      },
      strength: 0.99,
      rarity: 0.98,
      tamperCost: 0.82,
      baseWeight: 12,
      independenceKey: "x-teamops-gateway-protocol",
      sourceSurface: "gateway",
    }),
    createEvidence({
      family: "healthIdentity",
      signal: "service=gateway",
      matchedValue: "gateway",
      location: {
        kind: "http-body",
        target: "https://target.example",
        path: "/healthz",
      },
      strength: 0.98,
      rarity: 0.94,
      tamperCost: 0.78,
      baseWeight: 10,
      independenceKey: "health-service-identity",
      sourceSurface: "gateway",
    }),
    createEvidence({
      family: "containerMetadata",
      signal: "teamops-preview-runtime",
      matchedValue: "teamops-preview-runtime",
      location: {
        kind: "docker-inspect",
        target: "suspicious/app:latest",
        path: "docker image inspect",
      },
      strength: 0.9,
      rarity: 0.98,
      tamperCost: 0.82,
      baseWeight: 8,
      independenceKey: "teamops-image-names",
      sourceSurface: "infra/preview",
    }),
  ];

  const scored = scoreEvidence({
    evidence,
    errors: [],
    task: baseTask,
  });

  assert.notEqual(scored.verdict, "unlikely");
  assert.equal(scored.confidence >= 30, true);
  assert.equal(scored.summary.matchedFamilies.includes("runtimeHeader"), true);
  assert.equal(scored.summary.likelySources[0]?.surface, "gateway");
});
