import { loadRootEnv } from "@teamops/config";
import { createDatabase, runMigrations } from "./index.js";

loadRootEnv({ required: false });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const db = createDatabase(databaseUrl);

try {
  await runMigrations(db);
  console.log("Database migrations applied successfully.");
} finally {
  await db.end();
}
