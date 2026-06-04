import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DetectionReport } from "./types.js";

function escapePipe(value: string) {
  return value.replace(/\|/g, "\\|");
}

export function renderMarkdownReport(report: DetectionReport) {
  const lines = [
    `# Detector Report`,
    ``,
    `- Case: \`${report.caseId}\``,
    `- Verdict: \`${report.verdict}\``,
    `- Confidence: \`${report.confidence}\``,
    `- Band: \`${report.band}\``,
    `- Generated: \`${report.generatedAt}\``,
    ``,
    `## Summary`,
    ``,
    `- Matched families: ${report.summary.matchedFamilies.length > 0 ? report.summary.matchedFamilies.map((family) => `\`${family}\``).join(", ") : "none"}`,
    `- Partial removal suspected: ${report.summary.partialRemovalSuspected ? "yes" : "no"}`,
    `- Likely sources: ${report.summary.likelySources.length > 0 ? report.summary.likelySources.map((item) => `\`${item.surface}\` (${item.confidence})`).join(", ") : "none"}`,
    ``,
    `## Scores`,
    ``,
    `| Family | Score |`,
    `| --- | --- |`,
    `| runtimeHeader | ${report.scores.runtimeHeader} |`,
    `| healthIdentity | ${report.scores.healthIdentity} |`,
    `| containerMetadata | ${report.scores.containerMetadata} |`,
    `| manifestFingerprint | ${report.scores.manifestFingerprint} |`,
    `| routeTopology | ${report.scores.routeTopology} |`,
    `| semanticWatermark | ${report.scores.semanticWatermark} |`,
    `| crossSignalBonus | ${report.scores.crossSignalBonus} |`,
    `| falsePositivePenalty | ${report.scores.falsePositivePenalty} |`,
    `| total | ${report.scores.total} |`,
    ``,
    `## Evidence`,
    ``,
    `| Signal | Family | Surface | Location | Matched Value |`,
    `| --- | --- | --- | --- | --- |`,
  ];

  for (const item of report.evidence) {
    const location = `${item.location.kind}:${item.location.path ?? item.location.target}`;
    lines.push(
      `| ${escapePipe(item.signal)} | ${item.family} | ${item.sourceSurface} | ${escapePipe(location)} | ${escapePipe(item.matchedValue)} |`,
    );
  }

  if (report.evidence.length === 0) {
    lines.push(`| none | - | - | - | - |`);
  }

  lines.push("", `## Review Actions`, "");
  for (const action of report.reviewActions) {
    lines.push(`- ${action}`);
  }

  if (report.errors.length > 0) {
    lines.push("", `## Errors`, "");
    for (const error of report.errors) {
      lines.push(`- ${error}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function writeReportArtifacts(report: DetectionReport, outputDir: string) {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "report.json");
  const markdownPath = path.join(outputDir, "report.md");

  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(markdownPath, renderMarkdownReport(report));

  return {
    jsonPath,
    markdownPath,
  };
}
