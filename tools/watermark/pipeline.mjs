import fs from "node:fs/promises";
import path from "node:path";

import { hashText, writeJson } from "./common.mjs";
import { buildSemanticCodeword } from "./codeword.mjs";
import { collectWatermarkCandidates, applyWatermarkAssignments } from "./semantic-families.mjs";
import { resolveWatermarkScopes, supportedSourceExtensions } from "./site-registry.mjs";

async function listSourceFiles(rootDir, relativeRoot, output = []) {
  const currentDir = path.join(rootDir, relativeRoot);
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(relativeRoot, entry.name);
    const absolutePath = path.join(rootDir, relativePath);

    if (entry.isDirectory()) {
      await listSourceFiles(rootDir, relativePath, output);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!supportedSourceExtensions.has(extension)) {
      continue;
    }

    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) {
      continue;
    }

    output.push(relativePath);
  }

  return output;
}

export async function executeWatermarkPipeline({
  context,
  label,
  repoRoot,
  reportDirectory,
}) {
  const scopes = resolveWatermarkScopes(label);
  if (scopes.length === 0) {
    return {
      affectedFiles: [],
      candidateCount: 0,
      codewordDigest: null,
      locator: context.locator,
      reportPath: null,
    };
  }

  const sourceFiles = [];
  for (const scope of scopes) {
    const relativeScope = scope;
    const absoluteScope = path.join(repoRoot, relativeScope);
    const stats = await fs.lstat(absoluteScope);

    if (stats.isDirectory()) {
      await listSourceFiles(repoRoot, relativeScope, sourceFiles);
    } else {
      sourceFiles.push(relativeScope);
    }
  }

  const fileCandidates = [];
  for (const relativeFilePath of sourceFiles) {
    const absoluteFilePath = path.join(repoRoot, relativeFilePath);
    const sourceText = await fs.readFile(absoluteFilePath, "utf8");
    const candidates = collectWatermarkCandidates({
      filePath: relativeFilePath,
      sourceText,
    });

    fileCandidates.push(
      ...candidates.map((candidate) => ({
        ...candidate,
        label,
      })),
    );
  }

  const codeword = buildSemanticCodeword({
    context,
    sites: fileCandidates,
  });

  const assignmentsByFile = new Map();
  for (const assignment of codeword.assignments) {
    const fileAssignments = assignmentsByFile.get(assignment.filePath) ?? [];
    fileAssignments.push(assignment);
    assignmentsByFile.set(assignment.filePath, fileAssignments);
  }

  const affectedFiles = [];
  for (const [filePath, assignments] of assignmentsByFile.entries()) {
    const absoluteFilePath = path.join(repoRoot, filePath);
    const sourceText = await fs.readFile(absoluteFilePath, "utf8");
    const nextSourceText = applyWatermarkAssignments({
      assignments,
      filePath,
      sourceText,
    });

    if (nextSourceText !== sourceText) {
      await fs.writeFile(absoluteFilePath, nextSourceText, "utf8");
      affectedFiles.push({
        assignmentCount: assignments.length,
        filePath,
        sourceHash: hashText(sourceText),
        transformedHash: hashText(nextSourceText),
      });
    }
  }

  const report = {
    schema: context.reportSchema,
    createdAt: new Date().toISOString(),
    locator: context.locator,
    label,
    metadata: {
      buildChannel: context.buildChannel,
      codewordDigest: codeword.codewordDigest,
      customerId: context.customerId,
      deploymentId: context.deploymentId,
      profile: context.profile,
      releaseId: context.releaseId,
      schemeVersion: context.schemeVersion,
    },
    candidateCount: fileCandidates.length,
    affectedFiles,
    assignments: codeword.assignments.map((assignment) => ({
      family: assignment.family,
      filePath: assignment.filePath,
      line: assignment.line,
      role: assignment.role,
      siteId: assignment.siteId,
      symbol: assignment.symbol,
      weights: assignment.weights,
    })),
  };

  const reportPath = path.join(
    reportDirectory,
    `${label}-${context.locator}.json`,
  );
  await writeJson(reportPath, report);

  return {
    affectedFiles,
    candidateCount: fileCandidates.length,
    codewordDigest: codeword.codewordDigest,
    locator: context.locator,
    reportPath,
  };
}
