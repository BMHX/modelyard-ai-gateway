import fs from "node:fs/promises";
import path from "node:path";

import { hashText, pathExists, readJson } from "./common.mjs";

const reportPath = process.argv[2];

if (!reportPath) {
  console.error("Usage: node ./tools/watermark/inspect.mjs <report.json> [repoRoot]");
  process.exit(1);
}

const repoRoot = path.resolve(process.argv[3] || process.cwd());
const report = await readJson(path.resolve(reportPath));

const summary = [];

for (const fileEntry of report.affectedFiles ?? []) {
  const absolutePath = path.join(repoRoot, fileEntry.filePath);
  const exists = await pathExists(absolutePath);

  if (!exists) {
    summary.push({
      filePath: fileEntry.filePath,
      status: "missing",
    });
    continue;
  }

  const content = await fs.readFile(absolutePath, "utf8");
  const contentHash = hashText(content);

  summary.push({
    expectedHash: fileEntry.transformedHash,
    filePath: fileEntry.filePath,
    matches: contentHash === fileEntry.transformedHash,
    observedHash: contentHash,
    status: contentHash === fileEntry.transformedHash ? "match" : "mismatch",
  });
}

console.log(
  JSON.stringify(
    {
      assignmentCount: report.assignments?.length ?? 0,
      codewordDigest: report.metadata?.codewordDigest ?? null,
      fileCount: report.affectedFiles?.length ?? 0,
      locator: report.locator ?? null,
      reportSchema: report.schema ?? null,
      summary,
    },
    null,
    2,
  ),
);
