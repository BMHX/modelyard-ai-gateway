import {
  MemberRoleSchema,
  memberUsesProjectAssignments,
  type Member,
  type MemberRole,
  type Project,
} from "@teamops/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { AppShell } from "../components/app-shell";
import { ConfirmSubmitButton } from "../components/confirm-submit-button";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { ResourceTableSection } from "../components/resource-table-section";
import { loadMembersPageData } from "../lib/control-api";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import enMembersMessages from "../messages/en/members.json";
import zhMembersMessages from "../messages/zh/members.json";
import { getCurrentLocale } from "../lib/i18n-server";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import { bulkDisableMembersFormAction } from "./actions";
import { MemberCreateActions } from "./member-create-actions";
import { formatMemberCreateErrorMessage } from "./member-create-error";
import { MemberRosterClient } from "./member-roster-client";
import {
  buildMembersPageHref,
  stripMembersTaskState,
  type MembersFocusFilter,
  type MembersSection,
  type MembersTaskMode,
  type MembersViewMode,
} from "./routing";

export const dynamic = "force-dynamic";

type MembersPageProps = {
  searchParams?: Promise<{
    focusMemberId?: string;
    workspaceId?: string;
    q?: string;
    status?: string;
    role?: string;
    view?: string;
    section?: string;
    focus?: string;
    task?: string;
    projectId?: string;
    notice?: string;
    message?: string;
    returnTo?: string;
  }>;
};

const workspaceRoles = MemberRoleSchema.options.filter((role) => role !== "organization_owner");
const memberStatusOrder = {
  active: 0,
  invited: 1,
  disabled: 2,
} satisfies Record<Member["status"], number>;
const projectStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Project["status"], number>;
type ReviewTone = "neutral" | "warning" | "critical" | "resolved";
type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "warning" | "success";
type MemberStatusFilter = Member["status"] | "all";
type MemberRowModel = {
  member: Member;
  assignedProjectIds: Set<string>;
  assignedProjects: Project[];
  roleLabel: string;
  accessBoundarySummary: string;
  lifecycleState: ReturnType<typeof getMemberLifecycleState>;
  temporaryAccessState: ReturnType<typeof getTemporaryAccessState>;
  effectiveAccessState: ReturnType<typeof getEffectiveAccessState>;
  activityState: ReturnType<typeof getMemberActivityState>;
  priorityState: ReturnType<typeof getMemberPriorityState>;
  auditHref: string;
  projectScopeHref: string | null;
  createdSummary: string;
  updatedSummary: string;
  lastLoginSummary: string;
  lastActiveSummary: string;
  temporaryAccessInputValue: string;
};

function formatRoleLabel(role: string, locale?: AppLocale) {
  const normalized = role.replace(/_/g, " ");
  if (locale !== "zh") {
    return normalized;
  }

  switch (role) {
    case "workspace_admin":
      return "工作区管理员";
    case "developer":
      return "开发者";
    case "organization_owner":
      return "组织所有者";
    default:
      return normalized;
  }
}

function hasAssignedRoles(member: Pick<Member, "roles">) {
  return member.roles.length > 0;
}

function unwrapMembersMessageTemplate(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const nestedDefault = (value as Record<string, unknown>)[""];
  return unwrapMembersMessageTemplate(nestedDefault);
}

function resolveMembersMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = unwrapMembersMessageTemplate(messages[key]);
  if (exact) return exact;
  const nested = key.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" && part in (current as Record<string, unknown>)
      ? (current as Record<string, unknown>)[part]
      : null, messages);
  return unwrapMembersMessageTemplate(nested);
}

function createMembersTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhMembersMessages : enMembersMessages) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    const template = resolveMembersMessage(messages, key);
    if (!template) return translateInlineText(locale, key);
    return template.replace(/\{(\w+)\}/g, (_, token) => String(values?.[token] ?? `{${token}}`));
  };
}

const memberFilterControlClassName =
  "block h-10 w-full rounded-md border border-[color:color-mix(in_srgb,var(--border-default)_80%,transparent)] bg-background px-3.5 text-sm text-foreground outline-none shadow-none transition-[border-color,box-shadow,background-color,color] hover:border-[color:var(--border-strong)] focus-visible:border-[color:var(--border-strong)] focus-visible:ring-2 focus-visible:ring-ring/12";

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

function createFormatters(locale: AppLocale, tr: ReturnType<typeof createMembersTranslator>) {
  const intlLocale = getIntlLocale(locale);
  const notObservedLabel = tr("Not observed");

  return {
    compareLabels(left: string, right: string) {
      return left.localeCompare(right, intlLocale);
    },
    formatDateTime(value: string | null, emptyLabel = notObservedLabel) {
      if (!value) {
        return emptyLabel;
      }

      return new Intl.DateTimeFormat(intlLocale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    },
  };
}

function getDaysSince(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000)));
}

function formatRelativeAgeLabel(value: string, tr: ReturnType<typeof createMembersTranslator>) {
  const days = getDaysSince(value);
  if (days === null) {
    return tr("activity.unknownAge");
  }

  if (days === 0) {
    return tr("activity.today");
  }

  if (days === 1) {
    return tr("activity.oneDayAgo");
  }

  return tr("activity.daysAgo", { days });
}

function formatDateTimeInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDaysUntil(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.ceil((parsed - Date.now()) / (24 * 60 * 60 * 1000));
}

function isExpiredTimestamp(value: string | null) {
  return value ? Date.parse(value) <= Date.now() : false;
}

function isTemporaryAccessExpiringSoon(value: string | null) {
  const daysUntil = getDaysUntil(value);
  return daysUntil !== null && daysUntil >= 0 && daysUntil <= 7;
}

function getTemporaryAccessState(
  member: Member,
  tr: ReturnType<typeof createMembersTranslator>,
  formatDateTime: (value: string | null, emptyLabel?: string) => string,
) {
  if (!member.temporaryAccessExpiresAt) {
    return {
      label: tr("temporaryAccess.persistent.label"),
      variant: "secondary" as BadgeVariant,
      summary: tr("temporaryAccess.persistent.summary"),
    };
  }

  if (isExpiredTimestamp(member.temporaryAccessExpiresAt)) {
    return {
      label: tr("temporaryAccess.expired.label"),
      variant: "destructive" as BadgeVariant,
      summary: tr("temporaryAccess.expired.summary", {
        age: formatRelativeAgeLabel(member.temporaryAccessExpiresAt, tr),
      }),
    };
  }

  if (isTemporaryAccessExpiringSoon(member.temporaryAccessExpiresAt)) {
    const daysUntil = getDaysUntil(member.temporaryAccessExpiresAt);
    return {
      label: tr("temporaryAccess.expiringSoon.label"),
      variant: "warning" as BadgeVariant,
      summary: tr("temporaryAccess.expiringSoon.summary", {
        days: daysUntil ?? 0,
      }),
    };
  }

    return {
      label: tr("temporaryAccess.temporary.label"),
      variant: "warning" as BadgeVariant,
      summary: tr("temporaryAccess.temporary.summary", {
        time: formatDateTime(member.temporaryAccessExpiresAt, tr("temporaryAccess.scheduledExpiry")),
      }),
    };
}

function getEffectiveAccessState(args: {
  member: Member;
  assignedProjects: Project[];
  tr: ReturnType<typeof createMembersTranslator>;
}) {
  if (args.member.status === "disabled") {
    return {
      label: args.tr("effectiveAccess.disabled.label"),
      variant: "destructive" as BadgeVariant,
      summary: args.tr("effectiveAccess.disabled.summary"),
    };
  }

  if (args.member.status === "invited") {
    return {
      label: args.tr("effectiveAccess.pendingInvite.label"),
      variant: "secondary" as BadgeVariant,
      summary: args.tr("effectiveAccess.pendingInvite.summary"),
    };
  }

  if (isExpiredTimestamp(args.member.temporaryAccessExpiresAt)) {
    return {
      label: args.tr("effectiveAccess.expiredTemporary.label"),
      variant: "destructive" as BadgeVariant,
      summary: args.tr("effectiveAccess.expiredTemporary.summary"),
    };
  }

  if (!hasAssignedRoles(args.member)) {
    return {
      label: args.tr("effectiveAccess.noPermission.label"),
      variant: "outline" as BadgeVariant,
      summary: args.tr("effectiveAccess.noPermission.summary"),
    };
  }

  if (!usesProjectScopeForMember(args.member)) {
    return {
      label: args.tr("effectiveAccess.workspaceWide.label"),
      variant: "secondary" as BadgeVariant,
      summary: args.tr("effectiveAccess.workspaceWide.summary"),
    };
  }

  if (!args.assignedProjects.length) {
    return {
      label: args.tr("effectiveAccess.emptyScope.label"),
      variant: "warning" as BadgeVariant,
      summary: args.tr("effectiveAccess.emptyScope.summary"),
    };
  }

  return {
    label: args.tr("effectiveAccess.scoped.label", { count: args.assignedProjects.length }),
    variant: "success" as BadgeVariant,
    summary: args.tr("effectiveAccess.scoped.summary", { count: args.assignedProjects.length }),
  };
}

function getMemberActivityState(member: Member, tr: ReturnType<typeof createMembersTranslator>) {
  if (!member.lastLoginAt && !member.lastActiveAt) {
    return {
      label: tr("activity.noActivity.label"),
      variant: "secondary" as BadgeVariant,
      summary: tr("activity.noActivity.summary"),
    };
  }

  const anchor = member.lastActiveAt ?? member.lastLoginAt;
  const ageDays = anchor ? getDaysSince(anchor) : null;
  if (ageDays !== null && ageDays <= 7) {
    return {
      label: tr("activity.recent.label"),
      variant: "success" as BadgeVariant,
      summary: tr("activity.recent.summary"),
    };
  }

  if (ageDays !== null && ageDays <= 30) {
    return {
      label: tr("activity.aging.label"),
      variant: "warning" as BadgeVariant,
      summary: tr("activity.aging.summary"),
    };
  }

    return {
      label: tr("activity.dormant.label"),
      variant: "warning" as BadgeVariant,
      summary: tr("activity.dormant.summary"),
    };
  }

function sortProjects(
  projects: Project[],
  compareLabels: (left: string, right: string) => number,
) {
  return [...projects].sort(
    (left, right) =>
      projectStatusOrder[left.status] - projectStatusOrder[right.status] || compareLabels(left.name, right.name),
  );
}

function sortMembers(
  members: Member[],
  compareLabels: (left: string, right: string) => number,
) {
  return [...members].sort(
    (left, right) =>
      memberStatusOrder[left.status] - memberStatusOrder[right.status] || compareLabels(left.name, right.name),
  );
}

function usesProjectScopeForMember(member: Pick<Member, "role" | "roles">) {
  return memberUsesProjectAssignments(member);
}

function describeRoleBoundary(
  member: Pick<Member, "role" | "roles">,
  assignedProjects: Project[],
  tr: ReturnType<typeof createMembersTranslator>,
) {
  if (!hasAssignedRoles(member)) {
    return tr("No permission assigned.");
  }

  if (!usesProjectScopeForMember(member)) {
    return tr("Workspace-wide role.");
  }

  if (!assignedProjects.length) {
    return tr("Project-scoped role with no assignments.");
  }

  return tr("{count} scoped projects.", { count: assignedProjects.length });
}

function getStatusBadgeVariant(status: "active" | "invited" | "disabled") {
  if (status === "disabled") {
    return "destructive" as BadgeVariant;
  }
  if (status === "invited") {
    return "warning" as BadgeVariant;
  }
  return "secondary" as BadgeVariant;
}

function getNoticeTag(
  tr: ReturnType<typeof createMembersTranslator>,
  notice?: string | null,
) {
  if (notice === "created") {
    return {
      label: tr("Created"),
      variant: "success" as BadgeVariant,
    };
  }

  if (notice === "updated") {
    return {
      label: tr("Updated"),
      variant: "success" as BadgeVariant,
    };
  }

  if (notice === "deleted") {
    return {
      label: tr("Deleted"),
      variant: "warning" as BadgeVariant,
    };
  }

  if (notice === "error") {
    return {
      label: tr("Error"),
      variant: "destructive" as BadgeVariant,
    };
  }

  return null;
}

function resolveMembersNoticeMessage(
  tr: ReturnType<typeof createMembersTranslator>,
  locale: AppLocale,
  message?: string | null,
) {
  if (!message) {
    return null;
  }

  return formatMemberCreateErrorMessage(locale, tr(message));
}

function getToneBadgeVariant(tone: ReviewTone) {
  if (tone === "critical") {
    return "destructive" as BadgeVariant;
  }

  if (tone === "warning") {
    return "warning" as BadgeVariant;
  }

  if (tone === "resolved") {
    return "success" as BadgeVariant;
  }

  return "secondary" as BadgeVariant;
}

function getReviewTonePriority(tone: ReviewTone) {
  if (tone === "critical") {
    return 0;
  }

  if (tone === "warning") {
    return 1;
  }

  if (tone === "neutral") {
    return 2;
  }

  return 3;
}

function getMembersSectionLabel(section: MembersSection) {
  switch (section) {
    case "invites":
      return "Invites";
    case "access-reviews":
      return "Access reviews";
    case "offboarding":
      return "Offboarding";
    case "roster":
    default:
      return "Roster";
  }
}

function getMembersPrimaryPanelLabel(section: MembersSection) {
  switch (section) {
    case "invites":
      return "Invite queue";
    case "access-reviews":
      return "Review queue";
    case "offboarding":
      return "Offboarding queue";
    case "roster":
    default:
      return "Member directory";
  }
}

function getFocusFilterLabel(focus: MembersFocusFilter) {
  if (focus === "stale_invites") {
    return "stale invites";
  }

  if (focus === "scope_gaps") {
    return "scope gaps";
  }

  if (focus === "expired_temp") {
    return "expired temporary access";
  }

  if (focus === "expiring_temp") {
    return "expiring temporary access";
  }

  if (focus === "dormant_broad_access") {
    return "dormant broad access";
  }

  if (focus === "broad_access") {
    return "broad access";
  }

  if (focus === "disabled_cleanup") {
    return "disabled cleanup";
  }

  return "all access states";
}

function getMemberPriorityState(args: {
  member: Member;
  assignedProjects: Project[];
  tr: ReturnType<typeof createMembersTranslator>;
}) {
  const { member, assignedProjects, tr } = args;
  const usesProjectScope = usesProjectScopeForMember(member);
  const activityState = getMemberActivityState(member, tr);

  if (member.status === "active" && !hasAssignedRoles(member)) {
    return {
      tone: "warning" as const,
      label: "no permission",
      summary: tr("No role is assigned to this member, so control-plane access is fully blocked."),
      nextStep: tr("Assign at least one role before expecting this member to sign in or receive access."),
    };
  }

  if (member.status === "active" && isExpiredTimestamp(member.temporaryAccessExpiresAt)) {
    return {
      tone: "critical" as const,
      label: "expired access",
      summary: tr("Temporary access already elapsed, but the membership is still marked active."),
      nextStep: tr("nextStepDisableExpiredAccess"),
    };
  }

  if (member.status === "active" && !usesProjectScope && activityState.label === "dormant") {
    return {
      tone: "critical" as const,
      label: "dormant broad access",
      summary: tr("Workspace-wide access is still active even though no recent control-plane activity has been seen."),
      nextStep: tr("nextStepReduceBroadAccess"),
    };
  }

  if (member.status === "active" && usesProjectScope && !assignedProjects.length) {
    return {
      tone: "warning" as const,
      label: "scope gap",
      summary: tr("The member is active, but no assigned projects are attached to this scoped role yet."),
      nextStep: tr("Assign the intended projects or switch the member into a workspace-wide role if that was the real operating model."),
    };
  }

  if (member.status === "invited" && (getDaysSince(member.createdAt) ?? 0) >= 7) {
    return {
      tone: "warning" as const,
      label: "stale invite",
      summary: tr("The invite has been waiting for at least a week and should not stay unattended."),
      nextStep: tr("nextStepResendInvite"),
    };
  }

  if (member.status === "active" && isTemporaryAccessExpiringSoon(member.temporaryAccessExpiresAt)) {
    return {
      tone: "warning" as const,
      label: "renew soon",
      summary: tr("Temporary access is still valid, but the expiry window is now close enough to queue follow-up work."),
      nextStep: tr("nextStepRenewAccessWindow"),
    };
  }

  if (member.status === "active" && !usesProjectScope) {
    return {
      tone: "warning" as const,
      label: "broad access",
      summary: tr("summaryWorkspaceWideRole"),
      nextStep: tr("nextStepReviewWorkspaceWideRole"),
    };
  }

  if (member.status === "disabled") {
    return {
      tone: "resolved" as const,
      label: "disabled",
      summary: tr("The access path is already disabled and only needs cleanup or retention review."),
      nextStep: tr("nextStepKeepMembershipForAudit"),
    };
  }

  if (member.status === "invited") {
    return {
      tone: "neutral" as const,
      label: "awaiting activation",
      summary: tr("summaryInvitePending"),
      nextStep: tr("nextStepLeaveInviteInFlight"),
    };
  }

  return {
    tone: "resolved" as const,
    label: "healthy",
    summary: tr("This membership looks operationally healthy for the current role, scope, and activity profile."),
    nextStep: tr("nextStepNoImmediateAction"),
  };
}

function getMemberLifecycleState(args: {
  member: Member;
  assignedProjects: Project[];
  tr: ReturnType<typeof createMembersTranslator>;
}) {
  const usesProjectScope = usesProjectScopeForMember(args.member);
  const ageLabel = formatRelativeAgeLabel(args.member.createdAt, args.tr);

  if (args.member.status === "invited") {
    const inviteAgeDays = getDaysSince(args.member.createdAt);
    const isStaleInvite = inviteAgeDays !== null && inviteAgeDays >= 7;

    return {
      label: isStaleInvite ? "stale invite" : "pending invite",
      variant: (isStaleInvite ? "warning" : "secondary") as BadgeVariant,
      summary:
        isStaleInvite
          ? `Invite has been pending since ${ageLabel}. Re-send, disable, or confirm the role is still needed.`
          : `Invite was created ${ageLabel}. Keep the initial project scope ready so activation is immediate.`,
    };
  }

  if (args.member.status === "disabled") {
    return {
      label: "offboarding",
      variant: "destructive" as BadgeVariant,
      summary: `Access is disabled. Review project scope and audit history before final removal if offboarding is complete.`,
    };
  }

  if (usesProjectScope && args.assignedProjects.length === 0) {
    return {
      label: "scope gap",
      variant: "warning" as BadgeVariant,
      summary: "Member is active but effectively has no project access yet. Assign at least one project or change the role.",
    };
  }

  if (usesProjectScope) {
    return {
      label: "scoped access",
      variant: "success" as BadgeVariant,
      summary: `Active with ${args.assignedProjects.length} scoped project${args.assignedProjects.length === 1 ? "" : "s"}. Last role review should happen before the next project change.`,
    };
  }

  return {
    label: "workspace-wide",
    variant: "secondary" as BadgeVariant,
    summary: `Active with workspace-wide permissions. Review broad access periodically as the workspace grows.`,
  };
}

function getMembersSectionBasePath(section: MembersSection) {
  if (section === "access-reviews") {
    return "/members/reviews";
  }

  if (section === "offboarding") {
    return "/members/offboarding";
  }

  return "/members";
}

export default async function MembersPage({
  searchParams,
}: MembersPageProps) {
  const locale = await getCurrentLocale();
  const tr = createMembersTranslator(locale);
  const { compareLabels, formatDateTime } = createFormatters(locale, tr);
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = getSafeReturnTo(resolvedSearchParams.returnTo);
  const query = resolvedSearchParams.q?.trim() ?? "";
  const section: MembersSection =
    resolvedSearchParams.section === "invites" ||
    resolvedSearchParams.section === "invite" ||
    resolvedSearchParams.section === "access-reviews" ||
    resolvedSearchParams.section === "review" ||
    resolvedSearchParams.section === "offboarding"
      ? resolvedSearchParams.section === "invite"
        ? "invites"
        : resolvedSearchParams.section === "review"
          ? "access-reviews"
          : (resolvedSearchParams.section as MembersSection)
      : resolvedSearchParams.view === "offboarding"
        ? "offboarding"
        : "roster";
  const viewMode: MembersViewMode =
    section === "offboarding" ? "offboarding" : "roster";
  const rawStatusFilter: MemberStatusFilter | null =
    resolvedSearchParams.status === "active" || resolvedSearchParams.status === "invited" || resolvedSearchParams.status === "disabled"
      ? resolvedSearchParams.status
      : null;
  const roleCandidate = resolvedSearchParams.role;
  const roleFilter =
    roleCandidate && workspaceRoles.some((role) => role === roleCandidate)
      ? (roleCandidate as (typeof workspaceRoles)[number])
      : "all";
  const focusCandidate = resolvedSearchParams.focus;
  const rawFocusFilter: MembersFocusFilter | null =
    focusCandidate === "stale_invites" ||
    focusCandidate === "scope_gaps" ||
    focusCandidate === "expired_temp" ||
    focusCandidate === "expiring_temp" ||
    focusCandidate === "dormant_broad_access" ||
    focusCandidate === "broad_access" ||
    focusCandidate === "disabled_cleanup"
      ? focusCandidate
      : null;
  const pageData = await loadMembersPageData(resolvedSearchParams.workspaceId);
  const selectedWorkspace =
    pageData.selectedWorkspaceId
      ? pageData.workspaceOptions.find((workspace) => workspace.id === pageData.selectedWorkspaceId) ?? null
      : null;
  const noticeTag = getNoticeTag(tr, resolvedSearchParams.notice);
  const requestedFocusMemberId = resolvedSearchParams.focusMemberId?.trim() ?? null;
  const requestedTaskMode: MembersTaskMode =
    resolvedSearchParams.task === "assign-projects" ? "assign-projects" : null;
  const taskProjectId = resolvedSearchParams.projectId?.trim() || null;
  const assignedProjectIdsByMember = new Map<string, Set<string>>();
  const sortedProjects = sortProjects(pageData.projects, compareLabels);
  const sortedMembers = sortMembers(pageData.members, compareLabels);
  const pendingInviteCount = sortedMembers.filter((member) => member.status === "invited").length;
  const focusedMember = requestedFocusMemberId
    ? sortedMembers.find((member) => member.id === requestedFocusMemberId) ?? null
    : null;
  const focusedMemberId = focusedMember?.id ?? null;
  const taskMode: MembersTaskMode =
    requestedTaskMode === "assign-projects" && focusedMember && usesProjectScopeForMember(focusedMember)
      ? "assign-projects"
      : null;

  for (const assignment of pageData.memberProjectAssignments) {
    const assignedProjectIds = assignedProjectIdsByMember.get(assignment.memberId) ?? new Set<string>();
    assignedProjectIds.add(assignment.projectId);
    assignedProjectIdsByMember.set(assignment.memberId, assignedProjectIds);
  }

  const staleInviteMembers = sortedMembers.filter((member) => member.status === "invited" && (getDaysSince(member.createdAt) ?? 0) >= 7);
  const scopedMembersWithoutProjects = sortedMembers.filter((member) => {
    if (!usesProjectScopeForMember(member) || member.status !== "active") {
      return false;
    }

    return (assignedProjectIdsByMember.get(member.id) ?? new Set<string>()).size === 0;
  });
  const workspaceWideMembers = sortedMembers.filter((member) => member.status === "active" && !usesProjectScopeForMember(member));
  const disabledCleanupCandidates = sortedMembers.filter((member) => member.status === "disabled");
  const expiredTemporaryAccessMembers = sortedMembers.filter(
    (member) => member.status === "active" && isExpiredTimestamp(member.temporaryAccessExpiresAt),
  );
  const expiringTemporaryAccessMembers = sortedMembers.filter(
    (member) => member.status === "active" && isTemporaryAccessExpiringSoon(member.temporaryAccessExpiresAt),
  );
  const dormantWorkspaceWideMembers = workspaceWideMembers.filter((member) => {
    const activityState = getMemberActivityState(member, tr);
    return activityState.label === "dormant";
  });
  const reviewNowCount =
    staleInviteMembers.length +
    scopedMembersWithoutProjects.length +
    expiringTemporaryAccessMembers.length +
    expiredTemporaryAccessMembers.length +
    dormantWorkspaceWideMembers.length;
  const primaryGovernanceAction =
    expiredTemporaryAccessMembers.length
      ? {
          tone: "critical" as const,
          title: tr("Resolve expired temporary access"),
          description: tr(
            "{count} active memberships already passed the temporary access window and should be renewed or disabled before the next shift change.",
            { count: expiredTemporaryAccessMembers.length },
          ),
          href: buildMembersPageHref({
            workspaceId: pageData.selectedWorkspaceId,
            status: "active",
            role: roleFilter,
            view: "roster",
            section: "access-reviews",
            focus: "expired_temp",
            returnTo,
          }),
          ctaLabel: tr("Review expired grants"),
        }
      : dormantWorkspaceWideMembers.length
        ? {
            tone: "critical" as const,
            title: tr("Review dormant broad access"),
            description: tr(
              "{count} workspace-wide memberships still grant broad control-plane access without recent activity.",
              { count: dormantWorkspaceWideMembers.length },
            ),
            href: buildMembersPageHref({
              workspaceId: pageData.selectedWorkspaceId,
              status: "active",
              role: roleFilter,
              view: "roster",
              section: "access-reviews",
              focus: "dormant_broad_access",
              returnTo,
            }),
            ctaLabel: tr("Open offboarding review"),
          }
        : scopedMembersWithoutProjects.length
          ? {
              tone: "warning" as const,
              title: tr("Close scoped role gaps"),
              description: tr(
                "{count} active scoped memberships have no assigned projects, so the access model is configured but not actually usable.",
                { count: scopedMembersWithoutProjects.length },
              ),
              href: buildMembersPageHref({
                workspaceId: pageData.selectedWorkspaceId,
                status: "active",
                role: roleFilter,
                view: "roster",
                section: "access-reviews",
                focus: "scope_gaps",
                returnTo,
              }),
              ctaLabel: tr("Fix project scope"),
            }
          : staleInviteMembers.length
            ? {
                tone: "warning" as const,
                title: tr("Clean up pending invites"),
                description: tr(
                  "{count} invites have been sitting for at least a week and should be confirmed, re-sent, or disabled.",
                  { count: staleInviteMembers.length },
                ),
                href: buildMembersPageHref({
                  workspaceId: pageData.selectedWorkspaceId,
                  status: "invited",
                  role: roleFilter,
                  view: "roster",
                  section: "access-reviews",
                  focus: "stale_invites",
                  returnTo,
                }),
                ctaLabel: tr("Open invite queue"),
              }
            : expiringTemporaryAccessMembers.length
              ? {
                  tone: "warning" as const,
                  title: tr("Renew temporary access before it lapses"),
                  description: tr(
                    "{count} temporary grants will expire soon enough to queue action now instead of waiting for an interruption.",
                    { count: expiringTemporaryAccessMembers.length },
                  ),
                  href: buildMembersPageHref({
                    workspaceId: pageData.selectedWorkspaceId,
                    status: "active",
                    role: roleFilter,
                    view: "roster",
                    section: "access-reviews",
                    focus: "expiring_temp",
                    returnTo,
                  }),
                  ctaLabel: tr("Review temporary grants"),
                }
              : workspaceWideMembers.length
                ? {
                    tone: "neutral" as const,
                    title: tr("Run a broad access review"),
                    description: tr(
                      "{count} active memberships still operate with workspace-wide permissions.",
                      { count: workspaceWideMembers.length },
                    ),
                    href: buildMembersPageHref({
                      workspaceId: pageData.selectedWorkspaceId,
                      role: roleFilter,
                      view: "roster",
                      section: "access-reviews",
                      focus: "broad_access",
                      returnTo,
                    }),
              ctaLabel: tr("Review broad roles"),
        }
                : null;
  const reviewSectionStatus =
    expiredTemporaryAccessMembers.length ||
    dormantWorkspaceWideMembers.length ||
    scopedMembersWithoutProjects.length ||
    expiringTemporaryAccessMembers.length
      ? "active"
      : staleInviteMembers.length
        ? "invited"
        : "all";
  const reviewSectionFocus: MembersFocusFilter =
    expiredTemporaryAccessMembers.length
      ? "expired_temp"
      : dormantWorkspaceWideMembers.length
        ? "dormant_broad_access"
        : scopedMembersWithoutProjects.length
          ? "scope_gaps"
          : staleInviteMembers.length
            ? "stale_invites"
            : expiringTemporaryAccessMembers.length
              ? "expiring_temp"
              : "all";
  const offboardingDefaultFocus: MembersFocusFilter =
    disabledCleanupCandidates.length ? "disabled_cleanup" : dormantWorkspaceWideMembers.length ? "dormant_broad_access" : "all";
  const offboardingDefaultStatus: MemberStatusFilter =
    disabledCleanupCandidates.length ? "disabled" : dormantWorkspaceWideMembers.length ? "active" : "all";
  const statusFilter: MemberStatusFilter =
    rawStatusFilter ??
    (section === "invites"
      ? "invited"
      : section === "access-reviews"
        ? reviewSectionStatus
        : section === "offboarding"
          ? offboardingDefaultStatus
          : "all");
  const focusFilter: MembersFocusFilter =
    rawFocusFilter ??
    (section === "access-reviews"
      ? reviewSectionFocus
      : section === "offboarding"
        ? offboardingDefaultFocus
        : "all");
  const filteredMembers = sortedMembers.filter((member) => {
    if (statusFilter !== "all" && member.status !== statusFilter) {
      return false;
    }
    if (roleFilter !== "all" && member.role !== roleFilter) {
      return false;
    }

    const assignedProjectIds = assignedProjectIdsByMember.get(member.id) ?? new Set<string>();
    const assignedProjects = sortedProjects.filter((project) => assignedProjectIds.has(project.id));
    const usesProjectScope = usesProjectScopeForMember(member);
    const activityState = getMemberActivityState(member, tr);

    if (focusFilter === "stale_invites" && !(member.status === "invited" && (getDaysSince(member.createdAt) ?? 0) >= 7)) {
      return false;
    }

    if (focusFilter === "scope_gaps" && !(member.status === "active" && usesProjectScope && assignedProjects.length === 0)) {
      return false;
    }

    if (focusFilter === "expired_temp" && !(member.status === "active" && isExpiredTimestamp(member.temporaryAccessExpiresAt))) {
      return false;
    }

    if (focusFilter === "expiring_temp" && !(member.status === "active" && isTemporaryAccessExpiringSoon(member.temporaryAccessExpiresAt))) {
      return false;
    }

    if (
      focusFilter === "dormant_broad_access" &&
      !(member.status === "active" && !usesProjectScope && activityState.label === "dormant")
    ) {
      return false;
    }

    if (focusFilter === "broad_access" && !(member.status === "active" && !usesProjectScope)) {
      return false;
    }

    if (focusFilter === "disabled_cleanup" && member.status !== "disabled") {
      return false;
    }

    if (!query) {
      return true;
    }

    const assignedProjectNames = sortedProjects.filter((project) => assignedProjectIds.has(project.id)).map((project) => project.name);
    const searchIndex = [
      member.name,
      member.email,
      member.role,
      member.status,
      member.lastLoginAt ?? "",
      member.lastActiveAt ?? "",
      member.temporaryAccessExpiresAt ?? "",
      ...assignedProjectNames,
    ]
      .join(" ")
      .toLowerCase();
    return searchIndex.includes(query.toLowerCase());
  });
  const sectionMembers =
    section === "access-reviews"
      ? [...filteredMembers].sort((left, right) => {
          const leftAssignedProjectIds = assignedProjectIdsByMember.get(left.id) ?? new Set<string>();
          const rightAssignedProjectIds = assignedProjectIdsByMember.get(right.id) ?? new Set<string>();
          const leftAssignedProjects = sortedProjects.filter((project) => leftAssignedProjectIds.has(project.id));
          const rightAssignedProjects = sortedProjects.filter((project) => rightAssignedProjectIds.has(project.id));
          const leftPriority = getReviewTonePriority(
            getMemberPriorityState({
              member: left,
              assignedProjects: leftAssignedProjects,
              tr,
            }).tone,
          );
          const rightPriority = getReviewTonePriority(
            getMemberPriorityState({
              member: right,
              assignedProjects: rightAssignedProjects,
              tr,
            }).tone,
          );

          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
          }

          return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
        })
      : section === "invites"
        ? [...filteredMembers].sort((left, right) => {
            if (left.status !== right.status) {
              return memberStatusOrder[left.status] - memberStatusOrder[right.status];
            }

            return Date.parse(left.createdAt) - Date.parse(right.createdAt);
          })
        : filteredMembers;
  const currentPageHref = buildMembersPageHref({
    workspaceId: pageData.selectedWorkspaceId,
    q: query || null,
    status: statusFilter,
    role: roleFilter,
    view: viewMode,
    section,
    focus: focusFilter,
    focusMemberId: focusedMemberId,
    task: taskMode,
    projectId: taskProjectId,
    returnTo,
  });
  const listPageHref = buildMembersPageHref({
    workspaceId: pageData.selectedWorkspaceId,
    q: query || null,
    status: statusFilter,
    role: roleFilter,
    view: viewMode,
    section,
    focus: focusFilter,
    projectId: taskProjectId,
    returnTo,
  });
  const rosterHref = buildMembersPageHref({
    workspaceId: pageData.selectedWorkspaceId,
    section: "roster",
    returnTo,
  });
  const drawerCleanupHref = stripMembersTaskState(currentPageHref) ?? listPageHref;
  const buildProjectFilterHref = (projectName: string) =>
    buildMembersPageHref({
      workspaceId: pageData.selectedWorkspaceId,
      q: projectName,
      status: statusFilter,
      role: roleFilter,
      view: viewMode,
      section,
      focus: focusFilter,
      returnTo,
    });
  const visibleInvitedMembers = filteredMembers.filter((member) => member.status === "invited").length;
  const actionableFilteredMembers = filteredMembers.filter((member) => member.status !== "disabled");
  
  const memberRowModels: MemberRowModel[] = sectionMembers.map((member) => {
    const assignedProjectIds = assignedProjectIdsByMember.get(member.id) ?? new Set<string>();
    const assignedProjects = sortedProjects.filter((project) => assignedProjectIds.has(project.id));
    const lifecycleState = getMemberLifecycleState({
      member,
      assignedProjects,
      tr,
    });
    const temporaryAccessState = getTemporaryAccessState(member, tr, formatDateTime);
    const effectiveAccessState = getEffectiveAccessState({
      member,
      assignedProjects,
      tr,
    });
    const activityState = getMemberActivityState(member, tr);
    const priorityState = getMemberPriorityState({
      member,
      assignedProjects,
      tr,
    });

    return {
      member,
      assignedProjectIds,
      assignedProjects,
      roleLabel: hasAssignedRoles(member)
        ? formatRoleLabel(member.roles[0] ?? member.role, locale)
        : tr("No role assigned"),
      accessBoundarySummary: describeRoleBoundary(member, assignedProjects, tr),
      lifecycleState,
      temporaryAccessState,
      effectiveAccessState,
      activityState,
      priorityState,
      auditHref: buildContextualHref(
        `/audit-logs?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId ?? "")}&subjectType=member&subjectId=${encodeURIComponent(member.id)}`,
        currentPageHref,
      ),
      projectScopeHref: usesProjectScopeForMember(member)
        ? buildMembersPageHref({
            workspaceId: pageData.selectedWorkspaceId,
            q: query || null,
            status: statusFilter,
            role: roleFilter,
            view: viewMode,
            section,
            focus: focusFilter,
            focusMemberId: member.id,
            task: "assign-projects",
            projectId: taskProjectId,
            returnTo,
          })
        : null,
      createdSummary: tr("memberMeta.created", { age: formatRelativeAgeLabel(member.createdAt, tr) }),
      updatedSummary: tr("memberMeta.updated", { age: formatRelativeAgeLabel(member.updatedAt, tr) }),
      lastLoginSummary: `${tr("Last login")} · ${formatDateTime(member.lastLoginAt)}`,
      lastActiveSummary: `${tr("Last active")} · ${formatDateTime(member.lastActiveAt)}`,
      temporaryAccessInputValue: formatDateTimeInputValue(member.temporaryAccessExpiresAt),
    };
  });
  const focusedRowModel =
    focusedMemberId ? memberRowModels.find((row) => row.member.id === focusedMemberId) ?? null : null;
  const drawerNotice =
    focusedRowModel && noticeTag && resolvedSearchParams.message
      ? {
          label: noticeTag.label,
          message: resolveMembersNoticeMessage(tr, locale, resolvedSearchParams.message) ?? "",
          tone:
            resolvedSearchParams.notice === "error"
              ? ("error" as const)
              : resolvedSearchParams.notice === "deleted"
                ? ("warning" as const)
                : ("success" as const),
        }
      : null;
  const primaryPanelLabel = getMembersPrimaryPanelLabel(section);
  const primaryPanelSummary =
    section === "invites"
      ? staleInviteMembers.length
        ? tr("{pending} pending · {stale} stale", {
            pending: visibleInvitedMembers,
            stale: staleInviteMembers.length,
          })
        : tr("{pending} pending", { pending: visibleInvitedMembers })
      : section === "access-reviews"
        ? tr("{count} need review", { count: reviewNowCount })
        : section === "offboarding"
          ? tr("{count} selectable memberships", { count: actionableFilteredMembers.length })
          : tr("{count} visible", { count: filteredMembers.length });
  const membersBasePath = getMembersSectionBasePath(section);
  return (
    <AppShell
      headerMode="compact"
      sidebarVariant="minimal"
      showOperatorContextCards={false}
      showSupportPanels={false}
      title={tr("Members")}
      subtitle=""
      workspaceId={pageData.selectedWorkspaceId}
      workspaceLabel={selectedWorkspace ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}` : null}
    >
      <section className="space-y-6">
        {pageData.workspaceOptions.length ? (
          <>
            <ResourceTableSection>
              <form
                action={membersBasePath}
                method="get"
                className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end"
              >
                <input name="workspaceId" type="hidden" value={pageData.selectedWorkspaceId ?? ""} />
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-foreground/80">{tr("Search")}</label>
                  <Input defaultValue={query} name="q" placeholder={tr("Name, email, role, project")} type="search" />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-foreground/80">{tr("Status")}</label>
                  <select
                    className={memberFilterControlClassName}
                    id="member-status-filter"
                    name="status"
                    defaultValue={statusFilter}
                  >
                    <option value="all">{tr("all")}</option>
                    <option value="active">{tr("active")}</option>
                    <option value="invited">{tr("invited")}</option>
                    <option value="disabled">{tr("disabled")}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-foreground/80">{tr("Role")}</label>
                  <select
                    className={memberFilterControlClassName}
                    id="member-role-filter"
                    name="role"
                    defaultValue={roleFilter}
                  >
                    <option value="all">{tr("all")}</option>
                    {workspaceRoles.map((role) => (
                      <option key={`filter-${role}`} value={role}>
                        {formatRoleLabel(role, locale)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-start gap-3 self-end xl:justify-end">
                  {pageData.selectedWorkspaceId ? (
                    <MemberCreateActions
                      currentPageHref={currentPageHref}
                      locale={locale}
                      projectOptions={sortedProjects.filter((project) => project.status === "active").map((project) => ({
                        id: project.id,
                        name: project.name,
                        slug: project.slug,
                        status: project.status,
                      }))}
                      roleOptions={workspaceRoles.map((role) => ({
                        value: role,
                        label: formatRoleLabel(role, locale),
                      }))}
                      workspaceId={pageData.selectedWorkspaceId}
                    />
                  ) : null}
                  <Button size="sm" type="submit" className="rounded-full whitespace-nowrap">
                    {tr("Apply Filters")}
                  </Button>
                  <a
                    href={buildMembersPageHref({
                      workspaceId: pageData.selectedWorkspaceId,
                      section,
                      returnTo,
                    })}
                    className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {tr("Reset")}
                  </a>
                </div>
              </form>
            </ResourceTableSection>
          </>
        ) : null}

        {pageData.selectedWorkspaceId ? (
          <>
            {/* Summary replaced by Dashboard */}

            {noticeTag && resolvedSearchParams.message && !focusedRowModel ? (
              <div className="col-span-full">
                <ResourceInlineNotice
                  label={noticeTag.label}
                  message={resolveMembersNoticeMessage(tr, locale, resolvedSearchParams.message) ?? ""}
                  tone={
                    resolvedSearchParams.notice === "error"
                      ? "error"
                      : resolvedSearchParams.notice === "deleted"
                        ? "warning"
                        : "success"
                  }
                />
              </div>
            ) : null}

            {section === "offboarding" ? (
              <div className="col-span-full" id="member-primary-view">
                <ResourceTableSection
                  actions={<Badge variant="secondary">{reviewNowCount} {tr("review now")}</Badge>}
                  meta={primaryPanelSummary}
                  title={tr(primaryPanelLabel)}
                >
                  <form className="legacy-resource-selection-scope" action={bulkDisableMembersFormAction}>
                    <input name="workspaceId" type="hidden" value={pageData.selectedWorkspaceId ?? ""} />
                    <input name="redirectPath" type="hidden" value={currentPageHref} />
                    <div className="button-row resource-table-selection-bar border-b border-border/60 px-4 py-3">
                      <ConfirmSubmitButton
                        className={`button button--danger${actionableFilteredMembers.length ? "" : " button--disabled"}`}
                        confirmDescription={tr("This will disable every selected active membership in one step.")}
                        confirmLabel={tr("Disable selected members")}
                        confirmTitle={tr("Disable {count} selected members?", {
                          count: actionableFilteredMembers.length,
                        })}
                        disabled={!actionableFilteredMembers.length}
                        formAction={bulkDisableMembersFormAction}
                        pendingLabel={tr("Disabling...")}
                      >
                        {tr("Disable selected members")}
                      </ConfirmSubmitButton>
                      <Button asChild variant="outline" size="sm">
                                  <a href={rosterHref}>
                        {tr("Open roster")}
                      </a>
                                </Button>
                    </div>
                    {filteredMembers.length ? (
                      <div className="w-full overflow-x-auto">
                        <Table className="w-full [table-layout:fixed]">
                          <TableHeader className="bg-muted/30">
                            <TableRow>
                              <TableHead className="w-[80px]">{tr("Select")}</TableHead>
                              <TableHead className="w-[200px]">{tr("Member")}</TableHead>
                              <TableHead className="w-[140px]">{tr("Last login")}</TableHead>
                              <TableHead className="w-[140px]">{tr("Last active")}</TableHead>
                              <TableHead className="w-[160px]">{tr("Temporary access")}</TableHead>
                              <TableHead className="w-[160px]">{tr("Effective access")}</TableHead>
                              <TableHead className="w-[200px]">{tr("Impact")}</TableHead>
                              <TableHead className="w-[100px]">{tr("Status")}</TableHead>
                              <TableHead className="w-[120px] text-right">{tr("Actions")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredMembers.map((member) => {
                              const assignedProjectIds = assignedProjectIdsByMember.get(member.id) ?? new Set<string>();
                              const assignedProjects = sortedProjects.filter((project) => assignedProjectIds.has(project.id));
                              const temporaryAccessState = getTemporaryAccessState(member, tr, formatDateTime);
                              const effectiveAccessState = getEffectiveAccessState({
                                member,
                                assignedProjects,
                                tr,
                              });

                              return (
                                <TableRow key={`offboarding-${member.id}`}>
                                  <TableCell>
                                    {member.status !== "disabled" ? <input name="memberIds" type="checkbox" value={member.id} className="h-4 w-4 rounded border-border" /> : null}
                                  </TableCell>
                                  <TableCell>
                                    <div className="grid gap-1">
                                      <strong className="text-foreground">{member.name}</strong>
                                      <span className="text-[11px] text-muted-foreground truncate">{member.email}</span>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                          {hasAssignedRoles(member)
                                            ? formatRoleLabel(member.roles[0] ?? member.role, locale)
                                            : tr("No role assigned")}
                                        </Badge>
                                          {usesProjectScopeForMember(member) ? (
                                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                            {assignedProjects.length} {tr("scoped")}
                                          </Badge>
                                        ) : (
                                          <Badge variant="warning" className="text-[10px] px-1.5 py-0 h-4">{tr("workspace-wide")}</Badge>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-[12px]">{formatDateTime(member.lastLoginAt)}</TableCell>
                                  <TableCell className="text-[12px]">{formatDateTime(member.lastActiveAt)}</TableCell>
                                  <TableCell>
                                    <div className="grid gap-1">
                                      <Badge variant={temporaryAccessState.variant} className="w-fit">{temporaryAccessState.label}</Badge>
                                      <span className="text-[11px] text-muted-foreground leading-tight">{temporaryAccessState.summary}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="grid gap-1">
                                      <Badge variant={effectiveAccessState.variant} className="w-fit">{effectiveAccessState.label}</Badge>
                                      <span className="text-[11px] text-muted-foreground leading-tight">{effectiveAccessState.summary}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="grid gap-1">
                                      <span className="text-[12px]">{describeRoleBoundary(member, assignedProjects, tr)}</span>
                                      {assignedProjects.length ? (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {assignedProjects.map((project) => (
                                            <a
                                              key={`offboarding-project-${member.id}-${project.id}`}
                                              className="text-[10px] text-primary hover:underline"
                                              href={buildMembersPageHref({
                                                workspaceId: pageData.selectedWorkspaceId,
                                                q: project.name,
                                                status: statusFilter,
                                                role: roleFilter,
                                                view: viewMode,
                                                section,
                                                focus: focusFilter,
                                                returnTo,
                                              })}
                                            >
                                              {project.name}
                                            </a>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={getStatusBadgeVariant(member.status)}>{tr(member.status)}</Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button asChild variant="ghost" size="sm">
                                      <a href={buildContextualHref(
                                        `/audit-logs?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId ?? "")}&subjectType=member&subjectId=${encodeURIComponent(member.id)}`,
                                        currentPageHref,
                                      )}>
                                        {tr("Audit")}
                                      </a>
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="px-4 py-10">
                        <EmptyState
                          compact
                          description={
                            sortedMembers.length
                              ? focusFilter !== "all"
                                ? tr("Try another queue or clear filters. Nothing in {focus} needs attention right now.", {
                                    focus: tr(getFocusFilterLabel(focusFilter)),
                                  })
                                : tr("Try a broader filter set. No member currently matches the offboarding view.")
                              : tr("Invite the first member to start reviewing access, role scope, and handoff risk.")
                          }
                          title={
                            sortedMembers.length
                              ? focusFilter !== "all"
                                ? tr("Queue is clear")
                                : tr("No matching member")
                              : tr("No members yet")
                          }
                        />
                      </div>
                    )}
                  </form>
                </ResourceTableSection>
              </div>
            ) : (
              <div className="col-span-full" id="members-roster">
                <ResourceTableSection
                  actions={
                    <Badge variant="secondary">
                      {roleFilter === "all" ? tr("all roles") : formatRoleLabel(roleFilter, locale)}
                    </Badge>
                  }
                  meta={primaryPanelSummary}
                  title={tr(primaryPanelLabel)}
                >
                  {memberRowModels.length ? (
                    <>
                      <MemberRosterClient
                        allProjects={sortedProjects.filter((project) => project.status === "active").map((project) => ({
                          id: project.id,
                          name: project.name,
                          slug: project.slug,
                          statusLabel: tr(project.status),
                        }))}
                        clearTaskStateOnSuccess={taskMode === "assign-projects"}
                        currentPageHref={currentPageHref}
                        drawerCleanupHref={drawerCleanupHref}
                        emphasizeProjectScope={
                          taskMode === "assign-projects" && focusedRowModel
                            ? usesProjectScopeForMember(focusedRowModel.member)
                            : false
                        }
                        initialFocusedMemberId={focusedMemberId}
                        initialNotice={drawerNotice}
                        projectId={taskProjectId}
                        roleOptions={workspaceRoles.map((role) => ({
                          value: role,
                          label: formatRoleLabel(role, locale),
                        }))}
                        rows={memberRowModels.map((row) => ({
                          member: {
                            id: row.member.id,
                            name: row.member.name,
                            email: row.member.email,
                            role: row.member.role,
                            roles: row.member.roles,
                            status: row.member.status,
                            updatedAt: row.member.updatedAt,
                          },
                          statusLabel: tr(row.member.status),
                          roleLabel: row.roleLabel,
                          accessBoundarySummary: row.accessBoundarySummary,
                          lifecycleState: row.lifecycleState,
                          lifecycleStateLabel: tr(row.lifecycleState.label),
                          temporaryAccessState: row.temporaryAccessState,
                          effectiveAccessState: row.effectiveAccessState,
                          activityState: row.activityState,
                          priorityState: row.priorityState,
                          priorityStateLabel: tr(row.priorityState.label),
                          auditHref: row.auditHref,
                          projectScopeHref: row.projectScopeHref,
                          createdSummary: row.createdSummary,
                          updatedSummary: row.updatedSummary,
                          lastLoginSummary: row.lastLoginSummary,
                          lastActiveSummary: row.lastActiveSummary,
                          temporaryAccessInputValue: row.temporaryAccessInputValue,
                          assignedProjectIds: Array.from(row.assignedProjectIds),
                          assignedProjects: row.assignedProjects.map((project) => ({
                            id: project.id,
                            name: project.name,
                            slug: project.slug,
                            href: buildProjectFilterHref(project.name),
                          })),
                          usesProjectScope: usesProjectScopeForMember(row.member),
                        }))}
                        t={{
                          member: tr("Member"),
                          roleScope: tr("Role scope"),
                          access: tr("Access"),
                          activity: tr("Activity"),
                          temporaryAccess: tr("Temporary access"),
                          review: tr("Review"),
                          actions: tr("Actions"),
                          assignProjects: tr("Assign projects"),
                          editMember: tr("Edit member"),
                          viewAudit: tr("View audit"),
                          audit: tr("Audit"),
                        }}
                        workspaceId={pageData.selectedWorkspaceId}
                      />

                      {section === "access-reviews" && primaryGovernanceAction ? (
                        <div className="border-t border-border/60 px-4 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Next review")}</span>
                            <Button asChild variant="ghost" size="sm">
                              <a href={primaryGovernanceAction.href}>
                                {primaryGovernanceAction.ctaLabel}
                              </a>
                            </Button>
                          </div>
                          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{primaryGovernanceAction.description}</p>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="px-4 py-10">
                      <EmptyState
                        compact
                        description={
                          sortedMembers.length
                            ? focusFilter !== "all"
                              ? tr("Try another queue or clear filters. Nothing in {focus} is visible now.", {
                                  focus: tr(getFocusFilterLabel(focusFilter)),
                                })
                              : section === "invites"
                                ? tr("Try another filter set. No invite currently matches this queue.")
                                : section === "access-reviews"
                                  ? tr("Try another review queue or clear filters. Nothing currently matches this review view.")
                                  : tr("Try a broader filter set. No member currently matches the roster filters.")
                            : section === "invites"
                              ? tr("Send the first invite to start provisioning operator access.")
                              : tr("Invite the first member to start reviewing access and role fit.")
                        }
                        title={
                          sortedMembers.length
                            ? focusFilter !== "all"
                              ? tr("Queue is clear")
                              : section === "invites"
                                ? tr("No matching invite")
                                : section === "access-reviews"
                                  ? tr("No matching review item")
                                  : tr("No matching member")
                            : section === "invites"
                              ? tr("No invites yet")
                              : tr("No members yet")
                        }
                      />
                    </div>
                  )}
                </ResourceTableSection>

                <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-muted-foreground/60 border-t border-border/20 pt-4 px-1">
                  <span className="font-bold uppercase tracking-widest text-[10px] text-muted-foreground/40">{tr("Related")}</span>
                  <a
                    className="hover:text-primary transition-colors font-medium"
                    href={buildContextualHref(
                      `/projects?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId)}`,
                      currentPageHref,
                    )}
                  >
                    {tr("Projects")}
                  </a>
                  <a
                    className="hover:text-primary transition-colors font-medium"
                    href={buildContextualHref(
                      `/audit-logs?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId)}&subjectType=member`,
                      currentPageHref,
                    )}
                  >
                    {tr("Audit logs")}
                  </a>
                  <a
                    className="hover:text-primary transition-colors font-medium"
                    href={buildContextualHref(
                      `/exports?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId)}&kind=audit-logs`,
                      currentPageHref,
                    )}
                  >
                    {tr("Exports")}
                  </a>
                </div>
              </div>
            )}

          </>
        ) : (
          <article className="col-span-full border rounded-xl p-8 bg-muted/5">
            <EmptyState
              description={
                locale === "zh"
                  ? "请先在页头选择全局工作区，再查看成员名册。"
                  : "Choose the active workspace from the header before viewing the member roster."
              }
              title={tr("No workspace selected")}
            />
          </article>
        )}
      </section>
    </AppShell>
  );
}
