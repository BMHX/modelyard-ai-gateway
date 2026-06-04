import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const repoSentinelWorkspaces = new Set(["apps/*", "packages/*"]);

export const stageSkipNames = new Set([
  ".git",
  ".next",
  ".next-build",
  ".next-desktop",
  ".next-dev",
  ".next-member",
  ".next-noauth",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "test-results",
]);

export function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function readJson(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function removePath(targetPath) {
  await fs.rm(targetPath, { force: true, recursive: true });
}

export async function copyPath(sourcePath, targetPath) {
  const stats = await fs.lstat(sourcePath);

  if (stats.isSymbolicLink()) {
    const linkTarget = await fs.readlink(sourcePath);
    await fs.symlink(linkTarget, targetPath);
    return;
  }

  if (stats.isDirectory()) {
    await fs.cp(sourcePath, targetPath, { recursive: true });
    return;
  }

  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

export async function syncStageOutputs({
  repoRoot,
  stageRoot,
  relativeCwd,
  outputs,
}) {
  const sourceCwd = path.join(stageRoot, relativeCwd);
  const destinationCwd = path.join(repoRoot, relativeCwd);

  for (const output of outputs) {
    const sourcePath = path.join(sourceCwd, output);
    const destinationPath = path.join(destinationCwd, output);
    const exists = await pathExists(sourcePath);

    await removePath(destinationPath);
    if (!exists) {
      continue;
    }

    await copyPath(sourcePath, destinationPath);
  }
}

export async function findRepoRoot(startPath = process.cwd()) {
  let currentPath = path.resolve(startPath);

  while (true) {
    const packageJsonPath = path.join(currentPath, "package.json");
    if (await pathExists(packageJsonPath)) {
      try {
        const packageJson = await readJson(packageJsonPath);
        const workspaces = Array.isArray(packageJson.workspaces)
          ? packageJson.workspaces
          : [];
        const hasRepoLayout = workspaces.some((entry) =>
          repoSentinelWorkspaces.has(entry),
        );

        if (hasRepoLayout) {
          return currentPath;
        }
      } catch {
        // Ignore malformed package.json files while walking upward.
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error(`Unable to locate repository root from ${startPath}`);
    }

    currentPath = parentPath;
  }
}

function shouldCopyRelativePath(relativePath) {
  if (!relativePath || relativePath === ".") {
    return true;
  }

  const segments = relativePath.split(path.sep);
  for (const segment of segments) {
    if (stageSkipNames.has(segment)) {
      return false;
    }
  }

  return true;
}

export async function copyRepoToStage(repoRoot, stageRoot) {
  await ensureDir(stageRoot);

  await fs.cp(repoRoot, stageRoot, {
    recursive: true,
    filter: (sourcePath) => {
      const relativePath = path.relative(repoRoot, sourcePath);
      return shouldCopyRelativePath(relativePath);
    },
  });

  const nodeModulesPath = path.join(repoRoot, "node_modules");
  if (await pathExists(nodeModulesPath)) {
    await removePath(path.join(stageRoot, "node_modules"));
    await fs.symlink(nodeModulesPath, path.join(stageRoot, "node_modules"));
  }
}

export function createStageDirectory(stageRootOverride, locator) {
  const suffix = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const baseRoot =
    stageRootOverride?.trim() ||
    path.join(os.tmpdir(), "teamops-semantic-watermark");

  return path.join(baseRoot, `${locator}-${suffix}`);
}

export async function runCommand({
  args,
  command,
  cwd,
  env,
}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command exited via signal ${signal}`));
        return;
      }

      if ((code ?? 0) !== 0) {
        reject(new Error(`Command exited with code ${code ?? 1}`));
        return;
      }

      resolve();
    });
  });
}
