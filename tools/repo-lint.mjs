import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const issues = [];

const skippedDirNames = new Set([
  ".git",
  ".next",
  ".next-build",
  ".next-dev",
  ".next-member",
  ".next-noauth",
  ".turbo",
  "coverage",
  "node_modules",
]);

async function walk(currentDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".DS_Store")) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath);

    if (entry.isDirectory()) {
      if (skippedDirNames.has(entry.name) || entry.name.startsWith(".next")) {
        continue;
      }

      await walk(absolutePath);
      continue;
    }

    if (
      entry.name.startsWith("next.config ") &&
      /\s\d+\.(?:mjs|cjs|js|ts)$/u.test(entry.name)
    ) {
      issues.push(
        `Duplicate Next config variant detected: ${relativePath}`,
      );
    }

    if (
      entry.name.endsWith(".tsbuildinfo") &&
      !relativePath.startsWith(`apps${path.sep}web-admin${path.sep}.next${path.sep}`) &&
      relativePath !== `apps${path.sep}web-admin${path.sep}tsconfig.tsbuildinfo`
    ) {
      issues.push(`Loose TypeScript build info file detected: ${relativePath}`);
    }

    if (
      relativePath.includes(`${path.sep}dist${path.sep}`) &&
      /\.(?:test|spec)\.(?:d\.ts|js|js\.map)$/u.test(entry.name)
    ) {
      issues.push(`Compiled test artifact detected in dist output: ${relativePath}`);
    }
  }
}

await walk(rootDir);

async function runWebAdminI18nGuard() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "tools", "check-web-admin-i18n.mjs")], {
      cwd: rootDir,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error((stderr || stdout || "Web admin i18n guard failed.").trim()));
    });
  });
}

try {
  await runWebAdminI18nGuard();
} catch (error) {
  issues.push(error instanceof Error ? error.message : String(error));
}

if (issues.length > 0) {
  console.error("Repository lint failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Repository lint passed.");
