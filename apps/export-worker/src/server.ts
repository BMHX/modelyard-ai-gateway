import { createServer } from "node:http";

import { pingDatabase } from "@teamops/database";
import { startExportWorker } from "@teamops/export-jobs";

import { exportWorkerDb } from "./context.js";

const stopExportWorker = startExportWorker(exportWorkerDb, {
  logger: {
    info: (message, details) => {
      console.info("[export-worker]", message, details ?? {});
    },
    error: (message, details) => {
      console.error("[export-worker]", message, details ?? {});
    },
  },
});

const exportWorkerHealthHost = process.env.EXPORT_WORKER_HEALTH_HOST?.trim() || "0.0.0.0";
const exportWorkerHealthPort = Number.parseInt(process.env.EXPORT_WORKER_HEALTH_PORT?.trim() || "4010", 10);

const healthServer = createServer(async (request, response) => {
  const requestUrl = request.url ?? "/";
  if (!requestUrl.startsWith("/healthz")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: "not_found",
      }),
    );
    return;
  }

  try {
    await pingDatabase(exportWorkerDb);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        service: "export-worker",
        status: "ok",
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        service: "export-worker",
        status: "degraded",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "health check failed",
      }),
    );
  }
});

await new Promise<void>((resolve, reject) => {
  healthServer.once("error", reject);
  healthServer.listen(exportWorkerHealthPort, exportWorkerHealthHost, () => {
    console.info("[export-worker] health endpoint listening", {
      host: exportWorkerHealthHost,
      port: exportWorkerHealthPort,
    });
    resolve();
  });
});

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  stopExportWorker();
  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  await exportWorkerDb.end();
};

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

await new Promise<void>(() => {
  console.info("[export-worker] started");
});
