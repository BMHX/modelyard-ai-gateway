"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Member, MemberRole } from "@teamops/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { MemberDetailsDrawer } from "./member-details-drawer";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "warning" | "success";
type ReviewTone = "neutral" | "warning" | "critical" | "resolved";

type DrawerStateBadge = {
  label: string;
  variant: BadgeVariant;
  summary: string;
};

type DrawerPriorityState = {
  label: string;
  tone: ReviewTone;
  summary: string;
  nextStep: string;
};

type RosterProject = {
  id: string;
  name: string;
  slug: string;
  href: string;
};

type AllProjectOption = {
  id: string;
  name: string;
  slug: string;
  statusLabel: string;
};

type MemberRosterRow = {
  member: {
    id: string;
    name: string;
    email: string;
    role: MemberRole;
    roles: MemberRole[];
    status: Member["status"];
    updatedAt: string;
  };
  statusLabel: string;
  roleLabel: string;
  accessBoundarySummary: string;
  lifecycleState: DrawerStateBadge;
  lifecycleStateLabel: string;
  temporaryAccessState: DrawerStateBadge;
  effectiveAccessState: DrawerStateBadge;
  activityState: DrawerStateBadge;
  priorityState: DrawerPriorityState;
  priorityStateLabel: string;
  auditHref: string;
  projectScopeHref: string | null;
  createdSummary: string;
  updatedSummary: string;
  lastLoginSummary: string;
  lastActiveSummary: string;
  temporaryAccessInputValue: string;
  assignedProjectIds: string[];
  assignedProjects: RosterProject[];
  usesProjectScope: boolean;
};

type MemberRosterClientProps = {
  rows: MemberRosterRow[];
  allProjects: AllProjectOption[];
  currentPageHref: string;
  drawerCleanupHref: string;
  initialFocusedMemberId: string | null;
  initialNotice: {
    label: string;
    message: string;
    tone: "success" | "error" | "warning";
  } | null;
  projectId: string | null;
  roleOptions: Array<{
    value: MemberRole;
    label: string;
  }>;
  t: {
    member: string;
    roleScope: string;
    access: string;
    activity: string;
    temporaryAccess: string;
    review: string;
    actions: string;
    assignProjects: string;
    editMember: string;
    viewAudit: string;
    audit: string;
  };
  workspaceId: string;
  clearTaskStateOnSuccess: boolean;
  emphasizeProjectScope: boolean;
};

type DrawerNotice = MemberRosterClientProps["initialNotice"];

function getStatusBadgeVariant(status: Member["status"]) {
  if (status === "disabled") {
    return "destructive" as const;
  }
  if (status === "invited") {
    return "warning" as const;
  }
  return "secondary" as const;
}

function getToneBadgeVariant(tone: ReviewTone) {
  if (tone === "critical") {
    return "destructive" as const;
  }
  if (tone === "warning") {
    return "warning" as const;
  }
  if (tone === "resolved") {
    return "success" as const;
  }
  return "secondary" as const;
}

export function MemberRosterClient({
  rows,
  allProjects,
  currentPageHref,
  drawerCleanupHref,
  initialFocusedMemberId,
  initialNotice,
  projectId,
  roleOptions,
  t,
  workspaceId,
  clearTaskStateOnSuccess,
  emphasizeProjectScope,
}: MemberRosterClientProps) {
  const router = useRouter();
  const [activeMemberId, setActiveMemberId] = useState<string | null>(initialFocusedMemberId);
  const consumedDrawerNoticeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setActiveMemberId(initialFocusedMemberId);
  }, [initialFocusedMemberId]);

  const activeRow = useMemo(
    () => rows.find((row) => row.member.id === activeMemberId) ?? null,
    [activeMemberId, rows],
  );

  function openMember(memberId: string) {
    setActiveMemberId(memberId);
  }

  function closeMemberDrawer() {
    setActiveMemberId(null);

    if (initialFocusedMemberId) {
      router.replace(drawerCleanupHref, { scroll: false });
    }
  }

  const drawerNoticeFromRoute =
    activeRow && initialFocusedMemberId === activeRow.member.id ? initialNotice : null;
  const [drawerNotice, setDrawerNotice] = useState<DrawerNotice>(drawerNoticeFromRoute);
  const activeDrawerKey = activeRow
    ? [
        activeRow.member.id,
        activeRow.member.updatedAt,
        activeRow.member.status,
        activeRow.member.roles.join(","),
        activeRow.assignedProjectIds.join(","),
      ].join(":")
    : null;

  useEffect(() => {
    if (drawerNoticeFromRoute) {
      setDrawerNotice(drawerNoticeFromRoute);
      return;
    }

    if (!activeMemberId || initialFocusedMemberId !== activeMemberId) {
      setDrawerNotice(null);
    }
  }, [activeMemberId, drawerNoticeFromRoute, initialFocusedMemberId]);

  useEffect(() => {
    if (!drawerNoticeFromRoute || !activeRow) {
      consumedDrawerNoticeKeyRef.current = null;
      return;
    }

    const noticeKey = [
      activeRow.member.id,
      drawerNoticeFromRoute.tone,
      drawerNoticeFromRoute.label,
      drawerNoticeFromRoute.message,
    ].join(":");

    if (consumedDrawerNoticeKeyRef.current === noticeKey) {
      return;
    }

    consumedDrawerNoticeKeyRef.current = noticeKey;
    router.replace(currentPageHref, { scroll: false });
  }, [currentPageHref, drawerNoticeFromRoute, router, activeRow]);

  const projectOptions = activeRow
    ? allProjects.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        statusLabel: project.statusLabel,
        checked: activeRow.assignedProjectIds.includes(project.id) || projectId === project.id,
        recommended: projectId === project.id,
      }))
    : [];

  return (
    <>
      <div className="divide-y divide-border/55 lg:hidden">
        {rows.map((row) => {
          const primaryActionHref =
            row.priorityState.label === "scope gap" && row.projectScopeHref
              ? row.projectScopeHref
              : null;
          const primaryActionLabel =
            row.priorityState.label === "scope gap" && row.projectScopeHref
              ? t.assignProjects
              : t.editMember;
          const visibleAssignedProjects = row.assignedProjects.slice(0, 2);
          const overflowAssignedProjectCount = Math.max(
            0,
            row.assignedProjects.length - visibleAssignedProjects.length,
          );

          return (
            <div
              className={`space-y-3 px-4 py-4${
                activeMemberId === row.member.id
                  ? " bg-[color:color-mix(in_srgb,var(--surface-selected)_16%,var(--surface-1)_84%)]"
                  : ""
              }`}
              key={row.member.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <button
                    aria-current={activeMemberId === row.member.id ? "page" : undefined}
                    className="font-medium text-foreground transition-colors hover:text-primary"
                    onClick={() => openMember(row.member.id)}
                    type="button"
                  >
                    {row.member.name}
                  </button>
                  <p className="truncate text-[12px] leading-5 text-muted-foreground">
                    {row.member.email}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Badge variant={getStatusBadgeVariant(row.member.status)}>{row.statusLabel}</Badge>
                  <Badge variant={row.lifecycleState.variant}>{row.lifecycleStateLabel}</Badge>
                  <Badge variant={getToneBadgeVariant(row.priorityState.tone)}>
                    {row.priorityStateLabel}
                  </Badge>
                </div>
              </div>

              <div className="grid gap-2 text-[12px] leading-5 text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{row.roleLabel}</span>
                  <Badge variant={row.effectiveAccessState.variant}>
                    {row.effectiveAccessState.label}
                  </Badge>
                  {row.temporaryAccessState.label !== row.effectiveAccessState.label ? (
                    <Badge variant={row.temporaryAccessState.variant}>
                      {row.temporaryAccessState.label}
                    </Badge>
                  ) : null}
                </div>
                <span>{row.accessBoundarySummary}</span>
                {visibleAssignedProjects.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {visibleAssignedProjects.map((project) => (
                      <a
                        className="inline-flex max-w-full items-center truncate rounded-md border border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] px-2 py-0.5 text-[11px] font-medium text-foreground/80 transition-colors hover:border-border hover:text-foreground"
                        href={project.href}
                        key={`member-card-project-${row.member.id}-${project.id}`}
                        title={project.name}
                      >
                        {project.name}
                      </a>
                    ))}
                    {overflowAssignedProjectCount ? (
                      <span className="inline-flex items-center rounded-md border border-dashed border-border/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                        +{overflowAssignedProjectCount}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <span>{row.lastActiveSummary}</span>
                <span>{row.priorityState.summary}</span>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
                {primaryActionHref ? (
                  <Button
                    asChild
                    variant="secondary"
                    size="sm"
                    className="flex-1 bg-muted text-foreground hover:bg-muted/80"
                  >
                    <a href={primaryActionHref}>{primaryActionLabel}</a>
                  </Button>
                ) : (
                  <Button
                    className="flex-1 bg-muted text-foreground hover:bg-muted/80"
                    onClick={() => openMember(row.member.id)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {primaryActionLabel}
                  </Button>
                )}
                <Button asChild variant="ghost" size="sm" className="flex-1">
                  <a href={row.auditHref}>{t.viewAudit}</a>
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden lg:block">
        <Table className="w-full [table-layout:fixed]">
          <TableHeader className="bg-muted/30">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[24%]">{t.member}</TableHead>
              <TableHead className="w-[24%]">{t.access}</TableHead>
              <TableHead className="w-[16%]">{t.activity}</TableHead>
              <TableHead className="w-[20%]">{t.review}</TableHead>
              <TableHead className="w-[120px] text-center">{t.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const primaryActionHref =
                row.priorityState.label === "scope gap" && row.projectScopeHref
                  ? row.projectScopeHref
                  : null;
              const primaryActionLabel =
                row.priorityState.label === "scope gap" && row.projectScopeHref
                  ? t.assignProjects
                  : t.editMember;

              return (
                <TableRow key={row.member.id} className="group align-top hover:bg-muted/5">
                  <TableCell>
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className="font-semibold text-foreground transition-colors hover:text-primary"
                          onClick={() => openMember(row.member.id)}
                          type="button"
                        >
                          {row.member.name}
                        </button>
                      <Badge
                        variant={getStatusBadgeVariant(row.member.status)}
                        className="h-4.5 px-1.5 text-[10px]"
                      >
                        {row.statusLabel}
                      </Badge>
                    </div>
                    <div className="grid gap-0.5">
                      <span className="truncate text-[12px] text-muted-foreground">
                        {row.member.email}
                      </span>
                      <span className="text-[11px] text-muted-foreground/60">
                        {row.createdSummary}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="grid gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground">{row.roleLabel}</span>
                      <Badge
                        variant={row.effectiveAccessState.variant}
                        className="h-4.5 w-fit text-[10px]"
                      >
                        {row.effectiveAccessState.label}
                      </Badge>
                      {row.temporaryAccessState.summary !== row.effectiveAccessState.summary ? (
                        <Badge
                          variant={row.temporaryAccessState.variant}
                          className="h-4.5 w-fit text-[10px]"
                        >
                          {row.temporaryAccessState.label}
                        </Badge>
                      ) : null}
                    </div>
                    <span className="text-[11px] leading-relaxed text-muted-foreground">
                      {row.accessBoundarySummary}
                    </span>
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {row.temporaryAccessState.summary !== row.effectiveAccessState.summary
                        ? row.temporaryAccessState.summary
                        : row.effectiveAccessState.summary}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="grid gap-1.5">
                    <Badge
                      variant={row.activityState.variant}
                      className="h-4.5 w-fit text-[10px]"
                    >
                      {row.activityState.label}
                    </Badge>
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {row.lastActiveSummary}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="grid gap-1.5">
                    <Badge
                      variant={getToneBadgeVariant(row.priorityState.tone)}
                      className="h-4.5 w-fit text-[10px]"
                    >
                      {row.priorityStateLabel}
                    </Badge>
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {row.priorityState.summary}
                    </span>
                    {row.priorityState.summary !== row.accessBoundarySummary ? (
                      <span className="text-[11px] leading-tight text-muted-foreground/80">
                        {row.accessBoundarySummary}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="align-middle text-center">
                  <div className="flex flex-col items-center gap-1.5">
                    {primaryActionHref ? (
                      <Button
                        asChild
                        variant="secondary"
                        size="sm"
                        className="h-7 w-24 bg-muted text-[11px] text-foreground hover:bg-muted/80"
                      >
                        <a href={primaryActionHref}>{primaryActionLabel}</a>
                      </Button>
                    ) : (
                      <Button
                        className="h-7 w-24 bg-muted text-[11px] text-foreground hover:bg-muted/80"
                        onClick={() => openMember(row.member.id)}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        {primaryActionLabel}
                      </Button>
                    )}
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-7 w-24 border-border/60 bg-background text-[11px] text-foreground hover:bg-muted/60"
                    >
                      <a href={row.auditHref}>{t.audit}</a>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>

      {activeRow ? (
        <MemberDetailsDrawer
          auditHref={activeRow.auditHref}
          clearTaskStateOnSuccess={clearTaskStateOnSuccess}
          currentPageHref={currentPageHref}
          emphasizeProjectScope={emphasizeProjectScope}
          key={activeDrawerKey}
          member={{
            id: activeRow.member.id,
            name: activeRow.member.name,
            email: activeRow.member.email,
            roleValues: activeRow.member.roles,
            roleLabel: activeRow.roleLabel,
            statusValue: activeRow.member.status,
            usesProjectScope: activeRow.usesProjectScope,
            accessBoundarySummary: activeRow.accessBoundarySummary,
            createdSummary: activeRow.createdSummary,
            updatedSummary: activeRow.updatedSummary,
            lastLoginSummary: activeRow.lastLoginSummary,
            lastActiveSummary: activeRow.lastActiveSummary,
            temporaryAccessInputValue: activeRow.temporaryAccessInputValue,
            effectiveAccessState: activeRow.effectiveAccessState,
            activityState: activeRow.activityState,
            temporaryAccessState: activeRow.temporaryAccessState,
            lifecycleState: activeRow.lifecycleState,
            priorityState: activeRow.priorityState,
          }}
          notice={drawerNotice}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              closeMemberDrawer();
            }
          }}
          open={Boolean(activeRow)}
          projectOptions={projectOptions}
          roleOptions={roleOptions}
          workspaceId={workspaceId}
        />
      ) : null}
    </>
  );
}
