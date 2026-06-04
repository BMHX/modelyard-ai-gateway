import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractArtifacts } from "../lineage/extract-artifacts.mjs";

test("extractArtifacts recovers watermark hints from emitted server files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "teamops-extract-"));
  const targetFile = path.join(root, "dist", "server.js");
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  await fs.writeFile(
    targetFile,
    `
const BUILD_LOCATOR = "abcdefghijklmnop";
const CODEWORD_DIGEST = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
async function demo(flag, one, two) {
  return flag ? one : two;
}
const out = Object.assign({}, { one }, { two });
`,
    "utf8",
  );

  const result = await extractArtifacts(root);

  assert.equal(result.recoveredLocator, "abcdefghijklmnop");
  assert.equal(
    result.codewordDigest,
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  assert.equal(result.observedArtifacts.length, 1);
  assert.ok(result.familyHitSummary.some((entry) => entry.family === "if-return"));
  assert.ok(result.familyHitSummary.some((entry) => entry.family === "object-literal-assign"));
});
