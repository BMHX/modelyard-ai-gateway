import { execFileSync, spawn } from "node:child_process";

import { getRepoRoot, loadRootEnv } from "./root-env.mjs";

loadRootEnv({ profile: "production", required: true });
const repoRoot = getRepoRoot();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const controlApiPort = Number(process.env.CONTROL_API_PORT ?? "4001");
const gatewayPort = Number(process.env.GATEWAY_PORT ?? "4002");
const webAdminPort = Number(process.env.WEB_ADMIN_PORT ?? "3001");
const controlApiHealthUrl = process.env.CONTROL_API_HEALTH_URL ?? `http://127.0.0.1:${controlApiPort}/healthz`;
const services = [
  { label: "control-api", args: ["run", "start:prod:control-api"] },
  { label: "gateway", args: ["run", "start:prod:gateway"] },
  { label: "web-admin", args: ["run", "start:prod:web-admin"] },
];
const shouldReuseControlApi = process.env.TEAMOPS_REUSE_CONTROL_API === "1";

const children = new Set();
let shuttingDown = false;
let exitCode = 0;

function getListenProcess(port) {
  try {
    return execFileSync("lsof", ["-iTCP:" + port, "-sTCP:LISTEN", "-n", "-P"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function assertPortAvailable(port, serviceName) {
  const processList = getListenProcess(port);
  if (!processList) {
    return;
  }

  writePrefixedLine(
    "prod-admin-stack",
    `${serviceName} port ${port} is already in use. Stop the existing process first:\n${processList}`,
    true,
  );
  process.exit(1);
}

function writePrefixedLine(label, line, isError = false) {
  const stream = isError ? process.stderr : process.stdout;
  stream.write(`[${label}] ${line}\n`);
}

function pipeWithPrefix(stream, label, isError = false) {
  if (!stream) {
    return;
  }

  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        writePrefixedLine(label, line, isError);
      }
    }
  });

  stream.on("end", () => {
    const remaining = buffer.replace(/\r$/, "");
    if (remaining.length > 0) {
      writePrefixedLine(label, remaining, isError);
    }
  });
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  exitCode = code;

  if (children.size === 0) {
    process.exit(exitCode);
  }

  for (const child of children) {
    child.kill("SIGTERM");
  }

  setTimeout(() => {
    for (const child of children) {
      child.kill("SIGKILL");
    }
  }, 3_000).unref();
}

function startService(label, args) {
  const child = spawn(npmCommand, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  pipeWithPrefix(child.stdout, label);
  pipeWithPrefix(child.stderr, label, true);
  children.add(child);

  child.on("exit", (code, signal) => {
    children.delete(child);

    if (shuttingDown) {
      if (children.size === 0) {
        process.exit(exitCode);
      }
      return;
    }

    const description = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
    writePrefixedLine("prod-admin-stack", `${label} stopped unexpectedly (${description})`, true);
    shutdown(code ?? 1);
  });

  child.on("error", (error) => {
    writePrefixedLine("prod-admin-stack", `${label} failed to start: ${error.message}`, true);
    shutdown(1);
  });
}

async function isControlApiHealthy() {
  try {
    const response = await fetch(controlApiHealthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    return payload?.service === "control-api" && payload?.status === "ok";
  } catch {
    return false;
  }
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

writePrefixedLine("prod-admin-stack", "Starting Control API, Gateway, and production Web Admin...");
const controlApiAlreadyRunning = shouldReuseControlApi && await isControlApiHealthy();
if (controlApiAlreadyRunning) {
  writePrefixedLine("prod-admin-stack", `Reusing healthy Control API at ${controlApiHealthUrl}.`);
}

if (!controlApiAlreadyRunning) {
  assertPortAvailable(controlApiPort, "control-api");
}
assertPortAvailable(gatewayPort, "gateway");
assertPortAvailable(webAdminPort, "web-admin");

for (const service of services.filter((service) => service.label !== "control-api" || !controlApiAlreadyRunning)) {
  startService(service.label, service.args);
}
writePrefixedLine("prod-admin-stack", "Admin stack is running. Press Ctrl+C to stop all services.");

await new Promise(() => {});
