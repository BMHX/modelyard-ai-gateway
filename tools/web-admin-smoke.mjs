import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getRepoRoot } from "./root-env.mjs";

const repoRoot = getRepoRoot();
const demoStatePath = path.join(repoRoot, ".demo", "demo-state.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function maybeReadDemoState() {
  try {
    return JSON.parse(await readFile(demoStatePath, "utf8"));
  } catch {
    return null;
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

function assertNoFatalServerError(html, label) {
  const fatalMarkers = [
    "Internal Server Error",
    "Application error: a server-side exception has occurred",
    "Unhandled Runtime Error",
    "digest:",
  ];

  for (const marker of fatalMarkers) {
    assert(!html.includes(marker), `${label} rendered a fatal server error marker: ${marker}`);
  }
}

async function resolveWorkspaceId({ controlApiBaseUrl, controlApiAdminToken, workspaceId }) {
  const explicitWorkspaceId = workspaceId ?? process.env.WEB_ADMIN_SMOKE_WORKSPACE_ID ?? process.env.WORKSPACE_ID;
  if (explicitWorkspaceId) {
    return explicitWorkspaceId;
  }

  const demoState = await maybeReadDemoState();
  const preferredWorkspace =
    demoState?.workspaces?.find?.((item) => item?.name === "Customer Success Pilot") ?? demoState?.workspaces?.[0];
  if (preferredWorkspace?.id) {
    return preferredWorkspace.id;
  }

  if (!controlApiAdminToken) {
    return null;
  }

  const workspaceOptions = await readJson(`${controlApiBaseUrl}/v1/workspace-options`, {
    headers: {
      authorization: `Bearer ${controlApiAdminToken}`,
    },
  });
  assert(workspaceOptions.response.ok, "Unable to discover a workspace for web-admin smoke checks");

  return workspaceOptions.payload?.items?.[0]?.id ?? null;
}

export async function runWebAdminSmokeChecks({
  webAdminBaseUrl = process.env.WEB_ADMIN_BASE_URL || "http://127.0.0.1:3001",
  controlApiBaseUrl = process.env.CONTROL_API_BASE_URL || "http://127.0.0.1:4001",
  controlApiAdminToken = process.env.CONTROL_API_ADMIN_TOKEN || "",
  workspaceId,
} = {}) {
  const resolvedWorkspaceId = await resolveWorkspaceId({
    controlApiBaseUrl,
    controlApiAdminToken,
    workspaceId,
  });

  assert(resolvedWorkspaceId, "Unable to resolve a workspace id for web-admin smoke checks");

  const checks = [
    {
      label: "control-center",
      path: `/?workspaceId=${resolvedWorkspaceId}`,
      expectedText: "Control Center",
    },
    {
      label: "providers",
      path: `/providers?workspaceId=${resolvedWorkspaceId}`,
      expectedText: "Providers",
    },
    {
      label: "alerts",
      path: `/alerts?workspaceId=${resolvedWorkspaceId}`,
      expectedText: "Alerts",
    },
    {
      label: "exports",
      path: `/exports?workspaceId=${resolvedWorkspaceId}`,
      expectedText: "Exports",
    },
  ];

  for (const check of checks) {
    const response = await fetch(`${webAdminBaseUrl}${check.path}`);
    const html = await response.text();

    assert(response.ok, `Web admin ${check.label} request failed with status ${response.status}`);
    assertNoFatalServerError(html, check.label);
    assert(html.includes(check.expectedText), `Web admin ${check.label} page did not render expected text: ${check.expectedText}`);
    if (check.label === "control-center") {
      assert(!html.includes("Today Workbench"), "Web admin control-center page still rendered retired IA text: Today Workbench");
    }
  }

  return {
    workspaceId: resolvedWorkspaceId,
    checks: checks.map((check) => check.label),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runWebAdminSmokeChecks();
  console.log(`Web admin smoke checks passed for workspace ${result.workspaceId}.`);
  for (const check of result.checks) {
    console.log(`- ${check}`);
  }
}
