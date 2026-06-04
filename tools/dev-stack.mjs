import { spawn } from "node:child_process";

import { getRepoRoot } from "./root-env.mjs";

const repoRoot = getRepoRoot();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const shouldSeed = process.argv.includes("--seed");
const prepSteps = [
  { label: "env-check", args: ["run", "env:check"] },
  { label: "db-up", args: ["run", "db:up"] },
  { label: "db-migrate", args: ["run", "db:migrate"] },
  ...(shouldSeed ? [{ label: "demo-seed", args: ["run", "demo:seed"] }] : []),
];
const services = [
  { label: "control-api", args: ["run", "dev:control-api"] },
  { label: "export-worker", args: ["run", "dev:export-worker"] },
  { label: "gateway", args: ["run", "dev:gateway"] },
  { label: "web-admin", args: ["run", "dev:web-admin"] },
];

const children = new Set();
let shuttingDown = false;
let exitCode = 0;

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

function spawnCommand(label, args) {
  const child = spawn(npmCommand, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  pipeWithPrefix(child.stdout, label);
  pipeWithPrefix(child.stderr, label, true);

  return child;
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

async function runStep(label, args) {
  await new Promise((resolve, reject) => {
    const child = spawnCommand(label, args);

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} terminated with signal ${signal}`));
        return;
      }

      if ((code ?? 0) !== 0) {
        reject(new Error(`${label} failed with exit code ${code ?? 1}`));
        return;
      }

      resolve();
    });

    child.on("error", reject);
  });
}

function startService(label, args) {
  const child = spawnCommand(label, args);
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
    writePrefixedLine("dev-stack", `${label} stopped unexpectedly (${description})`, true);
    shutdown(code ?? 1);
  });

  child.on("error", (error) => {
    writePrefixedLine("dev-stack", `${label} failed to start: ${error.message}`, true);
    shutdown(1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  for (const step of prepSteps) {
    await runStep(step.label, step.args);
  }

  writePrefixedLine("dev-stack", "Starting local development services...");
  for (const service of services) {
    startService(service.label, service.args);
  }

  writePrefixedLine("dev-stack", "Local stack is running. Press Ctrl+C to stop app processes.");
  writePrefixedLine("dev-stack", "Database containers stay up until you run `npm run db:down`.");

  await new Promise(() => {});
} catch (error) {
  writePrefixedLine(
    "dev-stack",
    error instanceof Error ? error.message : String(error),
    true,
  );
  shutdown(1);
}
