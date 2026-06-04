"use client";

import { startTransition, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { MemberRole } from "@teamops/contracts";

import { EmptyState } from "@/components/shared/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildClientActionNoticeHref } from "../lib/client-action-notice";

import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { assignMemberProjectsMutationAction } from "./actions";

type AssignmentProjectOption = {
  id: string;
  name: string;
  slug: string;
  statusLabel: string;
  checked: boolean;
  recommended: boolean;
};

type DrawerNotice = {
  label: string;
  message: string;
  tone: "success" | "error" | "warning";
};

type MemberAssignmentDrawerProps = {
  triggerLabel: string;
  triggerClassName: string;
  initialOpen?: boolean;
  cleanupHref?: string | null;
  pageHref: string;
  setupHref?: string | null;
  workspaceId: string;
  projectId?: string | null;
  member: {
    id: string;
    name: string;
    email: string;
    roleValue: MemberRole;
    roleValues: MemberRole[];
    roleLabel: string;
    assignedCountLabel: string;
  };
  projects: AssignmentProjectOption[];
  title: string;
  description: string;
  recommendedLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  saveLabel: string;
  savePendingLabel: string;
  cancelLabel: string;
  setupLabel: string;
  notice?: DrawerNotice | null;
  errorLabel: string;
};

export function MemberAssignmentDrawer({
  triggerLabel,
  triggerClassName,
  initialOpen = false,
  cleanupHref,
  pageHref,
  setupHref,
  workspaceId,
  projectId,
  member,
  projects,
  title,
  description,
  recommendedLabel,
  emptyTitle,
  emptyDescription,
  saveLabel,
  savePendingLabel,
  cancelLabel,
  setupLabel,
  notice,
  errorLabel,
}: MemberAssignmentDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [isPending, setIsPending] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(() =>
    projects.filter((project) => project.checked).map((project) => project.id),
  );
  const [localNotice, setLocalNotice] = useState<DrawerNotice | null>(notice ?? null);

  useEffect(() => {
    if (!initialOpen) {
      return;
    }

    setOpen(true);
    setSelectedProjectIds(projects.filter((project) => project.checked).map((project) => project.id));
    setLocalNotice(notice ?? null);
  }, [initialOpen, notice, projects]);

  function resetDialogState(nextNotice: DrawerNotice | null = null) {
    setSelectedProjectIds(projects.filter((project) => project.checked).map((project) => project.id));
    setLocalNotice(nextNotice);
  }

  function handleTriggerClick() {
    resetDialogState();
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setLocalNotice(null);

    if (cleanupHref) {
      router.replace(cleanupHref, { scroll: false });
    }
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (isPending) {
      return;
    }

    if (nextOpen) {
      setOpen(true);
      return;
    }

    closeDialog();
  }

  function handleProjectToggle(projectId: string, checked: boolean) {
    setSelectedProjectIds((currentProjectIds) => {
      if (checked) {
        return currentProjectIds.includes(projectId)
          ? currentProjectIds
          : [...currentProjectIds, projectId];
      }

      return currentProjectIds.filter((currentProjectId) => currentProjectId !== projectId);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setLocalNotice(null);

    startTransition(async () => {
      const result = await assignMemberProjectsMutationAction({
        memberId: member.id,
        role: member.roleValue,
        roles: member.roleValues,
        projectIds: selectedProjectIds,
      });

      setIsPending(false);

      if (result.status === "error" || !result.memberId) {
        setLocalNotice({
          label: errorLabel,
          message: result.message,
          tone: "error",
        });
        return;
      }

      setOpen(false);
      setLocalNotice(null);
      router.replace(
        buildClientActionNoticeHref(
          pageHref,
          {
            notice: "updated",
            message: result.message,
            focusMemberId: result.memberId,
          },
          `member-${result.memberId}`,
        ),
        { scroll: false },
      );
    });
  }

  const hasProjects = projects.length > 0;

  function handleCheckboxChange(projectId: string) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      handleProjectToggle(projectId, event.currentTarget.checked);
    };
  }

  return (
    <>
      <button className={triggerClassName} onClick={handleTriggerClick} type="button">
        {triggerLabel}
      </button>
      <Dialog onOpenChange={handleDialogOpenChange} open={open}>
        <DialogContent className="w-[min(92vw,34rem)] p-0">
          <DialogHeader className="shrink-0 gap-2 border-b border-border/60 px-5 py-5 pr-14 sm:px-6">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="px-5 py-5 sm:px-6">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <input name="workspaceId" type="hidden" value={workspaceId} />
              <input name="memberId" type="hidden" value={member.id} />
              <input name="role" type="hidden" value={member.roleValue} />
              {member.roleValues.map((roleValue) => (
                <input key={roleValue} name="roles" type="hidden" value={roleValue} />
              ))}
              {projectId ? <input name="projectId" type="hidden" value={projectId} /> : null}

              {localNotice ? (
                <ResourceInlineNotice
                  label={localNotice.label}
                  message={localNotice.message}
                  tone={localNotice.tone}
                />
              ) : null}

              <section className="resource-card resource-card--highlight gap-3">
                <div className="resource-card__header">
                  <div>
                    <h3>{member.name}</h3>
                    <p className="meta">{member.email}</p>
                  </div>
                  <div className="badge-row">
                    <span className="tag">{member.roleLabel}</span>
                    <span className="tag">{member.assignedCountLabel}</span>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                {hasProjects ? (
                  <div className="max-h-[min(40vh,18rem)] overflow-y-auto pr-1">
                    <div className="checkbox-grid">
                      {projects.map((project) => (
                        <label key={project.id} className="checkbox-option">
                          <input
                            checked={selectedProjectIds.includes(project.id)}
                            disabled={isPending}
                            onChange={handleCheckboxChange(project.id)}
                            name="projectIds"
                            type="checkbox"
                            value={project.id}
                          />
                          <span className="cell-stack">
                            <strong>{project.name}</strong>
                            <span className="meta">
                              {project.slug} · {project.statusLabel}
                              {project.recommended ? ` · ${recommendedLabel}` : ""}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState compact description={emptyDescription} title={emptyTitle} />
                )}
              </section>

              <div className="button-row border-t border-border/60 pt-4">
                <button
                  className={`button${!hasProjects || isPending ? " button--disabled" : ""}`}
                  disabled={!hasProjects || isPending}
                  type="submit"
                >
                  {isPending ? savePendingLabel : saveLabel}
                </button>
                <button className="button button--ghost" disabled={isPending} onClick={closeDialog} type="button">
                  {cancelLabel}
                </button>
                {setupHref ? (
                  <a
                    aria-disabled={isPending ? "true" : undefined}
                    className={`button button--ghost${isPending ? " button--disabled" : ""}`}
                    href={setupHref}
                    onClick={isPending ? (event) => event.preventDefault() : undefined}
                  >
                    {setupLabel}
                  </a>
                ) : null}
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
