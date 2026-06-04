import { scanFileTreeTarget } from "./file-tree.js";
import type { DetectorTarget, ExtractionResult } from "../types.js";

export async function extractBundleDir(target: DetectorTarget, maxDepth: number): Promise<ExtractionResult> {
  return scanFileTreeTarget(target, maxDepth);
}
