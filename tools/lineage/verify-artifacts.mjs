import path from "node:path";

import { extractArtifacts } from "./extract-artifacts.mjs";

async function main() {
  const lineageId = process.argv[2];
  const artifactRoot = process.argv[3];

  if (!lineageId || !artifactRoot) {
    console.error("Usage: node ./tools/lineage/verify-artifacts.mjs <lineageId> <artifact-root>");
    process.exit(1);
  }

  const baseUrl =
    process.env.CONTROL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_CONTROL_API_BASE_URL ??
    "http://127.0.0.1:4001";
  const adminToken = process.env.CONTROL_API_ADMIN_TOKEN?.trim();

  if (!adminToken) {
    throw new Error("CONTROL_API_ADMIN_TOKEN is required");
  }

  const extractor = await extractArtifacts(path.resolve(artifactRoot));
  const response = await fetch(`${baseUrl}/v1/lineage/${encodeURIComponent(lineageId)}/artifacts/verify`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ extractor }),
  });

  const payload = await response.text();
  if (!response.ok) {
    throw new Error(payload || `Verification failed with ${response.status}`);
  }

  console.log(payload);
}

await main();
