import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadRootEnv } from "@teamops/config";
import { getRepoRoot } from "@teamops/config";

import {
  appendAuditLog,
  appendUsageEvent,
  buildBudgetAlertDedupeKey,
  createBudgetPolicy,
  createDatabase,
  createEnvironment,
  createExportJob,
  createMember,
  createOrganization,
  createProject,
  createProviderConnection,
  createVirtualKey,
  getCurrentBudgetPeriod,
  recordProviderConnectionTestResult,
  createWorkspace,
  runMigrations,
  upsertAlert,
} from "./index.js";

const demoOrganizationSlugs = ["pilot-demo-org", "internal-demo-org"];
const periodKey = getCurrentBudgetPeriod().key;
const demoStateDir = path.join(getRepoRoot(), ".demo");
const demoStatePath = path.join(demoStateDir, "demo-state.json");
const internalWorkspaceSpendUsd = 7.85;
const workspaceBudgetCurrentSpendUsd = 127;
const productionBudgetCurrentSpendUsd = 105;
const onboardingWorkspaceSpendUsd = 6.4;
const financeWorkspaceSpendUsd = 18.75;
const incidentWorkspaceSpendUsd = 42.3;
const agencyWorkspaceSpendUsd = 11.2;

loadRootEnv({ required: false });

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.ENCRYPTION_KEY_BASE64;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (!encryptionKey) {
  throw new Error("ENCRYPTION_KEY_BASE64 is required");
}

const db = createDatabase(databaseUrl);

try {
  await runMigrations(db);

  await db.query(
    `
      delete from organizations
      where slug = any($1::text[])
    `,
    [demoOrganizationSlugs],
  );

  const internalOrg = await createOrganization(db, {
    name: "Internal Platform Operations",
    slug: "internal-demo-org",
  });

  const internalWorkspace = await createWorkspace(db, {
    organizationId: internalOrg.id,
    name: "Platform Operations",
    slug: "platform-operations",
  });

  const internalProject = await createProject(db, {
    workspaceId: internalWorkspace.id,
    name: "developer-experience",
    slug: "developer-experience",
  });

  const internalProduction = await createEnvironment(db, {
    workspaceId: internalWorkspace.id,
    projectId: internalProject.id,
    name: "Production",
    slug: "production",
    runtime: "production",
  });

  const internalMember = await createMember(db, {
    workspaceId: internalWorkspace.id,
    email: "ops@example.com",
    name: "Ops Lead",
    role: "workspace_admin",
    roles: ["workspace_admin"],
    temporaryAccessExpiresAt: null,
  });

  const internalProvider = await createProviderConnection(
    db,
    {
      workspaceId: internalWorkspace.id,
      provider: "openai",
      label: "OpenAI Primary Connection",
      apiKey: "demo-openai-key",
      metadata: {
        defaultForProtocol: "openai-compatible",
      },
    },
    encryptionKey,
  );

  const internalVirtualKey = await createVirtualKey(db, {
    workspaceId: internalWorkspace.id,
    providerConnectionId: internalProvider.id,
    projectId: internalProject.id,
    environmentId: internalProduction.id,
    label: "platform-prod",
    owner: null,
    team: null,
    service: null,
    environment: "production",
    scopes: ["claude-code", "dashboard"],
    expiresAt: null,
  });

  const internalWorkspaceBudget = await createBudgetPolicy(db, {
    workspaceId: internalWorkspace.id,
    projectId: null,
    environmentId: null,
    environment: null,
    monthlyUsdLimit: 80,
    softLimitPercent: 80,
  });

  await appendUsageEvent(db, {
    workspaceId: internalWorkspace.id,
    projectId: internalProject.id,
    environmentId: internalProduction.id,
    virtualKeyId: internalVirtualKey.record.id,
    providerConnectionId: internalProvider.id,
    requestId: "seed-internal-usage-1",
    providerRequestId: "seed-internal-provider-1",
    provider: "openai",
    model: "gpt-4.1-mini",
    promptTokens: 5200,
    completionTokens: 1900,
    costUsd: internalWorkspaceSpendUsd,
    latencyMs: 1420,
    status: "success",
    metadata: {
      seeded: true,
      demoWorkspace: "internal",
    },
  });

  const pilotOrg = await createOrganization(db, {
    name: "Customer Operations Group",
    slug: "pilot-demo-org",
  });

  const pilotWorkspace = await createWorkspace(db, {
    organizationId: pilotOrg.id,
    name: "Customer Success Operations",
    slug: "customer-success-pilot",
  });

  const pilotProject = await createProject(db, {
    workspaceId: pilotWorkspace.id,
    name: "customer-support-agent",
    slug: "customer-support-agent",
  });

  const pilotStaging = await createEnvironment(db, {
    workspaceId: pilotWorkspace.id,
    projectId: pilotProject.id,
    name: "Staging",
    slug: "staging",
    runtime: "staging",
  });

  const pilotProduction = await createEnvironment(db, {
    workspaceId: pilotWorkspace.id,
    projectId: pilotProject.id,
    name: "Production",
    slug: "production",
    runtime: "production",
  });

  const pilotMembers = await Promise.all([
    createMember(db, {
      workspaceId: pilotWorkspace.id,
      email: "alice@example.com",
      name: "Alice Zhang",
      role: "workspace_admin",
      roles: ["workspace_admin"],
      temporaryAccessExpiresAt: null,
    }),
    createMember(db, {
      workspaceId: pilotWorkspace.id,
      email: "bob@example.com",
      name: "Bob Chen",
      role: "developer",
      roles: ["developer"],
      temporaryAccessExpiresAt: null,
    }),
    createMember(db, {
      workspaceId: pilotWorkspace.id,
      email: "finance@example.com",
      name: "Finance Analyst",
      role: "developer",
      roles: ["developer"],
      temporaryAccessExpiresAt: null,
    }),
  ]);

  await db.query(
    `
      update members
      set status = 'active'
      where workspace_id = $1
    `,
    [pilotWorkspace.id],
  );

  const pilotProvider = await createProviderConnection(
    db,
    {
      workspaceId: pilotWorkspace.id,
      provider: "anthropic",
      label: "Anthropic Primary Connection",
      apiKey: "demo-anthropic-key",
      metadata: {},
    },
    encryptionKey,
  );

  const pilotOpenAiProvider = await createProviderConnection(
    db,
    {
      workspaceId: pilotWorkspace.id,
      provider: "openai",
      label: "OpenAI Primary Connection",
      apiKey: "demo-openai-key",
      metadata: {
        defaultForProtocol: "openai-compatible",
      },
    },
    encryptionKey,
  );

  const stagingKey = await createVirtualKey(db, {
    workspaceId: pilotWorkspace.id,
    providerConnectionId: pilotProvider.id,
    projectId: pilotProject.id,
    environmentId: pilotStaging.id,
    label: "claude-code-staging",
    owner: null,
    team: null,
    service: null,
    environment: "staging",
    scopes: ["claude-code", "qa"],
    expiresAt: null,
  });

  const openAiStagingKey = await createVirtualKey(db, {
    workspaceId: pilotWorkspace.id,
    providerConnectionId: pilotOpenAiProvider.id,
    projectId: pilotProject.id,
    environmentId: pilotStaging.id,
    label: "openai-code-staging",
    owner: null,
    team: null,
    service: null,
    environment: "staging",
    scopes: ["openai-compatible", "qa"],
    expiresAt: null,
  });

  const productionKey = await createVirtualKey(db, {
    workspaceId: pilotWorkspace.id,
    providerConnectionId: pilotProvider.id,
    projectId: pilotProject.id,
    environmentId: pilotProduction.id,
    label: "claude-code-prod",
    owner: null,
    team: null,
    service: null,
    environment: "production",
    scopes: ["claude-code", "production"],
    expiresAt: null,
  });

  const workspaceBudget = await createBudgetPolicy(db, {
    workspaceId: pilotWorkspace.id,
    projectId: null,
    environmentId: null,
    environment: null,
    monthlyUsdLimit: 150,
    softLimitPercent: 80,
  });

  const productionBudget = await createBudgetPolicy(db, {
    workspaceId: pilotWorkspace.id,
    projectId: pilotProject.id,
    environmentId: pilotProduction.id,
    environment: "production",
    monthlyUsdLimit: 100,
    softLimitPercent: 75,
  });

  await appendUsageEvent(db, {
    workspaceId: pilotWorkspace.id,
    projectId: pilotProject.id,
    environmentId: pilotProduction.id,
    virtualKeyId: productionKey.record.id,
    providerConnectionId: pilotProvider.id,
    requestId: "seed-pilot-usage-1",
    providerRequestId: "seed-pilot-provider-1",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    promptTokens: 21000,
    completionTokens: 6500,
    costUsd: 70,
    latencyMs: 1880,
    status: "success",
    metadata: {
      seeded: true,
      environment: "production",
    },
  });

  await appendUsageEvent(db, {
    workspaceId: pilotWorkspace.id,
    projectId: pilotProject.id,
    environmentId: pilotProduction.id,
    virtualKeyId: productionKey.record.id,
    providerConnectionId: pilotProvider.id,
    requestId: "seed-pilot-usage-2",
    providerRequestId: "seed-pilot-provider-2",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    promptTokens: 10200,
    completionTokens: 4800,
    costUsd: 35,
    latencyMs: 1640,
    status: "success",
    metadata: {
      seeded: true,
      environment: "production",
    },
  });

  await appendUsageEvent(db, {
    workspaceId: pilotWorkspace.id,
    projectId: pilotProject.id,
    environmentId: pilotStaging.id,
    virtualKeyId: stagingKey.record.id,
    providerConnectionId: pilotProvider.id,
    requestId: "seed-pilot-usage-3",
    providerRequestId: "seed-pilot-provider-3",
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    promptTokens: 8900,
    completionTokens: 2300,
    costUsd: 22,
    latencyMs: 980,
    status: "success",
    metadata: {
      seeded: true,
      environment: "staging",
    },
  });

  await appendUsageEvent(db, {
    workspaceId: pilotWorkspace.id,
    projectId: pilotProject.id,
    environmentId: pilotProduction.id,
    virtualKeyId: productionKey.record.id,
    providerConnectionId: pilotProvider.id,
    requestId: "seed-pilot-blocked-1",
    providerRequestId: null,
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    latencyMs: 12,
    status: "blocked",
    metadata: {
      seeded: true,
      budgetAlertDedupeKey: buildBudgetAlertDedupeKey({
        budgetPolicyId: productionBudget.id,
        kind: "hard-limit",
        periodKey,
      }),
      budgetAlertCode: "budget.hard-limit",
      reason: "budget_hard_limit_exceeded",
      budgetPolicyId: productionBudget.id,
      budgetPolicyIds: [productionBudget.id],
      exhaustedBudgetPolicyIds: [productionBudget.id],
      periodKey,
      currentMonthSpendUsd: productionBudgetCurrentSpendUsd,
      monthlyUsdLimit: productionBudget.monthlyUsdLimit,
      budgetEnvironmentId: pilotProduction.id,
      budgetEnvironment: productionBudget.environment,
    },
  });

  await db.query(
    `
      update virtual_keys
      set last_used_at = now() - interval '15 minutes'
      where id = any($1::uuid[])
    `,
    [[productionKey.record.id, stagingKey.record.id, openAiStagingKey.record.id, internalVirtualKey.record.id]],
  );

  await upsertAlert(db, {
    workspaceId: pilotWorkspace.id,
    severity: "warning",
    code: "budget.soft-limit",
    title: "workspace reached 80% of its monthly budget",
    body: `workspace has spent $127.00 out of $150.00 in ${periodKey}.`,
    dedupeKey: buildBudgetAlertDedupeKey({
      budgetPolicyId: workspaceBudget.id,
      kind: "soft-limit",
      periodKey,
    }),
    metadata: {
      seeded: true,
      budgetPolicyId: workspaceBudget.id,
      scopeKind: "workspace",
      periodKey,
      currentMonthSpendUsd: workspaceBudgetCurrentSpendUsd,
      monthlyUsdLimit: workspaceBudget.monthlyUsdLimit,
      softLimitPercent: workspaceBudget.softLimitPercent,
    },
  });

  await upsertAlert(db, {
    workspaceId: pilotWorkspace.id,
    severity: "critical",
    code: "budget.hard-limit",
    title: "production budget exhausted",
    body: `production has spent $105.00 and is past the $100.00 hard limit for ${periodKey}.`,
    dedupeKey: buildBudgetAlertDedupeKey({
      budgetPolicyId: productionBudget.id,
      kind: "hard-limit",
      periodKey,
    }),
    metadata: {
      seeded: true,
      budgetPolicyId: productionBudget.id,
      scopeKind: "environment",
      projectId: pilotProject.id,
      currentMonthSpendUsd: productionBudgetCurrentSpendUsd,
      monthlyUsdLimit: productionBudget.monthlyUsdLimit,
      softLimitPercent: productionBudget.softLimitPercent,
      environmentId: pilotProduction.id,
      environment: productionBudget.environment,
      periodKey,
    },
  });

  const completedUsageExport = await createExportJob(db, {
    workspaceId: pilotWorkspace.id,
    kind: "usage-events",
    format: "csv",
    fileName: "usage-april.csv",
    filters: {
      workspaceId: pilotWorkspace.id,
    },
  });
  await db.query(
    `
      update export_jobs
      set status = 'completed', completed_at = now()
      where id = $1
    `,
    [completedUsageExport.id],
  );

  const pendingAuditExport = await createExportJob(db, {
    workspaceId: pilotWorkspace.id,
    kind: "audit-logs",
    format: "xlsx",
    fileName: "audit-review.xlsx",
    filters: {
      workspaceId: pilotWorkspace.id,
    },
  });

  const internalUsageExport = await createExportJob(db, {
    workspaceId: internalWorkspace.id,
    kind: "usage-events",
    format: "csv",
    fileName: "platform-usage.csv",
    filters: {
      workspaceId: internalWorkspace.id,
    },
  });

  await appendAuditLog(db, {
    workspaceId: pilotWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.seeded",
    subjectType: "workspace",
    subjectId: pilotWorkspace.id,
    payload: {
      seeded: true,
      workspaceName: pilotWorkspace.name,
    },
  });

  await appendAuditLog(db, {
    workspaceId: pilotWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.onboarding.first_provider_connected",
    subjectType: "workspace",
    subjectId: pilotWorkspace.id,
    payload: {
      seeded: true,
      providerConnectionId: pilotProvider.id,
      provider: pilotProvider.provider,
      label: pilotProvider.label,
    },
  });

  await appendAuditLog(db, {
    workspaceId: pilotWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "provider-connection.created",
    subjectType: "provider-connection",
    subjectId: pilotProvider.id,
    payload: {
      seeded: true,
      provider: pilotProvider.provider,
      label: pilotProvider.label,
    },
  });

  await appendAuditLog(db, {
    workspaceId: pilotWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "provider-connection.created",
    subjectType: "provider-connection",
    subjectId: pilotOpenAiProvider.id,
    payload: {
      seeded: true,
      provider: pilotOpenAiProvider.provider,
      label: pilotOpenAiProvider.label,
    },
  });

  await appendAuditLog(db, {
    workspaceId: pilotWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.onboarding.first_virtual_key_created",
    subjectType: "workspace",
    subjectId: pilotWorkspace.id,
    payload: {
      seeded: true,
      virtualKeyId: productionKey.record.id,
      label: productionKey.record.label,
      providerConnectionId: pilotProvider.id,
      provider: pilotProvider.provider,
      environment: productionKey.record.environment,
      keyPrefix: productionKey.record.keyPrefix,
    },
  });

  await appendAuditLog(db, {
    workspaceId: pilotWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "virtual-key.created",
    subjectType: "virtual-key",
    subjectId: productionKey.record.id,
    payload: {
      seeded: true,
      label: productionKey.record.label,
      keyPrefix: productionKey.record.keyPrefix,
    },
  });

  const onboardingWorkspace = await createWorkspace(db, {
    organizationId: pilotOrg.id,
    name: "AI Onboarding Lab",
    slug: "ai-onboarding-lab",
  });

  const onboardingProject = await createProject(db, {
    workspaceId: onboardingWorkspace.id,
    name: "agent-sandbox",
    slug: "agent-sandbox",
  });

  const onboardingSandbox = await createEnvironment(db, {
    workspaceId: onboardingWorkspace.id,
    projectId: onboardingProject.id,
    name: "Sandbox",
    slug: "sandbox",
    runtime: "development",
  });

  const onboardingStaging = await createEnvironment(db, {
    workspaceId: onboardingWorkspace.id,
    projectId: onboardingProject.id,
    name: "Staging",
    slug: "staging",
    runtime: "staging",
  });

  const onboardingMembers = await Promise.all([
    createMember(db, {
      workspaceId: onboardingWorkspace.id,
      email: "starter-admin@example.com",
      name: "Starter Admin",
      role: "workspace_admin",
      roles: ["workspace_admin"],
      temporaryAccessExpiresAt: null,
    }),
    createMember(db, {
      workspaceId: onboardingWorkspace.id,
      email: "builder@example.com",
      name: "Builder",
      role: "developer",
      roles: ["developer"],
      temporaryAccessExpiresAt: null,
    }),
  ]);

  const onboardingProvider = await createProviderConnection(
    db,
    {
      workspaceId: onboardingWorkspace.id,
      provider: "openai",
      label: "OpenAI Starter Route",
      apiKey: "demo-openai-key",
      metadata: {
        defaultForProtocol: "openai-compatible",
      },
    },
    encryptionKey,
  );

  await recordProviderConnectionTestResult(db, onboardingProvider.id, {
    testedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    status: "passed",
    error: null,
    statusCode: 200,
    latencyMs: 480,
  });

  const onboardingKey = await createVirtualKey(db, {
    workspaceId: onboardingWorkspace.id,
    providerConnectionId: onboardingProvider.id,
    projectId: onboardingProject.id,
    environmentId: onboardingSandbox.id,
    label: "starter-sandbox",
    owner: null,
    team: null,
    service: null,
    environment: "development",
    scopes: ["sandbox", "qa"],
    expiresAt: null,
  });

  const onboardingBudget = await createBudgetPolicy(db, {
    workspaceId: onboardingWorkspace.id,
    projectId: null,
    environmentId: null,
    environment: null,
    monthlyUsdLimit: 60,
    softLimitPercent: 80,
  });

  await appendUsageEvent(db, {
    workspaceId: onboardingWorkspace.id,
    projectId: onboardingProject.id,
    environmentId: onboardingSandbox.id,
    virtualKeyId: onboardingKey.record.id,
    providerConnectionId: onboardingProvider.id,
    requestId: "seed-onboarding-usage-1",
    providerRequestId: "seed-onboarding-provider-1",
    provider: "openai",
    model: "gpt-4.1-mini",
    promptTokens: 2400,
    completionTokens: 1100,
    costUsd: onboardingWorkspaceSpendUsd,
    latencyMs: 620,
    status: "success",
    metadata: {
      seeded: true,
      scenario: "onboarding",
    },
  });

  await appendAuditLog(db, {
    workspaceId: onboardingWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.seeded",
    subjectType: "workspace",
    subjectId: onboardingWorkspace.id,
    payload: {
      seeded: true,
      workspaceName: onboardingWorkspace.name,
    },
  });

  await appendAuditLog(db, {
    workspaceId: onboardingWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.onboarding.first_provider_connected",
    subjectType: "workspace",
    subjectId: onboardingWorkspace.id,
    payload: {
      seeded: true,
      providerConnectionId: onboardingProvider.id,
      provider: onboardingProvider.provider,
      label: onboardingProvider.label,
    },
  });

  await appendAuditLog(db, {
    workspaceId: onboardingWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "provider-connection.created",
    subjectType: "provider-connection",
    subjectId: onboardingProvider.id,
    payload: {
      seeded: true,
      provider: onboardingProvider.provider,
      label: onboardingProvider.label,
    },
  });

  await appendAuditLog(db, {
    workspaceId: onboardingWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.onboarding.first_provider_tested",
    subjectType: "workspace",
    subjectId: onboardingWorkspace.id,
    payload: {
      seeded: true,
      providerConnectionId: onboardingProvider.id,
      provider: onboardingProvider.provider,
      label: onboardingProvider.label,
      ok: true,
      statusCode: 200,
      latencyMs: 480,
    },
  });

  await appendAuditLog(db, {
    workspaceId: onboardingWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "provider-connection.tested",
    subjectType: "provider-connection",
    subjectId: onboardingProvider.id,
    payload: {
      seeded: true,
      provider: onboardingProvider.provider,
      label: onboardingProvider.label,
      ok: true,
      statusCode: 200,
      latencyMs: 480,
    },
  });

  await appendAuditLog(db, {
    workspaceId: onboardingWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.onboarding.first_virtual_key_created",
    subjectType: "workspace",
    subjectId: onboardingWorkspace.id,
    payload: {
      seeded: true,
      virtualKeyId: onboardingKey.record.id,
      label: onboardingKey.record.label,
      providerConnectionId: onboardingProvider.id,
      provider: onboardingProvider.provider,
      environment: onboardingKey.record.environment,
      keyPrefix: onboardingKey.record.keyPrefix,
    },
  });

  await appendAuditLog(db, {
    workspaceId: onboardingWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "virtual-key.created",
    subjectType: "virtual-key",
    subjectId: onboardingKey.record.id,
    payload: {
      seeded: true,
      label: onboardingKey.record.label,
      keyPrefix: onboardingKey.record.keyPrefix,
    },
  });

  const financeWorkspace = await createWorkspace(db, {
    organizationId: pilotOrg.id,
    name: "Finance Audit Operations",
    slug: "finance-audit-pilot",
  });

  const financeProject = await createProject(db, {
    workspaceId: financeWorkspace.id,
    name: "monthly-close",
    slug: "monthly-close",
  });

  const financeProduction = await createEnvironment(db, {
    workspaceId: financeWorkspace.id,
    projectId: financeProject.id,
    name: "Production",
    slug: "production",
    runtime: "production",
  });

  const financeMembers = await Promise.all([
    createMember(db, {
      workspaceId: financeWorkspace.id,
      email: "controller@example.com",
      name: "Controller",
      role: "developer",
      roles: ["developer"],
      temporaryAccessExpiresAt: null,
    }),
    createMember(db, {
      workspaceId: financeWorkspace.id,
      email: "governance@example.com",
      name: "Governance Lead",
      role: "workspace_admin",
      roles: ["workspace_admin"],
      temporaryAccessExpiresAt: null,
    }),
  ]);

  const financeProvider = await createProviderConnection(
    db,
    {
      workspaceId: financeWorkspace.id,
      provider: "openai",
      label: "OpenAI Finance Route",
      apiKey: "demo-openai-key",
      metadata: {
        defaultForProtocol: "openai-compatible",
      },
    },
    encryptionKey,
  );

  const financeKey = await createVirtualKey(db, {
    workspaceId: financeWorkspace.id,
    providerConnectionId: financeProvider.id,
    projectId: financeProject.id,
    environmentId: financeProduction.id,
    label: "finance-reporting-prod",
    owner: null,
    team: null,
    service: null,
    environment: "production",
    scopes: ["reporting", "audit"],
    expiresAt: null,
  });

  const financeBudget = await createBudgetPolicy(db, {
    workspaceId: financeWorkspace.id,
    projectId: null,
    environmentId: null,
    environment: null,
    monthlyUsdLimit: 55,
    softLimitPercent: 85,
  });

  await appendUsageEvent(db, {
    workspaceId: financeWorkspace.id,
    projectId: financeProject.id,
    environmentId: financeProduction.id,
    virtualKeyId: financeKey.record.id,
    providerConnectionId: financeProvider.id,
    requestId: "seed-finance-usage-1",
    providerRequestId: "seed-finance-provider-1",
    provider: "openai",
    model: "gpt-4.1-mini",
    promptTokens: 5600,
    completionTokens: 2100,
    costUsd: financeWorkspaceSpendUsd,
    latencyMs: 770,
    status: "success",
    metadata: {
      seeded: true,
      scenario: "audit-export",
    },
  });

  const financeAuditExport = await createExportJob(db, {
    workspaceId: financeWorkspace.id,
    kind: "audit-logs",
    format: "xlsx",
    fileName: "finance-audit-trail.xlsx",
    filters: {
      workspaceId: financeWorkspace.id,
    },
  });

  await db.query(
    `
      update export_jobs
      set status = 'completed', completed_at = now()
      where id = $1
    `,
    [financeAuditExport.id],
  );

  const financeUsageExport = await createExportJob(db, {
    workspaceId: financeWorkspace.id,
    kind: "usage-events",
    format: "csv",
    fileName: "finance-usage-ledger.csv",
    filters: {
      workspaceId: financeWorkspace.id,
    },
  });

  await db.query(
    `
      update export_jobs
      set status = 'completed', completed_at = now()
      where id = $1
    `,
    [financeUsageExport.id],
  );

  await appendAuditLog(db, {
    workspaceId: financeWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.seeded",
    subjectType: "workspace",
    subjectId: financeWorkspace.id,
    payload: {
      seeded: true,
      workspaceName: financeWorkspace.name,
    },
  });

  await appendAuditLog(db, {
    workspaceId: financeWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.onboarding.first_export_requested",
    subjectType: "workspace",
    subjectId: financeWorkspace.id,
    payload: {
      seeded: true,
      exportJobId: financeAuditExport.id,
      kind: financeAuditExport.kind,
      format: financeAuditExport.format,
      fileName: financeAuditExport.fileName,
    },
  });

  await appendAuditLog(db, {
    workspaceId: financeWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "export.requested",
    subjectType: "export-job",
    subjectId: financeAuditExport.id,
    payload: {
      seeded: true,
      kind: financeAuditExport.kind,
      format: financeAuditExport.format,
      fileName: financeAuditExport.fileName,
      filters: financeAuditExport.filters,
    },
  });

  const incidentWorkspace = await createWorkspace(db, {
    organizationId: pilotOrg.id,
    name: "Incident Response Desk",
    slug: "incident-response-desk",
  });

  const incidentProject = await createProject(db, {
    workspaceId: incidentWorkspace.id,
    name: "escalation-triage",
    slug: "escalation-triage",
  });

  const incidentProduction = await createEnvironment(db, {
    workspaceId: incidentWorkspace.id,
    projectId: incidentProject.id,
    name: "Production",
    slug: "production",
    runtime: "production",
  });

  const incidentShadow = await createEnvironment(db, {
    workspaceId: incidentWorkspace.id,
    projectId: incidentProject.id,
    name: "Shadow",
    slug: "shadow",
    runtime: "staging",
  });

  const incidentMembers = await Promise.all([
    createMember(db, {
      workspaceId: incidentWorkspace.id,
      email: "incident-admin@example.com",
      name: "Incident Admin",
      role: "workspace_admin",
      roles: ["workspace_admin"],
      temporaryAccessExpiresAt: null,
    }),
    createMember(db, {
      workspaceId: incidentWorkspace.id,
      email: "responder@example.com",
      name: "Primary Responder",
      role: "developer",
      roles: ["developer"],
      temporaryAccessExpiresAt: null,
    }),
  ]);

  const incidentAnthropicProvider = await createProviderConnection(
    db,
    {
      workspaceId: incidentWorkspace.id,
      provider: "anthropic",
      label: "Anthropic Escalation Route",
      apiKey: "demo-anthropic-key",
      metadata: {},
    },
    encryptionKey,
  );

  const incidentOpenAiProvider = await createProviderConnection(
    db,
    {
      workspaceId: incidentWorkspace.id,
      provider: "openai",
      label: "OpenAI Fallback Route",
      apiKey: "demo-openai-key",
      metadata: {
        defaultForProtocol: "openai-compatible",
      },
    },
    encryptionKey,
  );

  await recordProviderConnectionTestResult(db, incidentAnthropicProvider.id, {
    testedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    status: "failed",
    error: "gateway timeout during health probe",
    statusCode: 504,
    latencyMs: 4100,
  });

  await recordProviderConnectionTestResult(db, incidentOpenAiProvider.id, {
    testedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    status: "passed",
    error: null,
    statusCode: 200,
    latencyMs: 650,
  });

  const incidentProductionKey = await createVirtualKey(db, {
    workspaceId: incidentWorkspace.id,
    providerConnectionId: incidentOpenAiProvider.id,
    projectId: incidentProject.id,
    environmentId: incidentProduction.id,
    label: "incident-prod-fallback",
    owner: null,
    team: "incident-response",
    service: "triage-agent",
    environment: "production",
    scopes: ["production", "incident"],
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const incidentShadowKey = await createVirtualKey(db, {
    workspaceId: incidentWorkspace.id,
    providerConnectionId: incidentAnthropicProvider.id,
    projectId: incidentProject.id,
    environmentId: incidentShadow.id,
    label: "incident-shadow-qa",
    owner: null,
    team: "incident-response",
    service: "shadow-replay",
    environment: "staging",
    scopes: ["shadow", "qa"],
    expiresAt: null,
  });

  const incidentBudget = await createBudgetPolicy(db, {
    workspaceId: incidentWorkspace.id,
    projectId: null,
    environmentId: null,
    environment: null,
    monthlyUsdLimit: 95,
    softLimitPercent: 80,
  });

  await appendUsageEvent(db, {
    workspaceId: incidentWorkspace.id,
    projectId: incidentProject.id,
    environmentId: incidentProduction.id,
    virtualKeyId: incidentProductionKey.record.id,
    providerConnectionId: incidentOpenAiProvider.id,
    requestId: "seed-incident-usage-1",
    providerRequestId: "seed-incident-provider-1",
    provider: "openai",
    model: "gpt-4.1-mini",
    promptTokens: 9800,
    completionTokens: 2600,
    costUsd: 27.8,
    latencyMs: 1120,
    status: "success",
    metadata: {
      seeded: true,
      scenario: "incident-fallback",
    },
  });

  await appendUsageEvent(db, {
    workspaceId: incidentWorkspace.id,
    projectId: incidentProject.id,
    environmentId: incidentShadow.id,
    virtualKeyId: incidentShadowKey.record.id,
    providerConnectionId: incidentAnthropicProvider.id,
    requestId: "seed-incident-usage-2",
    providerRequestId: "seed-incident-provider-2",
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    promptTokens: 4200,
    completionTokens: 1700,
    costUsd: 14.5,
    latencyMs: 2330,
    status: "error",
    metadata: {
      seeded: true,
      scenario: "provider-regression",
      providerStatus: "degraded",
    },
  });

  await upsertAlert(db, {
    workspaceId: incidentWorkspace.id,
    severity: "critical",
    code: "provider.health.failed",
    title: "primary escalation route is failing health checks",
    body: "Anthropic escalation route failed the latest health probe and fallback traffic is rising.",
    dedupeKey: `seed:provider-health:${incidentAnthropicProvider.id}`,
    metadata: {
      seeded: true,
      providerConnectionId: incidentAnthropicProvider.id,
      provider: incidentAnthropicProvider.provider,
      label: incidentAnthropicProvider.label,
      lastTestStatus: "failed",
      statusCode: 504,
    },
  });

  const incidentExport = await createExportJob(db, {
    workspaceId: incidentWorkspace.id,
    kind: "audit-logs",
    format: "csv",
    fileName: "incident-handoff.csv",
    filters: {
      workspaceId: incidentWorkspace.id,
    },
  });

  await appendAuditLog(db, {
    workspaceId: incidentWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.seeded",
    subjectType: "workspace",
    subjectId: incidentWorkspace.id,
    payload: {
      seeded: true,
      workspaceName: incidentWorkspace.name,
    },
  });

  await appendAuditLog(db, {
    workspaceId: incidentWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "provider-connection.tested",
    subjectType: "provider-connection",
    subjectId: incidentAnthropicProvider.id,
    payload: {
      seeded: true,
      provider: incidentAnthropicProvider.provider,
      label: incidentAnthropicProvider.label,
      ok: false,
      statusCode: 504,
      latencyMs: 4100,
    },
  });

  await appendAuditLog(db, {
    workspaceId: incidentWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "virtual-key.created",
    subjectType: "virtual-key",
    subjectId: incidentProductionKey.record.id,
    payload: {
      seeded: true,
      label: incidentProductionKey.record.label,
      keyPrefix: incidentProductionKey.record.keyPrefix,
    },
  });

  const agencyWorkspace = await createWorkspace(db, {
    organizationId: pilotOrg.id,
    name: "Agency Client Delivery",
    slug: "agency-client-delivery",
  });

  const agencyProject = await createProject(db, {
    workspaceId: agencyWorkspace.id,
    name: "campaign-automation",
    slug: "campaign-automation",
  });

  const agencyStaging = await createEnvironment(db, {
    workspaceId: agencyWorkspace.id,
    projectId: agencyProject.id,
    name: "Staging",
    slug: "staging",
    runtime: "staging",
  });

  const agencyProduction = await createEnvironment(db, {
    workspaceId: agencyWorkspace.id,
    projectId: agencyProject.id,
    name: "Production",
    slug: "production",
    runtime: "production",
  });

  const agencyMembers = await Promise.all([
    createMember(db, {
      workspaceId: agencyWorkspace.id,
      email: "agency-admin@example.com",
      name: "Agency Admin",
      role: "workspace_admin",
      roles: ["workspace_admin"],
      temporaryAccessExpiresAt: null,
    }),
    createMember(db, {
      workspaceId: agencyWorkspace.id,
      email: "delivery@example.com",
      name: "Delivery Manager",
      role: "developer",
      roles: ["developer"],
      temporaryAccessExpiresAt: null,
    }),
    createMember(db, {
      workspaceId: agencyWorkspace.id,
      email: "analyst@example.com",
      name: "Analytics Partner",
      role: "developer",
      roles: ["developer"],
      temporaryAccessExpiresAt: null,
    }),
  ]);

  const agencyProvider = await createProviderConnection(
    db,
    {
      workspaceId: agencyWorkspace.id,
      provider: "openai",
      label: "OpenAI Client Delivery Route",
      apiKey: "demo-openai-key",
      metadata: {
        defaultForProtocol: "openai-compatible",
      },
    },
    encryptionKey,
  );

  await recordProviderConnectionTestResult(db, agencyProvider.id, {
    testedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    status: "passed",
    error: null,
    statusCode: 200,
    latencyMs: 540,
  });

  const agencyStagingKey = await createVirtualKey(db, {
    workspaceId: agencyWorkspace.id,
    providerConnectionId: agencyProvider.id,
    projectId: agencyProject.id,
    environmentId: agencyStaging.id,
    label: "agency-staging-review",
    owner: null,
    team: "client-delivery",
    service: "campaign-review",
    environment: "staging",
    scopes: ["review", "staging"],
    expiresAt: null,
  });

  const agencyProductionKey = await createVirtualKey(db, {
    workspaceId: agencyWorkspace.id,
    providerConnectionId: agencyProvider.id,
    projectId: agencyProject.id,
    environmentId: agencyProduction.id,
    label: "agency-prod-shared",
    owner: null,
    team: "client-delivery",
    service: "campaign-runtime",
    environment: "production",
    scopes: ["campaign", "reporting"],
    expiresAt: null,
  });

  const agencyBudget = await createBudgetPolicy(db, {
    workspaceId: agencyWorkspace.id,
    projectId: null,
    environmentId: null,
    environment: null,
    monthlyUsdLimit: 70,
    softLimitPercent: 80,
  });

  await appendUsageEvent(db, {
    workspaceId: agencyWorkspace.id,
    projectId: agencyProject.id,
    environmentId: agencyProduction.id,
    virtualKeyId: agencyProductionKey.record.id,
    providerConnectionId: agencyProvider.id,
    requestId: "seed-agency-usage-1",
    providerRequestId: "seed-agency-provider-1",
    provider: "openai",
    model: "gpt-4.1-mini",
    promptTokens: 3600,
    completionTokens: 1400,
    costUsd: agencyWorkspaceSpendUsd,
    latencyMs: 690,
    status: "success",
    metadata: {
      seeded: true,
      scenario: "client-delivery",
    },
  });

  const agencyUsageExport = await createExportJob(db, {
    workspaceId: agencyWorkspace.id,
    kind: "usage-events",
    format: "csv",
    fileName: "agency-usage-weekly.csv",
    filters: {
      workspaceId: agencyWorkspace.id,
    },
  });

  await appendAuditLog(db, {
    workspaceId: agencyWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "workspace.seeded",
    subjectType: "workspace",
    subjectId: agencyWorkspace.id,
    payload: {
      seeded: true,
      workspaceName: agencyWorkspace.name,
    },
  });

  await appendAuditLog(db, {
    workspaceId: agencyWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "provider-connection.created",
    subjectType: "provider-connection",
    subjectId: agencyProvider.id,
    payload: {
      seeded: true,
      provider: agencyProvider.provider,
      label: agencyProvider.label,
    },
  });

  await appendAuditLog(db, {
    workspaceId: agencyWorkspace.id,
    actorType: "system",
    actorId: "demo-seed",
    action: "export.requested",
    subjectType: "export-job",
    subjectId: agencyUsageExport.id,
    payload: {
      seeded: true,
      kind: agencyUsageExport.kind,
      format: agencyUsageExport.format,
      fileName: agencyUsageExport.fileName,
      filters: agencyUsageExport.filters,
    },
  });

  const demoState = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    organizations: [
      {
        name: internalOrg.name,
        slug: internalOrg.slug,
        id: internalOrg.id,
      },
      {
        name: pilotOrg.name,
        slug: pilotOrg.slug,
        id: pilotOrg.id,
      },
    ],
    sampleWorkspaces: [
      {
        workspaceId: onboardingWorkspace.id,
        workspaceName: onboardingWorkspace.name,
        slug: onboardingWorkspace.slug,
        track: "onboarding",
        storyline: "Show first provider connection, first successful provider test, and first scoped key issuance.",
      },
      {
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        slug: pilotWorkspace.slug,
        track: "guardrails",
        storyline: "Show staged rollout, budget pressure, open alerts, and the hard-limit block path.",
      },
      {
        workspaceId: financeWorkspace.id,
        workspaceName: financeWorkspace.name,
        slug: financeWorkspace.slug,
        track: "audit-export",
        storyline: "Show audit history, evidence export, and handoff-ready finance workflows.",
      },
      {
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        slug: incidentWorkspace.slug,
        track: "incident-response",
        storyline: "Show provider health degradation, fallback traffic, expiring production keys, and incident handoff.",
      },
      {
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        slug: agencyWorkspace.slug,
        track: "client-delivery",
        storyline: "Show a healthy delivery workspace with active usage, dormant shared keys, and weekly exports.",
      },
    ],
    workspaces: [
      {
        name: internalWorkspace.name,
        slug: internalWorkspace.slug,
        organization: internalOrg.name,
        organizationId: internalOrg.id,
        id: internalWorkspace.id,
      },
      {
        name: pilotWorkspace.name,
        slug: pilotWorkspace.slug,
        organization: pilotOrg.name,
        organizationId: pilotOrg.id,
        id: pilotWorkspace.id,
      },
      {
        name: onboardingWorkspace.name,
        slug: onboardingWorkspace.slug,
        organization: pilotOrg.name,
        organizationId: pilotOrg.id,
        id: onboardingWorkspace.id,
      },
      {
        name: financeWorkspace.name,
        slug: financeWorkspace.slug,
        organization: pilotOrg.name,
        organizationId: pilotOrg.id,
        id: financeWorkspace.id,
      },
      {
        name: incidentWorkspace.name,
        slug: incidentWorkspace.slug,
        organization: pilotOrg.name,
        organizationId: pilotOrg.id,
        id: incidentWorkspace.id,
      },
      {
        name: agencyWorkspace.name,
        slug: agencyWorkspace.slug,
        organization: pilotOrg.name,
        organizationId: pilotOrg.id,
        id: agencyWorkspace.id,
      },
    ],
    projects: [
      {
        name: internalProject.name,
        slug: internalProject.slug,
        workspaceId: internalWorkspace.id,
        workspaceName: internalWorkspace.name,
        id: internalProject.id,
      },
      {
        name: pilotProject.name,
        slug: pilotProject.slug,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        id: pilotProject.id,
      },
      {
        name: onboardingProject.name,
        slug: onboardingProject.slug,
        workspaceId: onboardingWorkspace.id,
        workspaceName: onboardingWorkspace.name,
        id: onboardingProject.id,
      },
      {
        name: financeProject.name,
        slug: financeProject.slug,
        workspaceId: financeWorkspace.id,
        workspaceName: financeWorkspace.name,
        id: financeProject.id,
      },
      {
        name: incidentProject.name,
        slug: incidentProject.slug,
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        id: incidentProject.id,
      },
      {
        name: agencyProject.name,
        slug: agencyProject.slug,
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        id: agencyProject.id,
      },
    ],
    environments: [
      {
        name: internalProduction.name,
        slug: internalProduction.slug,
        runtime: internalProduction.runtime,
        workspaceId: internalWorkspace.id,
        projectId: internalProject.id,
        id: internalProduction.id,
      },
      {
        name: pilotStaging.name,
        slug: pilotStaging.slug,
        runtime: pilotStaging.runtime,
        workspaceId: pilotWorkspace.id,
        projectId: pilotProject.id,
        id: pilotStaging.id,
      },
      {
        name: pilotProduction.name,
        slug: pilotProduction.slug,
        runtime: pilotProduction.runtime,
        workspaceId: pilotWorkspace.id,
        projectId: pilotProject.id,
        id: pilotProduction.id,
      },
      {
        name: onboardingSandbox.name,
        slug: onboardingSandbox.slug,
        runtime: onboardingSandbox.runtime,
        workspaceId: onboardingWorkspace.id,
        projectId: onboardingProject.id,
        id: onboardingSandbox.id,
      },
      {
        name: onboardingStaging.name,
        slug: onboardingStaging.slug,
        runtime: onboardingStaging.runtime,
        workspaceId: onboardingWorkspace.id,
        projectId: onboardingProject.id,
        id: onboardingStaging.id,
      },
      {
        name: financeProduction.name,
        slug: financeProduction.slug,
        runtime: financeProduction.runtime,
        workspaceId: financeWorkspace.id,
        projectId: financeProject.id,
        id: financeProduction.id,
      },
      {
        name: incidentProduction.name,
        slug: incidentProduction.slug,
        runtime: incidentProduction.runtime,
        workspaceId: incidentWorkspace.id,
        projectId: incidentProject.id,
        id: incidentProduction.id,
      },
      {
        name: incidentShadow.name,
        slug: incidentShadow.slug,
        runtime: incidentShadow.runtime,
        workspaceId: incidentWorkspace.id,
        projectId: incidentProject.id,
        id: incidentShadow.id,
      },
      {
        name: agencyStaging.name,
        slug: agencyStaging.slug,
        runtime: agencyStaging.runtime,
        workspaceId: agencyWorkspace.id,
        projectId: agencyProject.id,
        id: agencyStaging.id,
      },
      {
        name: agencyProduction.name,
        slug: agencyProduction.slug,
        runtime: agencyProduction.runtime,
        workspaceId: agencyWorkspace.id,
        projectId: agencyProject.id,
        id: agencyProduction.id,
      },
    ],
    members: [
      {
        workspaceId: internalWorkspace.id,
        workspaceName: internalWorkspace.name,
        email: internalMember.email,
        name: internalMember.name,
        role: internalMember.role,
        status: "active",
      },
      {
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        email: pilotMembers[0]?.email ?? "alice@example.com",
        name: pilotMembers[0]?.name ?? "Alice Zhang",
        role: pilotMembers[0]?.role ?? "workspace_admin",
        status: "active",
      },
      {
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        email: pilotMembers[1]?.email ?? "bob@example.com",
        name: pilotMembers[1]?.name ?? "Bob Chen",
        role: pilotMembers[1]?.role ?? "developer",
        status: "active",
      },
      {
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        email: pilotMembers[2]?.email ?? "finance@example.com",
        name: pilotMembers[2]?.name ?? "Finance Analyst",
        role: pilotMembers[2]?.role ?? "developer",
        status: "invited",
      },
      {
        workspaceId: onboardingWorkspace.id,
        workspaceName: onboardingWorkspace.name,
        email: onboardingMembers[0]?.email ?? "starter-admin@example.com",
        name: onboardingMembers[0]?.name ?? "Starter Admin",
        role: onboardingMembers[0]?.role ?? "workspace_admin",
        status: "active",
      },
      {
        workspaceId: onboardingWorkspace.id,
        workspaceName: onboardingWorkspace.name,
        email: onboardingMembers[1]?.email ?? "builder@example.com",
        name: onboardingMembers[1]?.name ?? "Builder",
        role: onboardingMembers[1]?.role ?? "developer",
        status: "active",
      },
      {
        workspaceId: financeWorkspace.id,
        workspaceName: financeWorkspace.name,
        email: financeMembers[0]?.email ?? "controller@example.com",
        name: financeMembers[0]?.name ?? "Controller",
        role: financeMembers[0]?.role ?? "developer",
        status: "active",
      },
      {
        workspaceId: financeWorkspace.id,
        workspaceName: financeWorkspace.name,
        email: financeMembers[1]?.email ?? "governance@example.com",
        name: financeMembers[1]?.name ?? "Governance Lead",
        role: financeMembers[1]?.role ?? "workspace_admin",
        status: "active",
      },
      {
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        email: incidentMembers[0]?.email ?? "incident-admin@example.com",
        name: incidentMembers[0]?.name ?? "Incident Admin",
        role: incidentMembers[0]?.role ?? "workspace_admin",
        status: "active",
      },
      {
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        email: incidentMembers[1]?.email ?? "responder@example.com",
        name: incidentMembers[1]?.name ?? "Primary Responder",
        role: incidentMembers[1]?.role ?? "developer",
        status: "active",
      },
      {
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        email: agencyMembers[0]?.email ?? "agency-admin@example.com",
        name: agencyMembers[0]?.name ?? "Agency Admin",
        role: agencyMembers[0]?.role ?? "workspace_admin",
        status: "active",
      },
      {
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        email: agencyMembers[1]?.email ?? "delivery@example.com",
        name: agencyMembers[1]?.name ?? "Delivery Manager",
        role: agencyMembers[1]?.role ?? "developer",
        status: "active",
      },
      {
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        email: agencyMembers[2]?.email ?? "analyst@example.com",
        name: agencyMembers[2]?.name ?? "Analytics Partner",
        role: agencyMembers[2]?.role ?? "developer",
        status: "active",
      },
    ],
    providerConnections: [
      {
        id: internalProvider.id,
        workspaceId: internalWorkspace.id,
        workspaceName: internalWorkspace.name,
        provider: internalProvider.provider,
        label: internalProvider.label,
      },
      {
        id: pilotProvider.id,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        provider: pilotProvider.provider,
        label: pilotProvider.label,
      },
      {
        id: pilotOpenAiProvider.id,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        provider: pilotOpenAiProvider.provider,
        label: pilotOpenAiProvider.label,
      },
      {
        id: onboardingProvider.id,
        workspaceId: onboardingWorkspace.id,
        workspaceName: onboardingWorkspace.name,
        provider: onboardingProvider.provider,
        label: onboardingProvider.label,
      },
      {
        id: financeProvider.id,
        workspaceId: financeWorkspace.id,
        workspaceName: financeWorkspace.name,
        provider: financeProvider.provider,
        label: financeProvider.label,
      },
      {
        id: incidentAnthropicProvider.id,
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        provider: incidentAnthropicProvider.provider,
        label: incidentAnthropicProvider.label,
      },
      {
        id: incidentOpenAiProvider.id,
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        provider: incidentOpenAiProvider.provider,
        label: incidentOpenAiProvider.label,
      },
      {
        id: agencyProvider.id,
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        provider: agencyProvider.provider,
        label: agencyProvider.label,
      },
    ],
    budgetPolicies: [
      {
        id: internalWorkspaceBudget.id,
        workspaceId: internalWorkspace.id,
        workspaceName: internalWorkspace.name,
        projectId: null,
        environmentId: null,
        environment: null,
        monthlyUsdLimit: internalWorkspaceBudget.monthlyUsdLimit,
        softLimitPercent: internalWorkspaceBudget.softLimitPercent,
        seededCurrentSpendUsd: internalWorkspaceSpendUsd,
        seededState: "healthy",
      },
      {
        id: workspaceBudget.id,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        projectId: null,
        environmentId: null,
        environment: null,
        monthlyUsdLimit: workspaceBudget.monthlyUsdLimit,
        softLimitPercent: workspaceBudget.softLimitPercent,
        seededCurrentSpendUsd: workspaceBudgetCurrentSpendUsd,
        seededState: "soft-limit-warning",
      },
      {
        id: productionBudget.id,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        projectId: pilotProject.id,
        environmentId: pilotProduction.id,
        environment: productionBudget.environment,
        monthlyUsdLimit: productionBudget.monthlyUsdLimit,
        softLimitPercent: productionBudget.softLimitPercent,
        seededCurrentSpendUsd: productionBudgetCurrentSpendUsd,
        seededState: "hard-limit-blocking",
      },
      {
        id: onboardingBudget.id,
        workspaceId: onboardingWorkspace.id,
        workspaceName: onboardingWorkspace.name,
        projectId: null,
        environmentId: null,
        environment: null,
        monthlyUsdLimit: onboardingBudget.monthlyUsdLimit,
        softLimitPercent: onboardingBudget.softLimitPercent,
        seededCurrentSpendUsd: onboardingWorkspaceSpendUsd,
        seededState: "healthy-onboarding",
      },
      {
        id: financeBudget.id,
        workspaceId: financeWorkspace.id,
        workspaceName: financeWorkspace.name,
        projectId: null,
        environmentId: null,
        environment: null,
        monthlyUsdLimit: financeBudget.monthlyUsdLimit,
        softLimitPercent: financeBudget.softLimitPercent,
        seededCurrentSpendUsd: financeWorkspaceSpendUsd,
        seededState: "healthy-audit",
      },
      {
        id: incidentBudget.id,
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        projectId: null,
        environmentId: null,
        environment: null,
        monthlyUsdLimit: incidentBudget.monthlyUsdLimit,
        softLimitPercent: incidentBudget.softLimitPercent,
        seededCurrentSpendUsd: incidentWorkspaceSpendUsd,
        seededState: "provider-degraded",
      },
      {
        id: agencyBudget.id,
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        projectId: null,
        environmentId: null,
        environment: null,
        monthlyUsdLimit: agencyBudget.monthlyUsdLimit,
        softLimitPercent: agencyBudget.softLimitPercent,
        seededCurrentSpendUsd: agencyWorkspaceSpendUsd,
        seededState: "healthy-delivery",
      },
    ],
    alerts: [
      {
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        severity: "warning",
        code: "budget.soft-limit",
        title: "workspace reached 80% of its monthly budget",
      },
      {
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        severity: "critical",
        code: "budget.hard-limit",
        title: "production budget exhausted",
      },
      {
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        severity: "critical",
        code: "provider.health.failed",
        title: "primary escalation route is failing health checks",
      },
    ],
    exportJobs: [
      {
        id: completedUsageExport.id,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        kind: completedUsageExport.kind,
        format: completedUsageExport.format,
        fileName: completedUsageExport.fileName,
        status: "completed",
      },
      {
        id: pendingAuditExport.id,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        kind: pendingAuditExport.kind,
        format: pendingAuditExport.format,
        fileName: pendingAuditExport.fileName,
        status: pendingAuditExport.status,
      },
      {
        id: internalUsageExport.id,
        workspaceId: internalWorkspace.id,
        workspaceName: internalWorkspace.name,
        kind: internalUsageExport.kind,
        format: internalUsageExport.format,
        fileName: internalUsageExport.fileName,
        status: internalUsageExport.status,
      },
      {
        id: financeAuditExport.id,
        workspaceId: financeWorkspace.id,
        workspaceName: financeWorkspace.name,
        kind: financeAuditExport.kind,
        format: financeAuditExport.format,
        fileName: financeAuditExport.fileName,
        status: "completed",
      },
      {
        id: financeUsageExport.id,
        workspaceId: financeWorkspace.id,
        workspaceName: financeWorkspace.name,
        kind: financeUsageExport.kind,
        format: financeUsageExport.format,
        fileName: financeUsageExport.fileName,
        status: "completed",
      },
      {
        id: incidentExport.id,
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        kind: incidentExport.kind,
        format: incidentExport.format,
        fileName: incidentExport.fileName,
        status: incidentExport.status,
      },
      {
        id: agencyUsageExport.id,
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        kind: agencyUsageExport.kind,
        format: agencyUsageExport.format,
        fileName: agencyUsageExport.fileName,
        status: agencyUsageExport.status,
      },
    ],
    virtualKeys: [
      {
        label: internalVirtualKey.record.label,
        token: internalVirtualKey.token,
        workspaceId: internalWorkspace.id,
        workspaceName: internalWorkspace.name,
        projectId: internalProject.id,
        environmentId: internalProduction.id,
        environment: internalVirtualKey.record.environment,
        provider: internalProvider.provider,
        providerConnectionId: internalProvider.id,
      },
      {
        label: stagingKey.record.label,
        token: stagingKey.token,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        projectId: pilotProject.id,
        environmentId: pilotStaging.id,
        environment: stagingKey.record.environment,
        provider: pilotProvider.provider,
        providerConnectionId: pilotProvider.id,
      },
      {
        label: openAiStagingKey.record.label,
        token: openAiStagingKey.token,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        projectId: pilotProject.id,
        environmentId: pilotStaging.id,
        environment: openAiStagingKey.record.environment,
        provider: pilotOpenAiProvider.provider,
        providerConnectionId: pilotOpenAiProvider.id,
      },
      {
        label: productionKey.record.label,
        token: productionKey.token,
        workspaceId: pilotWorkspace.id,
        workspaceName: pilotWorkspace.name,
        projectId: pilotProject.id,
        environmentId: pilotProduction.id,
        environment: productionKey.record.environment,
        provider: pilotProvider.provider,
        providerConnectionId: pilotProvider.id,
      },
      {
        label: onboardingKey.record.label,
        token: onboardingKey.token,
        workspaceId: onboardingWorkspace.id,
        workspaceName: onboardingWorkspace.name,
        projectId: onboardingProject.id,
        environmentId: onboardingSandbox.id,
        environment: onboardingKey.record.environment,
        provider: onboardingProvider.provider,
        providerConnectionId: onboardingProvider.id,
      },
      {
        label: financeKey.record.label,
        token: financeKey.token,
        workspaceId: financeWorkspace.id,
        workspaceName: financeWorkspace.name,
        projectId: financeProject.id,
        environmentId: financeProduction.id,
        environment: financeKey.record.environment,
        provider: financeProvider.provider,
        providerConnectionId: financeProvider.id,
      },
      {
        label: incidentProductionKey.record.label,
        token: incidentProductionKey.token,
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        projectId: incidentProject.id,
        environmentId: incidentProduction.id,
        environment: incidentProductionKey.record.environment,
        provider: incidentOpenAiProvider.provider,
        providerConnectionId: incidentOpenAiProvider.id,
      },
      {
        label: incidentShadowKey.record.label,
        token: incidentShadowKey.token,
        workspaceId: incidentWorkspace.id,
        workspaceName: incidentWorkspace.name,
        projectId: incidentProject.id,
        environmentId: incidentShadow.id,
        environment: incidentShadowKey.record.environment,
        provider: incidentAnthropicProvider.provider,
        providerConnectionId: incidentAnthropicProvider.id,
      },
      {
        label: agencyStagingKey.record.label,
        token: agencyStagingKey.token,
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        projectId: agencyProject.id,
        environmentId: agencyStaging.id,
        environment: agencyStagingKey.record.environment,
        provider: agencyProvider.provider,
        providerConnectionId: agencyProvider.id,
      },
      {
        label: agencyProductionKey.record.label,
        token: agencyProductionKey.token,
        workspaceId: agencyWorkspace.id,
        workspaceName: agencyWorkspace.name,
        projectId: agencyProject.id,
        environmentId: agencyProduction.id,
        environment: agencyProductionKey.record.environment,
        provider: agencyProvider.provider,
        providerConnectionId: agencyProvider.id,
      },
    ],
    notes: [
      "Five pilot sample workspaces are seeded under Customer Operations Group: onboarding, guardrails, audit/export, incident response, and client delivery.",
      "Set DEMO_MODE=1 on the gateway to use synthetic provider responses.",
      "Use CONTROL_API_ADMIN_TOKEN for Control API and server-side web admin requests.",
      "Run `npm run demo:brief` after reseeding if you need a current handoff summary.",
    ],
  };

  await mkdir(demoStateDir, {
    recursive: true,
  });
  await writeFile(demoStatePath, `${JSON.stringify(demoState, null, 2)}\n`, "utf8");

  console.log("Demo seed completed.");
  console.log(`Demo state written to ${demoStatePath}`);
  console.log("Root `npm run demo:seed` also generates `.demo/demo-brief.md` for handoff.");
  console.log(JSON.stringify(demoState, null, 2));
} finally {
  await db.end();
}
