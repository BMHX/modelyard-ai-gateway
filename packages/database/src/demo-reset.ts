import { rm } from "node:fs/promises";
import path from "node:path";

import { loadRootEnv } from "@teamops/config";
import { getRepoRoot } from "@teamops/config";

import { createDatabase } from "./index.js";

const demoOrganizationSlugs = ["pilot-demo-org", "internal-demo-org"];
const demoStatePath = path.join(getRepoRoot(), ".demo", "demo-state.json");
const demoBriefPath = path.join(getRepoRoot(), ".demo", "demo-brief.md");

loadRootEnv({ required: false });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const db = createDatabase(databaseUrl);

try {
  const result = await db.query(
    `
      delete from organizations
      where slug = any($1::text[])
    `,
    [demoOrganizationSlugs],
  );

  await rm(demoStatePath, {
    force: true,
  });
  await rm(demoBriefPath, {
    force: true,
  });

  console.log(`Removed ${result.rowCount ?? 0} demo organization(s).`);
} finally {
  await db.end();
}
