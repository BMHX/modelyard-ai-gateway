import path from "node:path";

import { extractBundleDir } from "./extractors/bundle-dir.js";
import { extractDeployDir } from "./extractors/deploy-dir.js";
import { extractDockerImage } from "./extractors/docker-image.js";
import { extractOnlineBrowser } from "./extractors/online-browser.js";
import { extractOnlineHttp } from "./extractors/online-http.js";
import { extractSourceTree } from "./extractors/source-tree.js";
import { dedupeEvidence, normalizeTask } from "./normalize.js";
import { writeReportArtifacts } from "./report.js";
import { scoreEvidence } from "./score.js";
import type {
  DetectionTask,
  DetectorMode,
  DetectorOptions,
  DetectorTarget,
  DetectorTargetType,
  ExtractionResult,
} from "./types.js";

function printUsage() {
  console.log(`Usage:
  npm run detect -- offline --source <path> [--bundle <path>] [--deploy <path>] [--image <name>] [--json]
  npm run detect -- online --url <url> [--browser] [--capture-screenshots] [--json]
`);
}

function pushTargets(targets: DetectorTarget[], type: DetectorTargetType, values: string[]) {
  for (const value of values) {
    targets.push({ type, value });
  }
}

function parseArgs(argv: string[]) {
  const mode = argv[0] as DetectorMode | undefined;
  if (mode !== "offline" && mode !== "online") {
    return null;
  }

  const sources: string[] = [];
  const bundles: string[] = [];
  const deploys: string[] = [];
  const images: string[] = [];
  const urls: string[] = [];

  const options: Partial<DetectorOptions> = {};
  let caseId: string | undefined;
  let outputJson = false;

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--source":
        if (!next) {
          throw new Error("--source requires a path");
        }
        sources.push(next);
        index += 1;
        break;
      case "--bundle":
        if (!next) {
          throw new Error("--bundle requires a path");
        }
        bundles.push(next);
        index += 1;
        break;
      case "--deploy":
        if (!next) {
          throw new Error("--deploy requires a path");
        }
        deploys.push(next);
        index += 1;
        break;
      case "--image":
        if (!next) {
          throw new Error("--image requires an image name");
        }
        images.push(next);
        index += 1;
        break;
      case "--url":
        if (!next) {
          throw new Error("--url requires a value");
        }
        urls.push(next);
        index += 1;
        break;
      case "--case-id":
        if (!next) {
          throw new Error("--case-id requires a value");
        }
        caseId = next;
        index += 1;
        break;
      case "--output-dir":
        if (!next) {
          throw new Error("--output-dir requires a directory");
        }
        options.outputDir = path.resolve(next);
        index += 1;
        break;
      case "--max-depth":
        if (!next) {
          throw new Error("--max-depth requires a number");
        }
        options.maxDepth = Number(next);
        index += 1;
        break;
      case "--timeout-ms":
        if (!next) {
          throw new Error("--timeout-ms requires a number");
        }
        options.timeoutMs = Number(next);
        index += 1;
        break;
      case "--browser":
        options.headlessBrowser = true;
        break;
      case "--capture-screenshots":
        options.captureScreenshots = true;
        break;
      case "--json":
        outputJson = true;
        break;
      case "--no-active-probes":
        options.enableActiveProbes = false;
        break;
      case "--relaxed":
        options.strictFalsePositiveMode = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const targets: DetectorTarget[] = [];
  if (mode === "offline") {
    pushTargets(targets, "source-tree", sources);
    pushTargets(targets, "bundle-dir", bundles);
    pushTargets(targets, "deploy-dir", deploys);
    pushTargets(targets, "docker-image", images);
  } else {
    pushTargets(targets, "url", urls);
  }

  if (targets.length === 0) {
    throw new Error(`No targets provided for ${mode}`);
  }

  return {
    task: normalizeTask({
      caseId,
      mode,
      targets,
      options,
    }),
    outputJson,
  };
}

async function runTarget(target: DetectorTarget, task: DetectionTask): Promise<ExtractionResult[]> {
  switch (target.type) {
    case "source-tree":
      return [await extractSourceTree(target, task.options.maxDepth)];
    case "bundle-dir":
      return [await extractBundleDir(target, task.options.maxDepth)];
    case "deploy-dir":
      return [await extractDeployDir(target, task.options.maxDepth)];
    case "docker-image":
      return [await extractDockerImage(target)];
    case "url": {
      const results: ExtractionResult[] = [];
      results.push(await extractOnlineHttp(target, task.options.timeoutMs));
      if (task.options.headlessBrowser || task.options.captureScreenshots) {
        const browserOutputDir = task.options.outputDir
          ? path.join(task.options.outputDir, "browser")
          : null;
        results.push(
          await extractOnlineBrowser({
            target,
            outputDir: browserOutputDir,
            captureScreenshots: task.options.captureScreenshots,
          }),
        );
      }
      return results;
    }
    default:
      return [
        {
          target,
          evidence: [],
          errors: [`Unsupported target type: ${target.type}`],
          artifacts: [],
        },
      ];
  }
}

function printSummary(report: Awaited<ReturnType<typeof buildReport>>) {
  console.log(`case: ${report.caseId}`);
  console.log(`verdict: ${report.verdict}`);
  console.log(`confidence: ${report.confidence}`);
  console.log(`band: ${report.band}`);
  console.log(`matched families: ${report.summary.matchedFamilies.join(", ") || "none"}`);
  console.log(
    `likely sources: ${
      report.summary.likelySources.length > 0
        ? report.summary.likelySources.map((item) => `${item.surface} (${item.confidence})`).join(", ")
        : "none"
    }`,
  );
  console.log(`evidence: ${report.evidence.length}`);
  if (report.errors.length > 0) {
    console.log(`errors: ${report.errors.length}`);
  }
}

async function buildReport(task: DetectionTask) {
  const results = await Promise.all(task.targets.map((target) => runTarget(target, task)));
  const flat = results.flat();
  const evidence = dedupeEvidence(flat.flatMap((item) => item.evidence));
  const errors = flat.flatMap((item) => item.errors);
  const artifacts = flat.flatMap((item) => item.artifacts);

  const scored = scoreEvidence({
    evidence,
    errors,
    task,
  });

  return {
    caseId: task.caseId,
    generatedAt: new Date().toISOString(),
    task,
    evidence,
    errors,
    artifacts,
    ...scored,
  };
}

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const report = await buildReport(parsed.task);

  if (parsed.task.options.outputDir) {
    const paths = await writeReportArtifacts(report, parsed.task.options.outputDir);
    report.artifacts.push(paths.jsonPath, paths.markdownPath);
  }

  if (parsed.outputJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
}
