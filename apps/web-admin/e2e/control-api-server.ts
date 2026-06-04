import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseControlApiEnv } from "@teamops/config";
import { createDatabase } from "@teamops/database";

import { buildControlApi } from "../../control-api/src/app";
import { seedPromptInspectionsE2E } from "./prompt-inspections.seed";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = process.env.PROMPT_INSPECTIONS_E2E_MANIFEST_PATH ?? path.join(__dirname, ".runtime", "prompt-inspections-manifest.json");

await mkdir(path.dirname(manifestPath), {
  recursive: true,
});

const env = parseControlApiEnv(process.env);
const db = createDatabase(env.DATABASE_URL);

await seedPromptInspectionsE2E({
  databaseUrl: env.DATABASE_URL,
  manifestPath,
  db,
});

const app = await buildControlApi({
  env,
  db,
});

const shutdown = async () => {
  await app.close();
  await db.end();
};

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

await app.listen({
  host: env.CONTROL_API_HOST,
  port: env.CONTROL_API_PORT,
});
