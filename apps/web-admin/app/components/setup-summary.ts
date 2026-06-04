import { memberUsesProjectAssignments } from "@teamops/contracts";

import { translateInlineText, type AppLocale } from "../lib/i18n";
import { buildContextualHref } from "../lib/navigation";
import {
  listMembers,
  listMemberProjectAssignments,
  listProjects,
  listProviderConnections,
  listVirtualKeys,
  listWorkspaceEnvironments,
} from "../lib/control-api";

export type SetupStepStatus = "done" | "next" | "pending";

export type SetupStep = {
  id: string;
  status: SetupStepStatus;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
};

export type WorkspaceSetupSummary = {
  workspaceId: string;
  mode: "setup" | "ready";
  steps: SetupStep[];
  counts: {
    projectCount: number;
    environmentCount: number;
    activeProviderCount: number;
    readyProviderCount: number;
    activeVirtualKeyCount: number;
    memberCount: number;
    scopedMembersWithoutProjects: number;
  };
  nextStepId: string | null;
};

type SetupSummaryArgs = {
  workspaceId: string;
  locale: AppLocale;
  returnTo?: string | null;
};

const setupStepOrder = [
  "project_environment",
  "provider_connection",
  "virtual_key",
  "members",
  "project_assignment",
  "ready",
];

const setupSummaryLoaderCandidates = [
  "loadWorkspaceSetupSummary",
  "getWorkspaceSetupSummary",
  "loadSetupSummary",
];

function withWorkspaceId(href: string, workspaceId: string) {
  const [base, hash = ""] = href.split("#");
  const separator = base.includes("?") ? "&" : "?";
  const next = `${base}${separator}workspaceId=${encodeURIComponent(workspaceId)}`;
  return hash ? `${next}#${hash}` : next;
}

function computeNextStepId(steps: SetupStep[]) {
  const explicitNext = steps.find((step) => step.status === "next");
  if (explicitNext) return explicitNext.id;
  return steps.find((step) => step.status !== "done")?.id ?? null;
}

function buildChecklistStepStatus(args: {
  done: boolean;
  nextStepId: string | null;
  stepId: string;
}): SetupStepStatus {
  if (args.done) return "done";
  if (args.nextStepId === args.stepId) return "next";
  return "pending";
}

function createStepCopy(locale: AppLocale, text: string) {
  return translateInlineText(locale, text);
}

async function tryLoadSummaryFromControlApi(args: SetupSummaryArgs): Promise<WorkspaceSetupSummary | null> {
  const controlApi = (await import("../lib/control-api")) as Record<string, unknown>;

  for (const key of setupSummaryLoaderCandidates) {
    const loader = controlApi[key];
    if (typeof loader !== "function") continue;

    const candidate = await (loader as (workspaceId: string) => Promise<unknown>)(args.workspaceId);
    if (!candidate || typeof candidate !== "object") continue;

    const raw = candidate as {
      workspaceId?: string;
      mode?: "setup" | "ready";
      nextStepId?: string | null;
      steps?: Array<{
        id?: string;
        status?: string;
        title?: string;
        description?: string;
        primaryHref?: string;
        href?: string;
        ctaLabel?: string;
        primaryLabel?: string;
      }>;
      counts?: WorkspaceSetupSummary["counts"];
    };

    if (!raw.steps || !Array.isArray(raw.steps) || raw.steps.length === 0) continue;

    const steps = raw.steps
      .map((step) => {
        if (!step || typeof step !== "object") return null;
        if (!step.id || !step.status || !step.title || !step.description) return null;
        const hrefCandidate = step.primaryHref ?? step.href;
        if (!hrefCandidate) return null;
        const ctaLabel = createStepCopy(
          args.locale,
          step.ctaLabel ?? step.primaryLabel ?? "Open",
        );
        const normalizedStepId = step.id === "ready_for_handoff" ? "ready" : step.id;
        return {
          id: normalizedStepId,
          status: step.status as SetupStepStatus,
          title: createStepCopy(args.locale, step.title),
          description: createStepCopy(args.locale, step.description),
          href: buildContextualHref(hrefCandidate, args.returnTo),
          ctaLabel,
        } satisfies SetupStep;
      })
      .filter(Boolean) as SetupStep[];

    if (!steps.length) continue;

    const nextStepId = raw.nextStepId ?? computeNextStepId(steps);
    const mode = raw.mode === "ready" ? "ready" : "setup";

    return {
      workspaceId: raw.workspaceId ?? args.workspaceId,
      mode,
      steps,
      counts: raw.counts ?? {
        projectCount: 0,
        environmentCount: 0,
        activeProviderCount: 0,
        readyProviderCount: 0,
        activeVirtualKeyCount: 0,
        memberCount: 0,
        scopedMembersWithoutProjects: 0,
      },
      nextStepId,
    };
  }

  return null;
}

async function buildFallbackSetupSummary(args: SetupSummaryArgs): Promise<WorkspaceSetupSummary> {
  const [
    projects,
    environments,
    providerConnections,
    virtualKeys,
    members,
    memberAssignments,
  ] = await Promise.all([
    listProjects(args.workspaceId),
    listWorkspaceEnvironments(args.workspaceId),
    listProviderConnections(args.workspaceId),
    listVirtualKeys(args.workspaceId, { limit: 1 }),
    listMembers(args.workspaceId),
    listMemberProjectAssignments(args.workspaceId),
  ]);

  const activeProjects = projects.filter((project) => project.status === "active");
  const activeEnvironments = environments.filter((environment) => environment.status === "active");
  const activeProviders = providerConnections.filter((provider) => provider.status === "active");
  const readyProviders = activeProviders.filter((provider) => provider.lastTestStatus === "passed");
  const activeVirtualKeyCount =
    virtualKeys.summary?.active ??
    virtualKeys.items.filter((key) => key.status === "active").length;
  const activeMembers = members.filter((member) => member.status !== "disabled");
  const scopedMembers = activeMembers.filter((member) => memberUsesProjectAssignments(member));
  const assignmentsByMember = new Set(memberAssignments.map((assignment) => assignment.memberId));
  const scopedMembersWithoutProjects = scopedMembers.filter((member) => !assignmentsByMember.has(member.id)).length;

  const counts = {
    projectCount: activeProjects.length,
    environmentCount: activeEnvironments.length,
    activeProviderCount: activeProviders.length,
    readyProviderCount: readyProviders.length,
    activeVirtualKeyCount,
    memberCount: activeMembers.length,
    scopedMembersWithoutProjects,
  } satisfies WorkspaceSetupSummary["counts"];

  const hasProjectEnvironment = counts.projectCount > 0 && counts.environmentCount > 0;
  const hasReadyProvider = counts.activeProviderCount > 0 && counts.readyProviderCount > 0;
  const hasVirtualKey = counts.activeVirtualKeyCount > 0;
  const hasMember = counts.memberCount > 0;
  const hasAssignments = hasMember && counts.scopedMembersWithoutProjects === 0;

  const stepDone = {
    project_environment: hasProjectEnvironment,
    provider_connection: hasReadyProvider,
    virtual_key: hasVirtualKey,
    members: hasMember,
    project_assignment: hasAssignments,
  };

  const nextStepId =
    setupStepOrder.find((stepId) => stepId !== "ready" && !stepDone[stepId as keyof typeof stepDone]) ??
    "ready";

  const isReady = Object.values(stepDone).every(Boolean);

  const projectsHref = buildContextualHref(
    withWorkspaceId("/projects", args.workspaceId),
    args.returnTo,
  );
  const createProjectHref = buildContextualHref(
    withWorkspaceId("/projects#create-project", args.workspaceId),
    args.returnTo,
  );
  const createEnvironmentHref = buildContextualHref(
    withWorkspaceId("/projects#create-environment", args.workspaceId),
    args.returnTo,
  );
  const providersHref = buildContextualHref(
    withWorkspaceId("/providers", args.workspaceId),
    args.returnTo,
  );
  const providersAttentionHref = buildContextualHref(
    withWorkspaceId("/providers?view=attention", args.workspaceId),
    args.returnTo,
  );
  const providerCreateHref = buildContextualHref(
    withWorkspaceId("/providers#provider-create-panel", args.workspaceId),
    args.returnTo,
  );
  const virtualKeysHref = buildContextualHref(
    withWorkspaceId("/virtual-keys", args.workspaceId),
    args.returnTo,
  );
  const virtualKeyIssueHref = buildContextualHref(
    withWorkspaceId("/virtual-keys#virtual-key-issuance", args.workspaceId),
    args.returnTo,
  );
  const membersHref = buildContextualHref(
    withWorkspaceId("/members", args.workspaceId),
    args.returnTo,
  );
  const inviteMemberHref = buildContextualHref(
    withWorkspaceId("/members?section=invites", args.workspaceId),
    args.returnTo,
  );
  const scopeGapsHref = buildContextualHref(
    withWorkspaceId("/members?section=access-reviews&focus=scope_gaps", args.workspaceId),
    args.returnTo,
  );
  const setupHref = buildContextualHref(
    withWorkspaceId("/setup", args.workspaceId),
    args.returnTo,
  );
  const homeHref = buildContextualHref("/", args.returnTo);

  const steps: SetupStep[] = [
    {
      id: "project_environment",
      status: buildChecklistStepStatus({
        done: stepDone.project_environment,
        nextStepId,
        stepId: "project_environment",
      }),
      title: createStepCopy(args.locale, "Project & environment"),
      description: createStepCopy(
        args.locale,
        "Create at least one project and environment to scope access.",
      ),
      href: !counts.projectCount
        ? createProjectHref
        : !counts.environmentCount
          ? createEnvironmentHref
          : projectsHref,
      ctaLabel: !counts.projectCount
        ? createStepCopy(args.locale, "Create project")
        : !counts.environmentCount
          ? createStepCopy(args.locale, "Create environment")
          : createStepCopy(args.locale, "Open projects"),
    },
    {
      id: "provider_connection",
      status: buildChecklistStepStatus({
        done: stepDone.provider_connection,
        nextStepId,
        stepId: "provider_connection",
      }),
      title: createStepCopy(args.locale, "Provider connection"),
      description: createStepCopy(
        args.locale,
        "Connect a provider and run a passing test.",
      ),
      href: !counts.activeProviderCount
        ? providerCreateHref
        : !counts.readyProviderCount
          ? providersAttentionHref
          : providersHref,
      ctaLabel: !counts.activeProviderCount
        ? createStepCopy(args.locale, "Connect provider")
        : !counts.readyProviderCount
          ? createStepCopy(args.locale, "Review tests")
          : createStepCopy(args.locale, "Open providers"),
    },
    {
      id: "virtual_key",
      status: buildChecklistStepStatus({
        done: stepDone.virtual_key,
        nextStepId,
        stepId: "virtual_key",
      }),
      title: createStepCopy(args.locale, "Virtual key"),
      description: createStepCopy(
        args.locale,
        "Issue a virtual key to start routing traffic.",
      ),
      href: !counts.activeVirtualKeyCount ? virtualKeyIssueHref : virtualKeysHref,
      ctaLabel: !counts.activeVirtualKeyCount
        ? createStepCopy(args.locale, "Issue key")
        : createStepCopy(args.locale, "Open keys"),
    },
    {
      id: "members",
      status: buildChecklistStepStatus({
        done: stepDone.members,
        nextStepId,
        stepId: "members",
      }),
      title: createStepCopy(args.locale, "Members"),
      description: createStepCopy(
        args.locale,
        "Invite at least one member to the workspace.",
      ),
      href: !counts.memberCount ? inviteMemberHref : membersHref,
      ctaLabel: !counts.memberCount
        ? createStepCopy(args.locale, "Invite member")
        : createStepCopy(args.locale, "Open members"),
    },
    {
      id: "project_assignment",
      status: buildChecklistStepStatus({
        done: stepDone.project_assignment,
        nextStepId,
        stepId: "project_assignment",
      }),
      title: createStepCopy(args.locale, "Project assignment"),
      description: createStepCopy(
        args.locale,
        "Assign scoped members to project access.",
      ),
      href: counts.scopedMembersWithoutProjects ? scopeGapsHref : membersHref,
      ctaLabel: counts.scopedMembersWithoutProjects
        ? createStepCopy(args.locale, "Assign projects")
        : createStepCopy(args.locale, "Review access"),
    },
    {
      id: "ready",
      status: isReady ? "done" : "pending",
      title: createStepCopy(args.locale, "Ready for handoff"),
      description: createStepCopy(
        args.locale,
        "Confirm the workspace is ready for daily operations.",
      ),
      href: isReady ? homeHref : setupHref,
      ctaLabel: isReady
        ? createStepCopy(args.locale, "Open operations")
        : createStepCopy(args.locale, "Continue setup"),
    },
  ];

  return {
    workspaceId: args.workspaceId,
    mode: isReady ? "ready" : "setup",
    steps,
    counts,
    nextStepId,
  };
}

export async function loadWorkspaceSetupSummary(args: SetupSummaryArgs): Promise<WorkspaceSetupSummary> {
  const fromApi = await tryLoadSummaryFromControlApi(args);
  if (fromApi) return fromApi;
  return buildFallbackSetupSummary(args);
}

export function getSetupProgress(summary: WorkspaceSetupSummary) {
  const steps = summary.steps.filter((step) => step.id !== "ready");
  const doneCount = steps.filter((step) => step.status === "done").length;
  return {
    doneCount,
    totalCount: steps.length,
  };
}

export function getSetupNextStep(summary: WorkspaceSetupSummary) {
  return (
    summary.steps.find((step) => step.status === "next") ??
    summary.steps.find((step) => step.status !== "done") ??
    null
  );
}
