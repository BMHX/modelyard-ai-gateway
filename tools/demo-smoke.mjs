import { readFile } from "node:fs/promises";
import path from "node:path";

import { getRepoRoot } from "./root-env.mjs";
import { runWebAdminSmokeChecks } from "./web-admin-smoke.mjs";

const repoRoot = getRepoRoot();
const demoStatePath = path.join(repoRoot, ".demo", "demo-state.json");
const controlApiBaseUrl = process.env.CONTROL_API_BASE_URL || "http://127.0.0.1:4001";
const gatewayBaseUrl = process.env.GATEWAY_PUBLIC_BASE_URL || "http://127.0.0.1:4002";
const webAdminBaseUrl = process.env.WEB_ADMIN_BASE_URL || "http://127.0.0.1:3001";
const controlApiAdminToken = process.env.CONTROL_API_ADMIN_TOKEN || "demo-admin-token";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();

  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return {
    response,
    payload,
    text,
  };
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

const demoState = JSON.parse(await readFile(demoStatePath, "utf8"));
const stagingKey = demoState.virtualKeys.find((item) => item.label === "claude-code-staging");
const openAiStagingKey = demoState.virtualKeys.find((item) => item.label === "openai-code-staging");
const productionKey = demoState.virtualKeys.find((item) => item.label === "claude-code-prod");
const pilotWorkspace =
  demoState.workspaces.find((item) => item.name === "Customer Success Pilot") ?? demoState.workspaces[0];

assert(stagingKey, `Missing staging key in ${demoStatePath}`);
assert(openAiStagingKey, `Missing openai-code-staging key in ${demoStatePath}`);
assert(productionKey, `Missing production key in ${demoStatePath}`);
assert(pilotWorkspace?.id, `Missing a demo workspace in ${demoStatePath}`);

async function waitForExportJob(workspaceId, exportJobId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const jobs = await readJson(`${controlApiBaseUrl}/v1/export-jobs?workspaceId=${workspaceId}`, {
      headers: {
        authorization: `Bearer ${controlApiAdminToken}`,
      },
    });

    assert(jobs.response.ok, "Control API export jobs query failed");
    const job = jobs.payload?.items?.find((item) => item?.id === exportJobId);
    assert(job, "Created export job did not appear in the export job list");

    if (job.status === "completed") {
      return job;
    }

    if (job.status === "failed") {
      throw new Error(`Export job failed: ${job.errorMessage ?? "unknown error"}`);
    }

    await sleep(500);
  }

  throw new Error("Export job did not complete before the smoke timeout");
}

const checks = [];

const health = await readJson(`${controlApiBaseUrl}/healthz`);
assert(health.response.ok, "Control API health check failed");
checks.push("control-api health");

const organizations = await readJson(`${controlApiBaseUrl}/v1/organizations`, {
  headers: {
    authorization: `Bearer ${controlApiAdminToken}`,
  },
});
assert(organizations.response.ok, "Control API organizations query failed");
assert(Array.isArray(organizations.payload?.items), "Organizations payload is missing items");
checks.push("control-api auth");

const exportCreate = await readJson(`${controlApiBaseUrl}/v1/export-jobs`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${controlApiAdminToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    workspaceId: pilotWorkspace.id,
    kind: "usage-events",
    format: "csv",
    fileName: "smoke-export",
    filters: {},
  }),
});
assert(exportCreate.response.status === 201, "Control API export job creation failed");
assert(typeof exportCreate.payload?.id === "string", "Export job creation did not return an id");

const completedExport = await waitForExportJob(pilotWorkspace.id, exportCreate.payload.id);
assert(completedExport.rowCount !== null, "Completed export job is missing a row count");

const exportDownload = await fetch(`${controlApiBaseUrl}/v1/export-jobs/${completedExport.id}/download`, {
  headers: {
    authorization: `Bearer ${controlApiAdminToken}`,
  },
});
assert(exportDownload.ok, "Completed export job could not be downloaded");
assert(
  (exportDownload.headers.get("content-type") ?? "").includes("text/csv"),
  "Completed export job did not return a CSV download",
);

const exportContent = await exportDownload.text();
assert(exportContent.includes("workspace_id"), "Completed export CSV is missing headers");
checks.push("export job processing");

const webAdminSmoke = await runWebAdminSmokeChecks({
  webAdminBaseUrl,
  controlApiBaseUrl,
  controlApiAdminToken,
  workspaceId: pilotWorkspace.id,
});
checks.push(...webAdminSmoke.checks.map((check) => `web-admin ${check}`));

const successResult = await readJson(`${gatewayBaseUrl}/v1/messages`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${stagingKey.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "user",
        content: "Summarize the current pilot account status.",
      },
    ],
  }),
});
assert(successResult.response.ok, "Gateway demo success path failed");
assert(successResult.response.headers.get("x-teamops-gateway-protocol") === "anthropic", "Gateway protocol header missing for /v1/messages");
assert(successResult.response.headers.get("cache-control") === "no-store", "Gateway responses should disable caching");
assert(
  typeof successResult.payload?.content?.[0]?.text === "string" &&
    successResult.payload.content[0].text.includes("Demo mode is enabled"),
  "Gateway demo response did not include synthetic demo content",
);
checks.push("gateway success path");

const responsesResult = await readJson(`${gatewayBaseUrl}/v1/responses`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${openAiStagingKey.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4.1-mini",
    input: "Summarize the current pilot account status.",
  }),
});
assert(responsesResult.response.ok, "Gateway responses path failed");
assert(responsesResult.response.headers.get("x-teamops-gateway-protocol") === "openai-compatible", "Gateway protocol header missing for /v1/responses");
assert(responsesResult.response.headers.get("x-teamops-provider") === "openai", "Gateway provider header missing for /v1/responses");
assert(responsesResult.response.headers.get("x-teamops-upstream-status") === "200", "Gateway upstream debug header missing for /v1/responses");
assert(
  typeof responsesResult.payload?.output?.[0]?.content?.[0]?.text === "string" &&
    responsesResult.payload.output[0].content[0].text.includes("Demo mode is enabled"),
  "Gateway responses payload did not include synthetic demo content",
);
checks.push("gateway responses path");

const modelsResult = await readJson(`${gatewayBaseUrl}/v1/models`, {
  headers: {
    authorization: `Bearer ${openAiStagingKey.token}`,
  },
});
assert(modelsResult.response.ok, "Gateway models path failed");
assert(modelsResult.response.headers.get("x-teamops-gateway-protocol") === "openai-compatible", "Gateway protocol header missing for /v1/models");
assert(modelsResult.response.headers.get("x-teamops-provider") === "openai", "Gateway provider header missing for /v1/models");
assert(modelsResult.response.headers.get("x-teamops-upstream-status") === "200", "Gateway upstream debug header missing for /v1/models");
assert(Array.isArray(modelsResult.payload?.data), "Gateway models payload is missing data");
assert(modelsResult.payload.data.some((item) => item?.id === "gpt-4.1-mini"), "Gateway models payload is missing gpt-4.1-mini");
checks.push("gateway models path");

const modelDetailResult = await readJson(`${gatewayBaseUrl}/v1/models/gpt-4.1-mini`, {
  headers: {
    authorization: `Bearer ${openAiStagingKey.token}`,
  },
});
assert(modelDetailResult.response.ok, "Gateway model detail path failed");
assert(modelDetailResult.payload?.id === "gpt-4.1-mini", "Gateway model detail payload is missing gpt-4.1-mini");
checks.push("gateway model detail path");

const blockedResult = await readJson(`${gatewayBaseUrl}/v1/messages`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${productionKey.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "user",
        content: "Summarize the current pilot account status.",
      },
    ],
  }),
});
assert(blockedResult.response.status === 403, "Gateway hard-limit block path did not return 403");
assert(
  blockedResult.payload?.error?.message === "Monthly budget hard limit exceeded for this workspace scope",
  "Gateway hard-limit block message changed unexpectedly",
);
checks.push("gateway budget block path");

console.log("Demo smoke checks passed.");
for (const check of checks) {
  console.log(`- ${check}`);
}
