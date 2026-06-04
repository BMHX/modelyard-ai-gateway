import { spawn } from "node:child_process";

import { loadRootEnv } from "./root-env.mjs";

loadRootEnv({ required: true });

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node ./tools/run-with-root-env.mjs <command> [...args]");
  process.exit(1);
}

const child = spawn(command, args, {
  cwd: process.cwd(),
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
