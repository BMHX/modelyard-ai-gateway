import fs from "node:fs/promises";
import path from "node:path";

import {
  copyRepoToStage,
  createStageDirectory,
  ensureDir,
  findRepoRoot,
  removePath,
  runCommand,
  syncStageOutputs,
  writeJson,
} from "./common.mjs";
import { readWatermarkContext, redactWatermarkContext } from "./context.mjs";
import { executeWatermarkPipeline } from "./pipeline.mjs";

function parseArgs(argv) {
  const parsed = {
    cleanup: [],
    keepStage: false,
    outputs: [],
  };
  const separatorIndex = argv.indexOf("--");

  if (separatorIndex < 0) {
    throw new Error("Usage: build.mjs --label <label> [--sync-out <path>]... -- <command> [...args]");
  }

  const optionArgs = argv.slice(0, separatorIndex);
  parsed.command = argv[separatorIndex + 1];
  parsed.commandArgs = argv.slice(separatorIndex + 2);

  if (!parsed.command) {
    throw new Error("Missing command after --");
  }

  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];

    if (option === "--label") {
      parsed.label = optionArgs[index + 1];
      index += 1;
      continue;
    }

    if (option === "--sync-out") {
      parsed.outputs.push(optionArgs[index + 1]);
      index += 1;
      continue;
    }

    if (option === "--cleanup") {
      parsed.cleanup.push(optionArgs[index + 1]);
      index += 1;
      continue;
    }

    if (option === "--keep-stage") {
      parsed.keepStage = true;
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  if (!parsed.label) {
    throw new Error("Missing required --label");
  }

  return parsed;
}

async function runDirect({ cleanup, command, commandArgs }) {
  for (const targetPath of cleanup) {
    await removePath(path.resolve(process.cwd(), targetPath));
  }

  await runCommand({
    args: commandArgs,
    command,
    cwd: process.cwd(),
    env: process.env,
  });
}

const args = parseArgs(process.argv.slice(2));
const context = readWatermarkContext(process.env);

if (!context) {
  await runDirect({
    cleanup: args.cleanup,
    command: args.command,
    commandArgs: args.commandArgs,
  });
  process.exit(0);
}

const repoRoot = await findRepoRoot(process.cwd());
const relativeCwd = path.relative(repoRoot, process.cwd());
const stageRoot = createStageDirectory(
  process.env.TEAMOPS_WATERMARK_STAGE_ROOT,
  context.locator,
);

console.log(
  `[semantic-watermark] preparing shadow build for ${args.label} at ${stageRoot}`,
);

await copyRepoToStage(repoRoot, stageRoot);
const stageReportDirectory = path.join(stageRoot, ".teamops-watermark");
await ensureDir(stageReportDirectory);

const watermarkResult = await executeWatermarkPipeline({
  context,
  label: args.label,
  repoRoot: stageRoot,
  reportDirectory: stageReportDirectory,
});

const stageCwd = path.join(stageRoot, relativeCwd);
for (const targetPath of args.cleanup) {
  await removePath(path.join(stageCwd, targetPath));
}

const stageEnv = {
  ...process.env,
  TEAMOPS_WATERMARK_ACTIVE: "1",
  TEAMOPS_WATERMARK_LABEL: args.label,
  TEAMOPS_WATERMARK_LOCATOR: context.locator,
  TEAMOPS_WATERMARK_STAGE_DIR: stageRoot,
  TEAMOPS_WATERMARK_REPORT_PATH: watermarkResult.reportPath ?? "",
};

if (args.label === "web-admin" && !stageEnv.BUILD_ID) {
  const buildIdSource = context.manifestHash || context.locator;
  stageEnv.BUILD_ID = buildIdSource.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || context.locator;
}

const stageRunMetadata = {
  affectedFiles: watermarkResult.affectedFiles,
  candidateCount: watermarkResult.candidateCount,
  codewordDigest: watermarkResult.codewordDigest,
  label: args.label,
  locator: context.locator,
  reportPath: watermarkResult.reportPath,
  stageRoot,
  watermark: redactWatermarkContext(context),
};

await writeJson(
  path.join(stageReportDirectory, "latest-run.json"),
  stageRunMetadata,
);

try {
  await runCommand({
    args: args.commandArgs,
    command: args.command,
    cwd: stageCwd,
    env: stageEnv,
  });

  await syncStageOutputs({
    outputs: args.outputs,
    relativeCwd,
    repoRoot,
    stageRoot,
  });

  const externalReportPath = process.env.TEAMOPS_WATERMARK_REPORT_PATH?.trim();
  if (externalReportPath && watermarkResult.reportPath) {
    await ensureDir(path.dirname(externalReportPath));
    await fs.copyFile(watermarkResult.reportPath, externalReportPath);
  }

  console.log(
    `[semantic-watermark] ${args.label} completed with locator ${context.locator}`,
  );
} catch (error) {
  console.error(
    `[semantic-watermark] ${args.label} failed; preserved shadow build at ${stageRoot}`,
  );
  throw error;
}

if (!(args.keepStage || process.env.TEAMOPS_WATERMARK_KEEP_STAGE === "1")) {
  await removePath(stageRoot);
}
