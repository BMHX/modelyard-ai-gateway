import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRepoRoot, loadRootEnv } from "./root-env.mjs";

loadRootEnv({ profile: "development", required: true });

const repoRoot = getRepoRoot();
const demoDir = path.join(repoRoot, ".demo");
const demoStatePath = path.join(demoDir, "demo-state.json");
const outputPath = path.join(demoDir, "demo-brief.md");

const controlApiBaseUrl =
  process.env.CONTROL_API_BASE_URL ??
  process.env.NEXT_PUBLIC_CONTROL_API_BASE_URL ??
  "http://127.0.0.1:4001";
const gatewayBaseUrl = process.env.GATEWAY_PUBLIC_BASE_URL ?? "http://127.0.0.1:4002";
const webAdminBaseUrl = process.env.WEB_ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const controlApiAdminToken = process.env.CONTROL_API_ADMIN_TOKEN ?? "demo-admin-token";
const demoMode = process.env.DEMO_MODE ?? "1";

function fail(message) {
  throw new Error(message);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function findByLabel(items, label) {
  return items.find((item) => item?.label === label) ?? null;
}

function formatBudgetLine(budget) {
  const spend = Number(budget?.seededCurrentSpendUsd ?? 0).toFixed(2);
  const limit = Number(budget?.monthlyUsdLimit ?? 0).toFixed(2);
  const scope = budget?.environment ? `${budget.environment} environment` : "workspace";
  const state = budget?.seededState ?? "unknown";
  return `${scope}: $${spend} / $${limit} (${state})`;
}

const demoStateRaw = await readFile(demoStatePath, "utf8").catch((error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    fail(`Missing ${demoStatePath}. Run \`npm run demo:seed\` first.`);
  }

  throw error;
});

const demoState = JSON.parse(demoStateRaw);
const schemaVersion = typeof demoState?.schemaVersion === "number" ? demoState.schemaVersion : 1;
const organizations = asArray(demoState.organizations);
const sampleWorkspaces = asArray(demoState.sampleWorkspaces);
const workspaces = asArray(demoState.workspaces);
const projects = asArray(demoState.projects);
const environments = asArray(demoState.environments);
const members = asArray(demoState.members);
const providers = asArray(demoState.providerConnections);
const budgets = asArray(demoState.budgetPolicies);
const alerts = asArray(demoState.alerts);
const exportJobs = asArray(demoState.exportJobs);
const virtualKeys = asArray(demoState.virtualKeys);

const pilotOrganization =
  organizations.find((item) => item?.slug === "pilot-demo-org") ??
  organizations.find((item) => item?.name === "Pilot Customer Demo") ??
  null;
const pilotWorkspace =
  workspaces.find((item) => item?.slug === "customer-success-pilot") ??
  workspaces.find((item) => item?.name === "Customer Success Pilot") ??
  workspaces[0] ??
  null;
const pilotProject =
  projects.find((item) => item?.slug === "customer-support-agent") ??
  projects.find((item) => item?.workspaceId === pilotWorkspace?.id) ??
  null;
const stagingEnvironment =
  environments.find((item) => item?.projectId === pilotProject?.id && item?.slug === "staging") ??
  environments.find((item) => item?.workspaceId === pilotWorkspace?.id && item?.runtime === "staging") ??
  null;
const productionEnvironment =
  environments.find((item) => item?.projectId === pilotProject?.id && item?.slug === "production") ??
  environments.find((item) => item?.workspaceId === pilotWorkspace?.id && item?.runtime === "production") ??
  null;

const pilotMembers = members.filter((item) => item?.workspaceId === pilotWorkspace?.id);
const pilotProviders = providers.filter((item) => item?.workspaceId === pilotWorkspace?.id);
const pilotBudgets = budgets.filter((item) => item?.workspaceId === pilotWorkspace?.id);
const pilotAlerts = alerts.filter((item) => item?.workspaceId === pilotWorkspace?.id);
const pilotExports = exportJobs.filter((item) => item?.workspaceId === pilotWorkspace?.id);

const stagingKey = findByLabel(virtualKeys, "claude-code-staging");
const openAiStagingKey = findByLabel(virtualKeys, "openai-code-staging");
const productionKey = findByLabel(virtualKeys, "claude-code-prod");

const workspaceBudget =
  pilotBudgets.find((item) => !item?.projectId && !item?.environmentId) ?? pilotBudgets[0] ?? null;
const productionBudget =
  pilotBudgets.find((item) => item?.environment === "production") ??
  pilotBudgets.find((item) => item?.environmentId === productionEnvironment?.id) ??
  null;

const quickNotes = [];
if (schemaVersion < 3) {
  quickNotes.push(
    "This manifest was generated before the richer demo metadata landed. Rerun `npm run demo:seed` to refresh the three pilot samples, members, providers, budgets, and export jobs.",
  );
}

if (!pilotWorkspace) {
  quickNotes.push("Pilot workspace metadata is missing. The brief falls back to whatever is available in `.demo/demo-state.json`.");
}

const headerLines = [
  "# Pilot Demo Brief",
  "",
  `Generated from \`${path.relative(repoRoot, demoStatePath)}\` at ${demoState.generatedAt ?? "unknown time"}.`,
  "",
];

if (quickNotes.length > 0) {
  headerLines.push("## Metadata Notes", "");
  for (const note of quickNotes) {
    headerLines.push(`- ${note}`);
  }
  headerLines.push("");
}

const lines = [
  ...headerLines,
  "## Access",
  "",
  `- Web admin: ${webAdminBaseUrl}`,
  `- Control API: ${controlApiBaseUrl}`,
  `- Gateway: ${gatewayBaseUrl}`,
  `- Control API bootstrap token: \`${controlApiAdminToken}\``,
  `- Demo mode: \`${demoMode}\``,
  `- Source manifest: \`${path.relative(repoRoot, demoStatePath)}\``,
  "",
  "## Sample Workspaces",
  "",
];

if (sampleWorkspaces.length > 0) {
  for (const workspace of sampleWorkspaces) {
    lines.push(
      `- ${workspace.workspaceName ?? workspace.slug ?? "Unnamed workspace"}: ${workspace.track ?? "general"}${workspace.storyline ? ` - ${workspace.storyline}` : ""}`,
    );
  }
} else {
  lines.push("- Rerun `npm run demo:seed` to include the onboarding / guardrails / audit-export sample workspace map.");
}

lines.push(
  "",
  "## Seeded Tenant",
  "",
  `- Organization: ${pilotOrganization?.name ?? "Pilot Customer Demo"}`,
  `- Workspace: ${pilotWorkspace?.name ?? "Customer Success Pilot"}${pilotWorkspace?.id ? ` (\`${pilotWorkspace.id}\`)` : ""}`,
  `- Project: ${pilotProject?.name ?? "customer-support-agent"}${pilotProject?.id ? ` (\`${pilotProject.id}\`)` : ""}`,
  `- Environments: ${(stagingEnvironment?.name ?? "Staging")} / ${(productionEnvironment?.name ?? "Production")}`,
  `- Provider connections: ${
    pilotProviders.length > 0
      ? pilotProviders.map((item) => `${item.label} [${item.provider}]`).join(", ")
      : "Rerun `npm run demo:seed` to include provider metadata."
  }`,
  `- Budget posture: ${
    pilotBudgets.length > 0
      ? [workspaceBudget, productionBudget].filter(Boolean).map(formatBudgetLine).join("; ")
      : "Workspace soft-limit warning and production hard-limit block are part of the seeded scenario."
  }`,
  `- Alerts ready to show: ${
    pilotAlerts.length > 0
      ? pilotAlerts.map((item) => `${item.severity}/${item.code}`).join(", ")
      : "budget.soft-limit, budget.hard-limit"
  }`,
  `- Export jobs ready to show: ${
    pilotExports.length > 0
      ? pilotExports.map((item) => `${item.fileName} [${item.status}]`).join(", ")
      : "usage-april.csv [completed], audit-review.xlsx [pending]"
  }`,
  "",
  "## Operator Personas",
  "",
);

if (pilotMembers.length > 0) {
  for (const member of pilotMembers) {
    lines.push(
      `- ${member.name} <${member.email}>: role=${member.role}, status=${member.status ?? "unknown"}`,
    );
  }
} else {
  lines.push("- Rerun `npm run demo:seed` to embed seeded member identities in the manifest.");
}

lines.push(
  "",
  "## Quick Checks",
  "",
  "Control plane health and org listing:",
  "",
  "```bash",
  `curl ${shellQuote(`${controlApiBaseUrl}/healthz`)}`,
  `curl -H ${shellQuote(`Authorization: Bearer ${controlApiAdminToken}`)} ${shellQuote(`${controlApiBaseUrl}/v1/organizations`)}`,
  "```",
  "",
);

if (pilotWorkspace?.id) {
  lines.push(
    "Member-scoped budget view using the seeded workspace admin:",
    "",
    "```bash",
    `curl -H ${shellQuote("x-member-email: alice@example.com")} ${shellQuote(`${controlApiBaseUrl}/v1/budgets?workspaceId=${pilotWorkspace.id}`)}`,
    "```",
    "",
  );
}

if (stagingKey?.token) {
  lines.push(
    "Anthropic-style gateway request with the staging key:",
    "",
    "```bash",
    `curl -X POST ${shellQuote(`${gatewayBaseUrl}/v1/messages`)} \\`,
    `  -H ${shellQuote(`Authorization: Bearer ${stagingKey.token}`)} \\`,
    `  -H ${shellQuote("Content-Type: application/json")} \\`,
    "  -d '{",
    '    "model": "claude-sonnet-4-20250514",',
    '    "messages": [{"role": "user", "content": "Summarize the current pilot status."}]',
    "  }'",
    "```",
    "",
  );
}

if (openAiStagingKey?.token) {
  lines.push(
    "OpenAI Responses request with the seeded OpenAI-compatible key:",
    "",
    "```bash",
    `curl -X POST ${shellQuote(`${gatewayBaseUrl}/v1/responses`)} \\`,
    `  -H ${shellQuote(`Authorization: Bearer ${openAiStagingKey.token}`)} \\`,
    `  -H ${shellQuote("Content-Type: application/json")} \\`,
    "  -d '{",
    '    "model": "gpt-4.1-mini",',
    '    "input": "Summarize the pilot workspace status."',
    "  }'",
    "```",
    "",
  );
}

if (productionKey?.token) {
  lines.push(
    "Budget hard-limit block using the production key:",
    "",
    "```bash",
    `curl -X POST ${shellQuote(`${gatewayBaseUrl}/v1/messages`)} \\`,
    `  -H ${shellQuote(`Authorization: Bearer ${productionKey.token}`)} \\`,
    `  -H ${shellQuote("Content-Type: application/json")} \\`,
    "  -d '{",
    '    "model": "claude-sonnet-4-20250514",',
    '    "messages": [{"role": "user", "content": "Why is production blocked?"}]',
    "  }'",
    "```",
    "",
  );
}

lines.push(
  "## Demo Storyline",
  "",
  "- Start in `web-admin` and show the seeded pilot workspace, active alerts, and export history.",
  "- Open budgets to show the workspace soft-limit warning and the production hard-limit breach.",
  "- Open provider connections and virtual keys to show BYOK routing and scoped gateway access.",
  "- Run the staging gateway call to prove end-to-end traffic with synthetic demo responses.",
  "- Run the production gateway call to prove guardrails by returning the budget block path.",
  "",
  "## Product Boundary",
  "",
  "- Standard offer: hosted SaaS control plane and hosted gateway.",
  "- Technical preview: self-host evaluation for qualified customers, not a default SKU.",
  "- Reference the delivery matrix in `docs/DELIVERY_MATRIX.md` before promising self-host support, upgrade policy, or enterprise controls.",
  "",
);

await mkdir(demoDir, {
  recursive: true,
});

const content = `${lines.join("\n")}\n`;
await writeFile(outputPath, content, "utf8");

console.log(`Demo brief written to ${outputPath}`);
console.log(content);
