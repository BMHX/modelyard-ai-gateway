"use client";

import { useEffect, useMemo, useState } from "react";
import { memberUsesProjectAssignments, type Member, type MemberRole } from "@teamops/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ConfirmSubmitButton } from "../components/confirm-submit-button";
import { PendingSubmitButton } from "../components/pending-submit-button";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { useT } from "../lib/i18n-client";
import { deleteMemberAction, updateMemberAction } from "./actions";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "warning" | "success";

type DrawerStateBadge = {
  label: string;
  variant: BadgeVariant;
  summary: string;
};

type DrawerPriorityState = {
  label: string;
  tone: "neutral" | "warning" | "critical" | "resolved";
  summary: string;
  nextStep: string;
};

type DrawerProjectOption = {
  id: string;
  name: string;
  slug: string;
  statusLabel: string;
  checked: boolean;
  recommended: boolean;
};

type MemberDetailsDrawerProps = {
  auditHref: string;
  currentPageHref: string;
  workspaceId: string;
  clearTaskStateOnSuccess?: boolean;
  emphasizeProjectScope?: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  open: boolean;
  notice?: {
    label: string;
    message: string;
    tone: "success" | "error" | "warning";
  } | null;
  member: {
    id: string;
    name: string;
    email: string;
    roleValues: MemberRole[];
    roleLabel: string;
    statusValue: Member["status"];
    usesProjectScope: boolean;
    accessBoundarySummary: string;
    createdSummary: string;
    updatedSummary: string;
    lastLoginSummary: string;
    lastActiveSummary: string;
    temporaryAccessInputValue: string;
    effectiveAccessState: DrawerStateBadge;
    activityState: DrawerStateBadge;
    temporaryAccessState: DrawerStateBadge;
    lifecycleState: DrawerStateBadge;
    priorityState: DrawerPriorityState;
  };
  projectOptions: DrawerProjectOption[];
  roleOptions: Array<{
    value: MemberRole;
    label: string;
  }>;
};

function getToneBadgeVariant(tone: DrawerPriorityState["tone"]) {
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

export function MemberDetailsDrawer({
  auditHref,
  currentPageHref,
  workspaceId,
  clearTaskStateOnSuccess = false,
  emphasizeProjectScope = false,
  notice,
  onOpenChange,
  open,
  member,
  projectOptions,
  roleOptions,
}: MemberDetailsDrawerProps) {
  const t = useT("members");
  const [name, setName] = useState(member.name);
  const [status, setStatus] = useState<Member["status"]>(member.statusValue);
  const [temporaryAccessExpiresAt, setTemporaryAccessExpiresAt] = useState(
    member.temporaryAccessInputValue,
  );
  const [selectedRoles, setSelectedRoles] = useState<MemberRole[]>(member.roleValues);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(
    projectOptions.filter((project) => project.checked).map((project) => project.id),
  );

  useEffect(() => {
    setName(member.name);
    setStatus(member.statusValue);
    setTemporaryAccessExpiresAt(member.temporaryAccessInputValue);
    setSelectedRoles(member.roleValues);
  }, [
    member.name,
    member.roleValues,
    member.statusValue,
    member.temporaryAccessInputValue,
  ]);

  useEffect(() => {
    setSelectedProjectIds(
      projectOptions.filter((project) => project.checked).map((project) => project.id),
    );
  }, [projectOptions]);

  const usesProjectScope = useMemo(
    () =>
      selectedRoles.length > 0
        ? memberUsesProjectAssignments({
            role: selectedRoles[0] ?? "developer",
            roles: selectedRoles,
          })
        : false,
    [selectedRoles],
  );

  function toggleRole(role: MemberRole, checked: boolean) {
    setSelectedRoles((current) => {
      if (checked) {
        return current.includes(role) ? current : [...current, role];
      }

      return current.filter((value) => value !== role);
    });
  }

  function toggleProject(projectId: string, checked: boolean) {
    setSelectedProjectIds((current) => {
      if (checked) {
        return current.includes(projectId) ? current : [...current, projectId];
      }

      return current.filter((value) => value !== projectId);
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-full max-h-screen flex-col overflow-hidden"
        side="right"
      >
        <DialogHeader className="shrink-0 border-b border-border/55 px-6 py-5 pr-14">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle>{member.name}</DialogTitle>
              <DialogDescription className="break-all">{member.email}</DialogDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{member.roleLabel}</Badge>
              <Badge variant={member.effectiveAccessState.variant}>
                {member.effectiveAccessState.label}
              </Badge>
              <Badge variant={getToneBadgeVariant(member.priorityState.tone)}>
                {t(member.priorityState.label)}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <form action={updateMemberAction} className="flex min-h-0 flex-1 flex-col">
          <input name="workspaceId" type="hidden" value={workspaceId} />
          <input name="memberId" type="hidden" value={member.id} />
          <input name="redirectPath" type="hidden" value={currentPageHref} />
          {clearTaskStateOnSuccess ? (
            <input name="clearTaskStateOnSuccess" type="hidden" value="true" />
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-6">
              {notice ? (
                <ResourceInlineNotice
                  label={notice.label}
                  message={notice.message}
                  tone={notice.tone}
                />
              ) : null}

              {emphasizeProjectScope ? (
                <ResourceInlineNotice
                  label={t("Project scope")}
                  message={t("Select project access for this member before continuing.")}
                  tone="warning"
                />
              ) : null}

              <section className="space-y-3 rounded-xl border border-border/60 bg-muted/10 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={member.lifecycleState.variant}>
                    {t(member.lifecycleState.label)}
                  </Badge>
                  <Badge variant={member.activityState.variant}>
                    {member.activityState.label}
                  </Badge>
                  <Badge variant={member.temporaryAccessState.variant}>
                    {member.temporaryAccessState.label}
                  </Badge>
                </div>
                <p className="text-sm leading-6 text-foreground">
                  {member.priorityState.summary}
                </p>
                <p className="text-[12px] leading-5 text-muted-foreground">
                  {member.priorityState.nextStep}
                </p>
              </section>

              <section className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="field">
                    <label htmlFor="member-drawer-name">{t("Name")}</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      id="member-drawer-name"
                      name="name"
                      onChange={(event) => setName(event.currentTarget.value)}
                      required
                      value={name}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="member-drawer-status">{t("Status")}</label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      id="member-drawer-status"
                      name="status"
                      onChange={(event) => setStatus(event.currentTarget.value as Member["status"])}
                      value={status}
                    >
                      <option value="active">{t("active")}</option>
                      <option value="invited">{t("invited")}</option>
                      <option value="disabled">{t("disabled")}</option>
                    </select>
                  </div>

                  <div className="field md:col-span-2">
                    <label htmlFor="member-drawer-temporary-access">
                      {t("Temporary access ends")}
                    </label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      id="member-drawer-temporary-access"
                      name="temporaryAccessExpiresAt"
                      onChange={(event) => setTemporaryAccessExpiresAt(event.currentTarget.value)}
                      type="datetime-local"
                      value={temporaryAccessExpiresAt}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
                    {t("Roles")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {roleOptions.map((role) => (
                      <label
                        className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/5 px-3 py-2.5 transition-colors hover:bg-muted/10 cursor-pointer"
                        key={role.value}
                      >
                        <input
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                          checked={selectedRoles.includes(role.value)}
                          name="roles"
                          onChange={(event) => toggleRole(role.value, event.currentTarget.checked)}
                          type="checkbox"
                          value={role.value}
                        />
                        <span className="text-sm font-medium">{role.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-3 border-t border-border/55 pt-5">
                <div className="space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
                    {t("Access boundary")}
                  </p>
                  <p className="text-sm leading-6 text-foreground font-medium">
                    {member.accessBoundarySummary}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-[11px] leading-relaxed text-muted-foreground">
                  <div className="bg-muted/5 rounded p-2">
                    <span className="block opacity-60 uppercase tracking-tighter mb-0.5">{t("Created")}</span>
                    {member.createdSummary}
                  </div>
                  <div className="bg-muted/5 rounded p-2">
                    <span className="block opacity-60 uppercase tracking-tighter mb-0.5">{t("Updated")}</span>
                    {member.updatedSummary}
                  </div>
                  <div className="bg-muted/5 rounded p-2">
                    <span className="block opacity-60 uppercase tracking-tighter mb-0.5">{t("Login")}</span>
                    {member.lastLoginSummary}
                  </div>
                  <div className="bg-muted/5 rounded p-2">
                    <span className="block opacity-60 uppercase tracking-tighter mb-0.5">{t("Activity")}</span>
                    {member.lastActiveSummary}
                  </div>
                </div>
              </section>

              <section
                className={`space-y-4 border-t border-border/55 pt-5${emphasizeProjectScope ? " rounded-lg bg-warning/5 border border-warning/20 px-4 pb-4 pt-4" : ""}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
                    {t("Project scope")}
                  </p>
                  {member.usesProjectScope ? (
                    <Badge variant="outline" className="h-4.5 text-[10px] font-normal">
                      {member.accessBoundarySummary}
                    </Badge>
                  ) : null}
                </div>

                {projectOptions.length ? (
                  usesProjectScope ? (
                    <div className="grid gap-2">
                      {projectOptions.map((project) => (
                        <label
                          className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/5 px-3 py-2.5 transition-colors hover:bg-muted/10 cursor-pointer"
                          key={project.id}
                        >
                          <input
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            checked={selectedProjectIds.includes(project.id)}
                            name="projectIds"
                            onChange={(event) => toggleProject(project.id, event.currentTarget.checked)}
                            type="checkbox"
                            value={project.id}
                          />
                          <div className="grid gap-0.5 min-w-0">
                            <strong className="text-sm">{project.name}</strong>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {project.slug} · {project.statusLabel}
                              {project.recommended
                                ? ` · ${t("recommended")}`
                                : ""}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/60 bg-muted/5 px-3 py-3">
                      <p className="text-sm text-foreground">{t("Project scope isn't used for this role")}</p>
                      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                        {t("This workspace-wide role doesn't use project assignments.")}
                      </p>
                    </div>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">{t("No projects available.")}</p>
                )}
              </section>
            </div>
          </div>

          <div className="shrink-0 border-t border-border/55 bg-muted/5 px-6 py-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onOpenChange(false)} type="button" variant="ghost" size="sm">
                {t("Cancel")}
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href={auditHref}>
                  {t("View audit")}
                </a>
              </Button>
              <div className="flex-1" />
              <ConfirmSubmitButton
                className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 border border-transparent hover:border-destructive/20"
                confirmDescription={t(
                  "This will remove the member from the workspace and end access through this console.",
                )}
                confirmLabel={t("Remove member")}
                confirmTitle={t("Remove {name}?", { name: member.name })}
                formAction={deleteMemberAction}
                formNoValidate
                pendingLabel={t("Removing...")}
              >
                {t("Remove member")}
              </ConfirmSubmitButton>
              <PendingSubmitButton
                variant="default"
                size="sm"
                className="h-9 px-4"
                formAction={updateMemberAction}
                pendingLabel={
                  emphasizeProjectScope
                    ? t("Saving project access...")
                    : t("Saving changes...")
                }
              >
                {emphasizeProjectScope ? t("Save project access") : t("Save changes")}
              </PendingSubmitButton>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
