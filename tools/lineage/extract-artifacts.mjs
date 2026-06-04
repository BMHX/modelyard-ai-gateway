import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeArtifactRole(relativePath) {
  if (relativePath.startsWith("dist/")) {
    return "server-dist";
  }
  if (relativePath.startsWith(".next/server/")) {
    return "next-server";
  }
  return "artifact";
}

function collectFamilySummary(sourceText) {
  const summary = new Map();

  const conditionalReturnMatches = sourceText.match(/\?\s*[^:]+:\s*[^;]+/g) ?? [];
  if (conditionalReturnMatches.length > 0) {
    summary.set("if-return", conditionalReturnMatches.length);
  }

  const objectAssignMatches = sourceText.match(/Object\.assign\(\{\}/g) ?? [];
  if (objectAssignMatches.length > 0) {
    summary.set("object-literal-assign", objectAssignMatches.length);
  }

  const promiseAllMatches = sourceText.match(/Promise\.all\(/g) ?? [];
  if (promiseAllMatches.length > 0) {
    summary.set("await-promise-all", promiseAllMatches.length);
  }

  const objectEntriesMatches = sourceText.match(/Object\.entries\(/g) ?? [];
  if (objectEntriesMatches.length > 0) {
    summary.set("for-of-object-entries", objectEntriesMatches.length);
  }

  const registrarLoopMatches = sourceText.match(/__wm_registrars_|__wm_register|forEach\(/g) ?? [];
  if (registrarLoopMatches.length > 0) {
    summary.set("await-call-sequence", registrarLoopMatches.length);
  }

  return [...summary.entries()].map(([family, hitCount]) => ({
    family,
    symbol: null,
    hitCount,
  }));
}

function extractLocatorCandidates(sourceText) {
  const matches = sourceText.match(/\b[a-z2-7]{16}\b/g) ?? [];
  return [...new Set(matches)];
}

function extractDigestCandidates(sourceText) {
  const matches = sourceText.match(/\b[a-f0-9]{64}\b/g) ?? [];
  return [...new Set(matches)];
}

async function walk(root, current = "", output = []) {
  const absoluteDir = path.join(root, current);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(current, entry.name);
    const absolutePath = path.join(root, relativePath);

    if (entry.isDirectory()) {
      await walk(root, relativePath, output);
      continue;
    }

    if (!/\.(?:js|mjs|cjs)$/u.test(entry.name)) {
      continue;
    }

    output.push({ absolutePath, relativePath });
  }

  return output;
}

export async function extractArtifacts(rootDir) {
  const files = await walk(rootDir);
  const observedArtifacts = [];
  const locatorCandidates = new Set();
  const digestCandidates = new Set();
  const familyHits = new Map();

  for (const file of files) {
    const content = await fs.readFile(file.absolutePath, "utf8");
    const stats = await fs.stat(file.absolutePath);
    const fileLocatorCandidates = extractLocatorCandidates(content);
    const fileDigestCandidates = extractDigestCandidates(content);
    const familySummary = collectFamilySummary(content);

    for (const candidate of fileLocatorCandidates) {
      locatorCandidates.add(candidate);
    }
    for (const candidate of fileDigestCandidates) {
      digestCandidates.add(candidate);
    }
    for (const family of familySummary) {
      familyHits.set(family.family, (familyHits.get(family.family) ?? 0) + family.hitCount);
    }

    observedArtifacts.push({
      artifactRole: normalizeArtifactRole(file.relativePath),
      relativePath: file.relativePath,
      sha256: hashText(content),
      sizeBytes: stats.size,
      buildLocator: fileLocatorCandidates[0] ?? null,
      codewordDigest: fileDigestCandidates[0] ?? null,
      candidateCount: familySummary.reduce((sum, item) => sum + item.hitCount, 0),
      assignmentCount: familySummary.reduce((sum, item) => sum + item.hitCount, 0),
      familySummary,
    });
  }

  const familyHitSummary = [...familyHits.entries()].map(([family, hitCount]) => ({
    family,
    symbol: null,
    hitCount,
  }));

  return {
    observedArtifacts,
    recoveredLocator: [...locatorCandidates][0] ?? null,
    locatorCandidates: [...locatorCandidates],
    codewordDigest: [...digestCandidates][0] ?? null,
    digestCandidates: [...digestCandidates],
    familyHitSummary,
    matchStatus: observedArtifacts.length > 0 ? "partial" : "unverifiable",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const targetPath = process.argv[2];
  if (!targetPath) {
    console.error("Usage: node ./tools/lineage/extract-artifacts.mjs <artifact-root>");
    process.exit(1);
  }

  const result = await extractArtifacts(path.resolve(targetPath));
  console.log(JSON.stringify(result, null, 2));
}
