import { createHash } from "node:crypto";
import path from "node:path";

import type { DetectionTask, DetectorOptions, DetectorTarget, EvidenceRecord } from "./types.js";

export const DEFAULT_OPTIONS: DetectorOptions = {
  enableActiveProbes: true,
  captureScreenshots: false,
  headlessBrowser: false,
  maxDepth: 6,
  strictFalsePositiveMode: true,
  outputDir: null,
  timeoutMs: 12_000,
};

export function createCaseId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `case_${stamp}`;
}

export function createEvidenceId(seed: string) {
  return `ev_${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`;
}

export function createEvidence(input: Omit<EvidenceRecord, "id">): EvidenceRecord {
  const seed = JSON.stringify({
    family: input.family,
    signal: input.signal,
    matchedValue: input.matchedValue,
    target: input.location.target,
    path: input.location.path,
    kind: input.location.kind,
    details: input.location.details,
  });

  return {
    id: createEvidenceId(seed),
    ...input,
  };
}

export function normalizeTask(
  partial: Pick<DetectionTask, "mode" | "targets"> & Partial<Omit<DetectionTask, "mode" | "targets">>,
): DetectionTask {
  return {
    caseId: partial.caseId ?? createCaseId(),
    mode: partial.mode,
    targets: partial.targets.map(normalizeTarget),
    options: {
      ...DEFAULT_OPTIONS,
      ...(partial.options ?? {}),
    },
  };
}

export function normalizeTarget(target: DetectorTarget): DetectorTarget {
  if (target.type === "url" || target.type === "running-instance") {
    return {
      ...target,
      value: normalizeBaseUrl(target.value),
    };
  }

  return {
    ...target,
    value: path.resolve(target.value),
  };
}

export function normalizeBaseUrl(input: string) {
  const value = input.trim();
  if (!value) {
    return value;
  }

  const withProtocol = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function dedupeEvidence(evidence: EvidenceRecord[]) {
  const map = new Map<string, EvidenceRecord>();

  for (const item of evidence) {
    const key = [
      item.family,
      item.signal,
      item.location.kind,
      item.location.target,
      item.location.path ?? "",
      item.location.line ?? "",
      item.matchedValue,
    ].join("|");

    const existing = map.get(key);
    if (!existing || existing.baseWeight < item.baseWeight) {
      map.set(key, item);
    }
  }

  return [...map.values()].sort((left, right) => {
    const weightDelta = right.baseWeight - left.baseWeight;
    if (weightDelta !== 0) {
      return weightDelta;
    }

    return left.signal.localeCompare(right.signal);
  });
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
