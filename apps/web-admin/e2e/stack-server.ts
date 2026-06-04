import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const runtimeDir = path.join(__dirname, ".runtime");
const manifestPath = path.join(runtimeDir, "prompt-inspections-manifest.json");
const databaseDir = path.join(runtimeDir, "pglite");
const databaseUrl = `pglite://${databaseDir}`;
const controlApiPort = "4001";
const webAdminPort = "3001";
const controlApiAdminToken = "prompt-inspections-e2e-admin-token";
const encryptionKeyBase64 = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY=";

await rm(runtimeDir, {
  force: true,
  recursive: true,
});
await mkdir(runtimeDir, {
  recursive: true,
});

const sharedEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  VALKEY_URL: "redis://127.0.0.1:6379",
  ENCRYPTION_KEY_BASE64: encryptionKeyBase64,
  CONTROL_API_ADMIN_TOKEN: controlApiAdminToken,
  CONTROL_API_PORT: controlApiPort,
  CONTROL_API_HOST: "127.0.0.1",
  CONTROL_API_BASE_URL: `http://127.0.0.1:${controlApiPort}`,
  NEXT_PUBLIC_CONTROL_API_BASE_URL: `http://127.0.0.1:${controlApiPort}`,
  NEXT_TELEMETRY_DISABLED: "1",
  PROMPT_INSPECTIONS_E2E_MANIFEST_PATH: manifestPath,
  WEB_ADMIN_DISABLE_SERVER_CACHE: "1",
};

function spawnNodeScript(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return spawn("node", args, {
    cwd,
    env,
    stdio: "inherit",
  });
}

async function runNodeCommand(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("node", args, {
      cwd,
      env,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed with exit code ${code ?? 1}: node ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

async function waitForHttpReady(url: string, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the server is accepting requests.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function spawnWebAdmin(env: NodeJS.ProcessEnv) {
  return spawn(
    "node",
    [
      "../../tools/run-with-root-env.mjs",
      "next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      webAdminPort,
    ],
    {
      cwd: path.join(repoRoot, "apps/web-admin"),
      env,
      stdio: "inherit",
    },
  );
}

const children: ChildProcess[] = [];
let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const child of children) {
    child.kill("SIGTERM");
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 3_000).unref();
}

const controlApi = spawnNodeScript(
  ["--import", "tsx", "./e2e/control-api-server.ts"],
  path.join(repoRoot, "apps/web-admin"),
  sharedEnv,
);
children.push(controlApi);

await waitForHttpReady(`http://127.0.0.1:${controlApiPort}/healthz`);

await runNodeCommand(
  ["../../tools/run-with-root-env.mjs", "env", "-u", "NEXT_DIST_DIR", "next", "build"],
  path.join(repoRoot, "apps/web-admin"),
  sharedEnv,
);

const webAdmin = spawnWebAdmin({
  ...sharedEnv,
  CONTROL_API_ADMIN_TOKEN: controlApiAdminToken,
} as NodeJS.ProcessEnv);
children.push(webAdmin);

for (const child of children) {
  child.on("exit", (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await new Promise(() => undefined);
