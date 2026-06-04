import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractSourceTree } from "./source-tree.js";

test("extractSourceTree finds runtime header and semantic signals in source files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "detector-source-"));
  await mkdir(path.join(root, "apps", "gateway", "src"), { recursive: true });
  await writeFile(
    path.join(root, "apps", "gateway", "src", "response-headers.ts"),
    `
      export const headers = {
        "x-teamops-gateway-protocol": "openai-compatible",
      };
      const text = "AI Access & Governance Infrastructure";
    `,
  );

  const result = await extractSourceTree(
    {
      type: "source-tree",
      value: root,
    },
    5,
  );

  const signals = new Set(result.evidence.map((item) => item.signal));
  assert.equal(signals.has("x-teamops-gateway-protocol"), true);
  assert.equal(signals.has("AI Access & Governance Infrastructure"), true);
});
