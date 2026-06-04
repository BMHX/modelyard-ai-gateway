import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseControlApiEnv, parseGatewayEnv } from "@teamops/config";
import {
  createDatabase,
  pingDatabase,
  runMigrations,
  type Database,
} from "@teamops/database";
import { startExportWorker } from "@teamops/export-jobs";

import { buildControlApi } from "../../apps/control-api/src/app.js";
import { buildGateway } from "../../apps/gateway/src/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const controlApiEnv = parseControlApiEnv();
const gatewayEnv = parseGatewayEnv();
let database: Database = createDatabase(controlApiEnv.DATABASE_URL);

async function listOrganizationCount(db: Database) {
  const result = await db.query<{ count: string | number }>(
    "select count(*)::int as count from organizations",
  );
  const rawCount = result.rows[0]?.count ?? 0;
  return Number(rawCount);
}

async function runDesktopDemoSeed() {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.env.npm_node_execpath || process.execPath,
      ["--import", "tsx", path.join(repoRoot, "packages/database/src/demo-seed.ts")],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: "inherit",
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`desktop demo seed terminated with signal ${signal}`));
        return;
      }

      if ((code ?? 0) !== 0) {
        reject(new Error(`desktop demo seed failed with exit code ${code ?? 1}`));
        return;
      }

      resolve();
    });
  });
}

async function ensureDesktopSeedData(db: Database) {
  const shouldAutoSeed =
    process.env.TEAMOPS_DESKTOP_LOCAL === "1" && process.env.NODE_ENV !== "production";
  if (!shouldAutoSeed) {
    return db;
  }

  const organizationCount = await listOrganizationCount(db);
  if (organizationCount > 0) {
    return db;
  }

  console.info("[desktop-services] empty local desktop database detected; seeding demo data");
  await db.end();
  await runDesktopDemoSeed();

  const nextDb = createDatabase(controlApiEnv.DATABASE_URL);
  await runMigrations(nextDb);
  return nextDb;
}

await runMigrations(database);
database = await ensureDesktopSeedData(database);

const controlApi = await buildControlApi({
  env: controlApiEnv,
  db: database,
});

const gateway = await buildGateway({
  env: gatewayEnv,
  db: database,
});

const stopExportWorker = startExportWorker(database, {
  logger: {
    info: (message, details) => {
      console.info("[desktop-export-worker]", message, details ?? {});
    },
    error: (message, details) => {
      console.error("[desktop-export-worker]", message, details ?? {});
    },
  },
});

const exportWorkerHealthHost = process.env.EXPORT_WORKER_HEALTH_HOST?.trim() || "127.0.0.1";
const exportWorkerHealthPort = Number.parseInt(process.env.EXPORT_WORKER_HEALTH_PORT?.trim() || "4010", 10);

const healthServer = createServer(async (request, response) => {
  const requestUrl = request.url ?? "/";
  if (!requestUrl.startsWith("/healthz")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    await pingDatabase(database);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        service: "desktop-export-worker",
        status: "ok",
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        service: "desktop-export-worker",
        status: "degraded",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "health check failed",
      }),
    );
  }
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  stopExportWorker();
  await Promise.allSettled([
    controlApi.close(),
    gateway.close(),
    new Promise<void>((resolve, reject) => {
      healthServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }),
  ]);
  await database.end();
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

await Promise.all([
  controlApi.listen({
    host: controlApiEnv.CONTROL_API_HOST,
    port: controlApiEnv.CONTROL_API_PORT,
  }),
  gateway.listen({
    host: gatewayEnv.GATEWAY_HOST,
    port: gatewayEnv.GATEWAY_PORT,
  }),
  new Promise<void>((resolve, reject) => {
    healthServer.once("error", reject);
    healthServer.listen(exportWorkerHealthPort, exportWorkerHealthHost, () => {
      resolve();
    });
  }),
]);

console.info("[desktop-services] started", {
  controlApi: `http://${controlApiEnv.CONTROL_API_HOST}:${controlApiEnv.CONTROL_API_PORT}`,
  gateway: `http://${gatewayEnv.GATEWAY_HOST}:${gatewayEnv.GATEWAY_PORT}`,
  exportWorkerHealth: `http://${exportWorkerHealthHost}:${exportWorkerHealthPort}`,
  database: controlApiEnv.DATABASE_URL,
});

await new Promise<void>(() => {});
