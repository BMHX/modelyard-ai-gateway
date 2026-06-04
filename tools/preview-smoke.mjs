import { loadRootEnv } from "./root-env.mjs";
import { runWebAdminSmokeChecks } from "./web-admin-smoke.mjs";

loadRootEnv({ profile: "production", required: true });

const controlApiBaseUrl =
  process.env.PREVIEW_CONTROL_API_BASE_URL ||
  process.env.CONTROL_API_PUBLIC_BASE_URL ||
  `http://127.0.0.1:${process.env.CONTROL_API_PUBLIC_PORT || process.env.CONTROL_API_PORT || "4001"}`;
const gatewayBaseUrl =
  process.env.PREVIEW_GATEWAY_BASE_URL ||
  process.env.GATEWAY_PUBLIC_BASE_URL ||
  `http://127.0.0.1:${process.env.GATEWAY_PUBLIC_PORT || process.env.GATEWAY_PORT || "4002"}`;
const exportWorkerHealthUrl =
  process.env.PREVIEW_EXPORT_WORKER_HEALTH_URL ||
  `http://127.0.0.1:${process.env.EXPORT_WORKER_HEALTH_PORT || "4010"}/healthz`;
const webAdminBaseUrl =
  process.env.WEB_ADMIN_BASE_URL ||
  `http://127.0.0.1:${process.env.WEB_ADMIN_PUBLIC_PORT || "3001"}`;
const controlApiAdminToken = process.env.CONTROL_API_ADMIN_TOKEN || "";
const gatewaySmokeBearerToken = process.env.PREVIEW_GATEWAY_SMOKE_BEARER_TOKEN || "";
const gatewaySmokePath = process.env.PREVIEW_GATEWAY_SMOKE_PATH || "/v1/models";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
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

function assertPrivateAttestationHeader(response, label) {
  const attestation =
    response.headers.get("x-teamops-private-attestation") ||
    response.headers.get("server-timing");

  assert(Boolean(attestation), `${label} is missing private attestation headers`);
}

async function waitForHealthyJson(url, label) {
  let lastError = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const result = await readJson(url);
      if (result.response.ok) {
        return result;
      }

      lastError = new Error(`${label} returned status ${result.response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(1000);
  }

  throw new Error(`${label} did not become healthy: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

const checks = [];
const skipped = [];

await waitForHealthyJson(`${controlApiBaseUrl}/healthz`, "control-api health");
checks.push("control-api health");

await waitForHealthyJson(`${gatewayBaseUrl}/healthz`, "gateway health");
checks.push("gateway health");

await waitForHealthyJson(exportWorkerHealthUrl, "export-worker health");
checks.push("export-worker health");

await waitForHealthyJson(`${webAdminBaseUrl}/api/healthz`, "web-admin health");
checks.push("web-admin health");

if (gatewaySmokeBearerToken) {
  const gatewaySmoke = await readJson(`${gatewayBaseUrl}${gatewaySmokePath}`, {
    headers: {
      authorization: `Bearer ${gatewaySmokeBearerToken}`,
    },
  });

  assert(gatewaySmoke.response.ok, `Gateway smoke request failed with status ${gatewaySmoke.response.status}`);
  assert(
    !gatewaySmoke.response.headers.get("x-teamops-demo-mode"),
    "Gateway smoke request still returned x-teamops-demo-mode. DEMO_MODE must be 0 in production.",
  );
  checks.push(`gateway live smoke ${gatewaySmokePath}`);
} else {
  skipped.push("gateway live smoke (no PREVIEW_GATEWAY_SMOKE_BEARER_TOKEN)");
}

if (controlApiAdminToken) {
  const organizations = await readJson(`${controlApiBaseUrl}/v1/organizations`, {
    headers: {
      authorization: `Bearer ${controlApiAdminToken}`,
    },
  });

  assert(organizations.response.ok, "Control API bootstrap admin authentication failed");
  assert(Array.isArray(organizations.payload?.items), "Organizations payload is missing items");
  assertPrivateAttestationHeader(organizations.response, "control-api organizations");
  checks.push("control-api bootstrap admin auth");

  const bootstrap = await readJson(`${webAdminBaseUrl}/api/console/bootstrap`);
  assert(bootstrap.response.ok, "Web admin bootstrap request failed");
  assertPrivateAttestationHeader(bootstrap.response, "web-admin bootstrap");
  checks.push("web-admin private attestation");

  try {
    const webAdminSmoke = await runWebAdminSmokeChecks({
      webAdminBaseUrl,
      controlApiBaseUrl,
      controlApiAdminToken,
      workspaceId: process.env.WEB_ADMIN_SMOKE_WORKSPACE_ID,
    });
    checks.push(...webAdminSmoke.checks.map((check) => `web-admin ${check}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unable to resolve a workspace id")) {
      skipped.push("web-admin resource pages (no workspace configured yet)");
    } else {
      throw error;
    }
  }
} else {
  skipped.push("control-api bootstrap admin auth (no CONTROL_API_ADMIN_TOKEN)");
  skipped.push("web-admin resource pages (no CONTROL_API_ADMIN_TOKEN)");
}

console.log("Preview smoke checks passed.");
console.log(`- control-api: ${controlApiBaseUrl}`);
console.log(`- gateway: ${gatewayBaseUrl}`);
console.log(`- export-worker: ${exportWorkerHealthUrl}`);
console.log(`- web-admin: ${webAdminBaseUrl}`);

for (const check of checks) {
  console.log(`- ${check}`);
}

for (const item of skipped) {
  console.log(`- skipped: ${item}`);
}
