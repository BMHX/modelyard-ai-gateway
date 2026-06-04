import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { matchPathSignals, matchTextSignals } from "../matchers.js";
import type { DetectorTarget, DetectorTargetType, ExtractionResult } from "../types.js";

const defaultSkipNames = new Set([
  ".git",
  ".detector-report",
  ".turbo",
  "coverage",
  "node_modules",
]);

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function shouldSkipDirectory(name: string, targetType: DetectorTargetType) {
  if (defaultSkipNames.has(name)) {
    return true;
  }

  if (targetType === "source-tree") {
    return name === ".next" || name === ".next-desktop" || name === "dist";
  }

  return false;
}

function shouldSkipPath(args: {
  absolutePath: string;
  rootPath: string;
  targetType: DetectorTargetType;
}) {
  if (args.targetType !== "source-tree") {
    return false;
  }

  const normalizedRelativePath = path.relative(args.rootPath, args.absolutePath).split(path.sep).join("/");
  return normalizedRelativePath === "tools/detector" || normalizedRelativePath.startsWith("tools/detector/");
}

function shouldAttemptTextRead(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  return textExtensions.has(extension) || basename.startsWith("Dockerfile") || basename === "package-lock.json";
}

async function readMaybeText(filePath: string) {
  const buffer = await readFile(filePath);
  if (buffer.byteLength > 2_000_000) {
    return null;
  }

  for (let index = 0; index < Math.min(buffer.byteLength, 1024); index += 1) {
    if (buffer[index] === 0) {
      return null;
    }
  }

  return buffer.toString("utf8");
}

async function walkDirectory(args: {
  currentPath: string;
  rootTarget: string;
  rootPath: string;
  targetType: DetectorTargetType;
  maxDepth: number;
  depth: number;
  evidence: ExtractionResult["evidence"];
  errors: string[];
}) {
  const fileStat = await stat(args.currentPath);
  if (!fileStat.isDirectory()) {
    return;
  }

  const entries = await readdir(args.currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(args.currentPath, entry.name);
    const relativePath = path.relative(args.rootPath, absolutePath) || entry.name;

    if (entry.isDirectory()) {
      if (
        args.depth >= args.maxDepth ||
        shouldSkipDirectory(entry.name, args.targetType) ||
        shouldSkipPath({
          absolutePath,
          rootPath: args.rootPath,
          targetType: args.targetType,
        })
      ) {
        continue;
      }

      await walkDirectory({
        ...args,
        currentPath: absolutePath,
        depth: args.depth + 1,
      });
      continue;
    }

    args.evidence.push(
      ...matchPathSignals({
        absolutePath,
        rootTarget: args.rootTarget,
        targetType: args.targetType,
      }),
    );

    if (!shouldAttemptTextRead(absolutePath)) {
      continue;
    }

    try {
      const text = await readMaybeText(absolutePath);
      if (!text) {
        continue;
      }

      args.evidence.push(
        ...matchTextSignals({
          text,
          locationKind: "file-text",
          target: args.rootTarget,
          pathName: relativePath.split(path.sep).join("/"),
          targetType: args.targetType,
        }),
      );
    } catch (error) {
      args.errors.push(
        `Failed to read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export async function scanFileTreeTarget(target: DetectorTarget, maxDepth: number): Promise<ExtractionResult> {
  const evidence: ExtractionResult["evidence"] = [];
  const errors: string[] = [];

  await walkDirectory({
    currentPath: target.value,
    rootTarget: target.value,
    rootPath: target.value,
    targetType: target.type,
    maxDepth,
    depth: 0,
    evidence,
    errors,
  });

  return {
    target,
    evidence,
    errors,
    artifacts: [],
  };
}
