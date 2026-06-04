import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

import { getRepoRoot, loadRootEnv } from "./root-env.mjs";

const action = process.argv[2];
const composeFile = path.join(getRepoRoot(), "infra", "docker-compose.dev.yml");
const envFile = path.join(getRepoRoot(), ".env.development");
const actionArgs = {
  up: ["--env-file", envFile, "-f", composeFile, "up", "-d"],
  down: ["--env-file", envFile, "-f", composeFile, "down"],
  logs: ["--env-file", envFile, "-f", composeFile, "logs", "-f", "postgres", "valkey"],
};

if (!action || !(action in actionArgs)) {
  console.error("Usage: node ./tools/dev-db.mjs <up|down|logs>");
  process.exit(1);
}

function runCheck(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commandWorks(command, args) {
  const result = runCheck(command, args);
  return result.status === 0;
}

function dockerDaemonReady() {
  return commandWorks("docker", ["info"]);
}

function colimaInstalled() {
  return commandWorks("colima", ["version"]);
}

function colimaRunning() {
  const result = runCheck("colima", ["status"]);
  return result.status === 0;
}

function startColimaIfNeeded() {
  if (dockerDaemonReady()) {
    return;
  }

  if (!colimaInstalled()) {
    console.error(
      "Docker daemon is not reachable. Start Docker Desktop or Colima, then rerun the command.",
    );
    process.exit(1);
  }

  if (!colimaRunning()) {
    console.log("Docker daemon is not reachable. Starting Colima...");
    const startResult = spawnSync("colima", ["start"], {
      stdio: "inherit",
    });

    if (startResult.status !== 0) {
      process.exit(startResult.status ?? 1);
    }
  }

  if (!dockerDaemonReady()) {
    console.error("Docker daemon is still not reachable after starting Colima.");
    process.exit(1);
  }
}

function getComposeCommand() {
  if (commandWorks("docker", ["compose", "version"])) {
    return {
      command: "docker",
      args: ["compose", ...actionArgs[action]],
    };
  }

  if (commandWorks("docker-compose", ["--version"])) {
    return {
      command: "docker-compose",
      args: actionArgs[action],
    };
  }

  console.error(
    "Neither `docker compose` nor `docker-compose` is available. Install Docker Compose and rerun the command.",
  );
  process.exit(1);
}

startColimaIfNeeded();
loadRootEnv({ profile: "development", required: true });

const compose = getComposeCommand();
const child = spawn(compose.command, compose.args, {
  cwd: getRepoRoot(),
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
