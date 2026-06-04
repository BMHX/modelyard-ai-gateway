import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { matchTextSignals } from "../matchers.js";
import type { DetectorTarget, ExtractionResult } from "../types.js";

const execFileAsync = promisify(execFile);

async function runDocker(args: string[]) {
  return execFileAsync("docker", args, {
    maxBuffer: 16 * 1024 * 1024,
  });
}

export async function extractDockerImage(target: DetectorTarget): Promise<ExtractionResult> {
  const evidence: ExtractionResult["evidence"] = [];
  const errors: string[] = [];

  try {
    const inspectResult = await runDocker(["image", "inspect", target.value]);
    evidence.push(
      ...matchTextSignals({
        text: inspectResult.stdout,
        locationKind: "docker-inspect",
        target: target.value,
        pathName: "docker image inspect",
        targetType: target.type,
      }),
    );
  } catch (error) {
    errors.push(`docker image inspect failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const historyResult = await runDocker([
      "history",
      "--no-trunc",
      "--format",
      "{{json .}}",
      target.value,
    ]);
    evidence.push(
      ...matchTextSignals({
        text: historyResult.stdout,
        locationKind: "docker-history",
        target: target.value,
        pathName: "docker history",
        targetType: target.type,
      }),
    );
  } catch (error) {
    errors.push(`docker history failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    target,
    evidence,
    errors,
    artifacts: [],
  };
}
