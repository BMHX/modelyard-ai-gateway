import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSemanticCodeword } from "./codeword.mjs";
import { readWatermarkContext } from "./context.mjs";
import { applyWatermarkAssignments, collectWatermarkCandidates } from "./semantic-families.mjs";

test("readWatermarkContext derives a stable locator", () => {
  const context = readWatermarkContext({
    TEAMOPS_WATERMARK_SECRET: "top-secret",
    TEAMOPS_WATERMARK_CUSTOMER: "cus_001",
    TEAMOPS_WATERMARK_DEPLOYMENT: "dep_001",
    TEAMOPS_WATERMARK_RELEASE: "rel_001",
  });

  assert.ok(context);
  assert.equal(context.locator.length, 16);
  assert.equal(
    context.locator,
    readWatermarkContext({
      TEAMOPS_WATERMARK_SECRET: "top-secret",
      TEAMOPS_WATERMARK_CUSTOMER: "cus_001",
      TEAMOPS_WATERMARK_DEPLOYMENT: "dep_001",
      TEAMOPS_WATERMARK_RELEASE: "rel_001",
    }).locator,
  );
});

test("readWatermarkContext consumes an official lineage descriptor", async () => {
  const descriptorPath = path.join(os.tmpdir(), `teamops-lineage-${Date.now()}.json`);
  await fs.writeFile(
    descriptorPath,
    JSON.stringify({
      lineageId: "fp_123",
      lineageToken: "tfp1.fp_123.demo",
      customerId: "cus_001",
      deploymentId: "dep_001",
      releaseId: "rel_001",
      manifestHash: "deadbeefcafebabe",
      attestationBundleId: "evb_001",
      channel: "self-host",
      version: "0.1.0",
      gitCommitSha: "abc123",
      declaredArtifacts: [],
      watermarkProfile: "cus_001:dep_001:rel_001:deadbeefcafebabe",
      schemeVersion: "wm.v1",
    }),
    "utf8",
  );

  const context = readWatermarkContext({
    TEAMOPS_OFFICIAL_RELEASE: "1",
    TEAMOPS_LINEAGE_SECRET: "top-secret",
    TEAMOPS_LINEAGE_DESCRIPTOR_PATH: descriptorPath,
  });

  assert.ok(context);
  assert.equal(context.customerId, "cus_001");
  assert.equal(context.deploymentId, "dep_001");
  assert.equal(context.releaseId, "rel_001");
  assert.equal(context.manifestHash, "deadbeefcafebabe");
  assert.equal(context.profile, "cus_001:dep_001:rel_001:deadbeefcafebabe");
});

test("official release requires a descriptor path", () => {
  assert.throws(
    () =>
      readWatermarkContext({
        TEAMOPS_OFFICIAL_RELEASE: "1",
        TEAMOPS_LINEAGE_SECRET: "top-secret",
      }),
    /TEAMOPS_LINEAGE_DESCRIPTOR_PATH/,
  );
});

test("collectWatermarkCandidates detects multiple semantic families", () => {
  const sourceText = `
async function demo(app, context, obj, a, b) {
  if (a) return one;
  return two;

  for (const [name, value] of Object.entries(obj)) {
    console.log(name, value);
  }

  const [left, right] = await Promise.all([loadLeft(), loadRight()]);
  const result = { left, right };

  await registerOne(app, context);
  await registerTwo(app, context);
  await registerThree(app, context);
  await registerFour(app, context);

  return result;
}
`;
  const candidates = collectWatermarkCandidates({
    filePath: "apps/control-api/src/example.ts",
    sourceText,
  });

  assert.ok(candidates.some((candidate) => candidate.family === "if-return"));
  assert.ok(candidates.some((candidate) => candidate.family === "for-of-object-entries"));
  assert.ok(candidates.some((candidate) => candidate.family === "await-promise-all"));
  assert.ok(candidates.some((candidate) => candidate.family === "await-call-sequence"));
});

test("collectWatermarkCandidates keeps object literal sites for JavaScript-like files", () => {
  const sourceText = `
function demo(left, right) {
  const result = { left, right };
  return result;
}
`;
  const candidates = collectWatermarkCandidates({
    filePath: "apps/desktop/main.mjs",
    sourceText,
  });

  assert.ok(candidates.some((candidate) => candidate.family === "object-literal-assign"));
});

test("collectWatermarkCandidates skips object-literal if-return sites", () => {
  const sourceText = `
function demo(flag) {
  if (flag) {
    return { kind: "member" };
  }

  return { kind: "none" };
}
`;
  const candidates = collectWatermarkCandidates({
    filePath: "apps/control-api/src/request-auth.ts",
    sourceText,
  });

  assert.ok(!candidates.some((candidate) => candidate.family === "if-return"));
});

test("applyWatermarkAssignments rewrites a candidate site", () => {
  const sourceText = `
function demo(flag, one, two) {
  if (flag) return one;
  return two;
}
`;

  const [candidate] = collectWatermarkCandidates({
    filePath: "apps/control-api/src/demo.ts",
    sourceText,
  }).filter((entry) => entry.family === "if-return");
  const transformed = applyWatermarkAssignments({
    assignments: [
      {
        ...candidate,
        symbol: 1,
      },
    ],
    filePath: "apps/control-api/src/demo.ts",
    sourceText,
  });

  assert.match(transformed, /return flag \? one : two;/);
});

test("buildSemanticCodeword assigns parity and primary symbols", () => {
  const context = readWatermarkContext({
    TEAMOPS_WATERMARK_SECRET: "top-secret",
    TEAMOPS_WATERMARK_PROFILE: "build:cus_001:rel_001",
  });

  const sites = Array.from({ length: 15 }, (_, index) => ({
    family: "if-return",
    filePath: "apps/control-api/src/demo.ts",
    line: index + 1,
    nodeStart: index * 10,
    siteId: `if-return:apps/control-api/src/demo.ts:${index}`,
  }));
  const codeword = buildSemanticCodeword({
    context,
    sites,
  });

  assert.equal(codeword.assignments.length, sites.length);
  assert.ok(codeword.assignments.some((assignment) => assignment.role === "parity"));
  assert.ok(codeword.assignments.some((assignment) => assignment.role === "primary"));
});
