"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { MemberRole } from "@teamops/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ResourceCreateDialog } from "../components/resource-create-dialog";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { buildClientActionNoticeHref } from "../lib/client-action-notice";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import { formatMemberCreateErrorMessage } from "./member-create-error";
import {
  createActiveMemberMutationAction,
  createMemberMutationAction,
} from "./actions";

type MemberCreateActionsProps = {
  workspaceId: string;
  currentPageHref: string;
  locale: AppLocale;
  roleOptions: Array<{
    value: MemberRole;
    label: string;
  }>;
  projectOptions: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
  }>;
};

const selectClassName =
  "flex h-[36px] w-full rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 py-2 text-[13px] text-foreground shadow-none transition-[border-color,box-shadow,background-color,color] outline-none hover:border-[color:var(--border-strong)] focus-visible:border-[color:var(--primary-border-strong)] focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/16 disabled:cursor-not-allowed disabled:opacity-50";

type MemberFormState = {
  name: string;
  email: string;
  role: MemberRole;
  temporaryAccessExpiresAt: string;
  projectIds: string[];
};

const createInitialFormState = (role: MemberRole): MemberFormState => ({
  name: "",
  email: "",
  role,
  temporaryAccessExpiresAt: "",
  projectIds: [],
});

function toggleSelection(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}

export function MemberCreateActions({
  workspaceId,
  currentPageHref,
  locale,
  roleOptions,
  projectOptions,
}: MemberCreateActionsProps) {
  const router = useRouter();
  const inviteNameInputRef = useRef<HTMLInputElement>(null);
  const activeNameInputRef = useRef<HTMLInputElement>(null);
  const defaultRole = roleOptions[0]?.value ?? "developer";
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isActiveOpen, setIsActiveOpen] = useState(false);
  const [inviteState, setInviteState] = useState<MemberFormState>(() =>
    createInitialFormState(defaultRole),
  );
  const [activeState, setActiveState] = useState<MemberFormState>(() =>
    createInitialFormState(defaultRole),
  );
  const [inviteErrorMessage, setInviteErrorMessage] = useState<string | null>(
    null,
  );
  const [activeErrorMessage, setActiveErrorMessage] = useState<string | null>(
    null,
  );
  const [isInvitePending, setIsInvitePending] = useState(false);
  const [isActivePending, setIsActivePending] = useState(false);

  useEffect(() => {
    if (!isInviteOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      inviteNameInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isInviteOpen]);

  useEffect(() => {
    if (!isActiveOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      activeNameInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isActiveOpen]);

  const emptyProjectsMessage = useMemo(
    () =>
      locale === "zh"
        ? "当前没有可分配项目。成员可以先创建，后续再补充范围。"
        : "No projects are available yet. You can still create the member and assign scope later.",
    [locale],
  );

  function closeInviteDialog(nextOpen: boolean) {
    setIsInviteOpen(nextOpen);
    if (!nextOpen) {
      setInviteErrorMessage(null);
      setIsInvitePending(false);
    }
  }

  function closeActiveDialog(nextOpen: boolean) {
    setIsActiveOpen(nextOpen);
    if (!nextOpen) {
      setActiveErrorMessage(null);
      setIsActivePending(false);
    }
  }

  function handleInviteSubmit(formData: FormData) {
    setIsInvitePending(true);
    setInviteErrorMessage(null);

    startTransition(async () => {
      const result = await createMemberMutationAction({
        workspaceId,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        role: String(formData.get("role") ?? defaultRole) as MemberRole,
        temporaryAccessExpiresAt:
          String(formData.get("temporaryAccessExpiresAt") ?? "") || null,
        projectIds: formData
          .getAll("projectIds")
          .flatMap((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean),
      });

      setIsInvitePending(false);

      if (result.status === "error" || !result.member) {
        setInviteErrorMessage(formatMemberCreateErrorMessage(locale, result.message));
        return;
      }

      closeInviteDialog(false);
      setInviteState(createInitialFormState(defaultRole));
      router.replace(
        buildClientActionNoticeHref(
          currentPageHref,
          {
            notice: result.status === "success" ? "created" : "error",
            message: result.message,
            focusMemberId: result.member.id,
          },
          `member-${result.member.id}`,
        ),
      );
    });
  }

  function handleActiveSubmit(formData: FormData) {
    setIsActivePending(true);
    setActiveErrorMessage(null);

    startTransition(async () => {
      const result = await createActiveMemberMutationAction({
        workspaceId,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        role: String(formData.get("role") ?? defaultRole) as MemberRole,
        temporaryAccessExpiresAt:
          String(formData.get("temporaryAccessExpiresAt") ?? "") || null,
        projectIds: formData
          .getAll("projectIds")
          .flatMap((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean),
      });

      setIsActivePending(false);

      if (result.status === "error" || !result.member) {
        setActiveErrorMessage(formatMemberCreateErrorMessage(locale, result.message));
        return;
      }

      closeActiveDialog(false);
      setActiveState(createInitialFormState(defaultRole));
      router.replace(
        buildClientActionNoticeHref(
          currentPageHref,
          {
            notice: result.status === "success" ? "created" : "error",
            message: result.message,
            focusMemberId: result.member.id,
          },
          `member-${result.member.id}`,
        ),
      );
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button className="flex-1 whitespace-nowrap sm:flex-none" onClick={() => setIsInviteOpen(true)} size="sm" type="button">
          {translateInlineText(locale, "Invite member")}
        </Button>
        <Button
          className="flex-1 whitespace-nowrap sm:flex-none"
          onClick={() => setIsActiveOpen(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          {translateInlineText(locale, "Add member manually")}
        </Button>
      </div>

      <ResourceCreateDialog
        description={
          locale === "zh"
            ? "以弹窗方式发出邀请，同时配置角色、临时访问和初始项目范围。"
            : "Invite a member without leaving the resource directory."
        }
        onOpenChange={closeInviteDialog}
        open={isInviteOpen}
        size="md"
        title={translateInlineText(locale, "Invite member")}
      >
        <form action={handleInviteSubmit} className="grid gap-4">
          {inviteErrorMessage ? (
            <ResourceInlineNotice
              label={translateInlineText(locale, "Error")}
              message={inviteErrorMessage}
              tone="error"
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="member-invite-name">
                {translateInlineText(locale, "Name")}
              </label>
              <Input
                id="member-invite-name"
                name="name"
                onChange={(event) =>
                  setInviteState((current) => ({
                    ...current,
                    name: event.currentTarget.value,
                  }))
                }
                placeholder="Alice Zhang"
                ref={inviteNameInputRef}
                required
                value={inviteState.name}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="member-invite-email">
                {translateInlineText(locale, "Email")}
              </label>
              <Input
                id="member-invite-email"
                name="email"
                onChange={(event) =>
                  setInviteState((current) => ({
                    ...current,
                    email: event.currentTarget.value,
                  }))
                }
                placeholder="alice@example.com"
                required
                type="email"
                value={inviteState.email}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="member-invite-role">
                {translateInlineText(locale, "Role")}
              </label>
              <select
                className={selectClassName}
                id="member-invite-role"
                name="role"
                onChange={(event) =>
                  setInviteState((current) => ({
                    ...current,
                    role: event.currentTarget.value as MemberRole,
                  }))
                }
                value={inviteState.role}
              >
                {roleOptions.map((role) => (
                  <option key={`invite-${role.value}`} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <label
                className="text-[11px] font-medium text-foreground"
                htmlFor="member-invite-temporary-access"
              >
                {translateInlineText(locale, "Temporary access ends")}
              </label>
              <Input
                id="member-invite-temporary-access"
                name="temporaryAccessExpiresAt"
                onChange={(event) =>
                  setInviteState((current) => ({
                    ...current,
                    temporaryAccessExpiresAt: event.currentTarget.value,
                  }))
                }
                type="datetime-local"
                value={inviteState.temporaryAccessExpiresAt}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-[11px] font-medium text-foreground">
              {translateInlineText(locale, "Initial project scope")}
            </label>
            {projectOptions.length ? (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,var(--surface-canvas)_5%)] p-2">
                <div className="grid gap-2">
                  {projectOptions.map((project) => (
                    <label
                      key={`invite-project-${project.id}`}
                      className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-[color:color-mix(in_srgb,var(--surface-2)_80%,var(--surface-1)_20%)]"
                    >
                      <input
                        checked={inviteState.projectIds.includes(project.id)}
                        name="projectIds"
                        onChange={() =>
                          setInviteState((current) => ({
                            ...current,
                            projectIds: toggleSelection(current.projectIds, project.id),
                          }))
                        }
                        type="checkbox"
                        value={project.id}
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block text-[13px] font-medium text-foreground">
                          {project.name}
                        </span>
                        <span className="block text-[12px] text-muted-foreground">
                          {project.slug} · {translateInlineText(locale, project.status)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[13px] leading-5 text-muted-foreground">
                {emptyProjectsMessage}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/45 pt-4">
            <Button onClick={() => closeInviteDialog(false)} type="button" variant="ghost">
              {translateInlineText(locale, "Cancel")}
            </Button>
            <Button disabled={isInvitePending} type="submit">
              {isInvitePending
                ? translateInlineText(locale, "Sending invite...")
                : translateInlineText(locale, "Send invite")}
            </Button>
          </div>
        </form>
      </ResourceCreateDialog>

      <ResourceCreateDialog
        description={
          locale === "zh"
            ? "直接创建一个已激活的工作区成员，不打断当前资源浏览上下文。"
            : "Create an active workspace member without leaving the directory."
        }
        onOpenChange={closeActiveDialog}
        open={isActiveOpen}
        size="md"
        title={translateInlineText(locale, "Add member manually")}
      >
        <form action={handleActiveSubmit} className="grid gap-4">
          {activeErrorMessage ? (
            <ResourceInlineNotice
              label={translateInlineText(locale, "Error")}
              message={activeErrorMessage}
              tone="error"
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="member-active-name">
                {translateInlineText(locale, "Name")}
              </label>
              <Input
                id="member-active-name"
                name="name"
                onChange={(event) =>
                  setActiveState((current) => ({
                    ...current,
                    name: event.currentTarget.value,
                  }))
                }
                placeholder="Alice Zhang"
                ref={activeNameInputRef}
                required
                value={activeState.name}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="member-active-email">
                {translateInlineText(locale, "Email")}
              </label>
              <Input
                id="member-active-email"
                name="email"
                onChange={(event) =>
                  setActiveState((current) => ({
                    ...current,
                    email: event.currentTarget.value,
                  }))
                }
                placeholder="alice@example.com"
                required
                type="email"
                value={activeState.email}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="member-active-role">
                {translateInlineText(locale, "Role")}
              </label>
              <select
                className={selectClassName}
                id="member-active-role"
                name="role"
                onChange={(event) =>
                  setActiveState((current) => ({
                    ...current,
                    role: event.currentTarget.value as MemberRole,
                  }))
                }
                value={activeState.role}
              >
                {roleOptions.map((role) => (
                  <option key={`active-${role.value}`} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <label
                className="text-[11px] font-medium text-foreground"
                htmlFor="member-active-temporary-access"
              >
                {translateInlineText(locale, "Temporary access ends")}
              </label>
              <Input
                id="member-active-temporary-access"
                name="temporaryAccessExpiresAt"
                onChange={(event) =>
                  setActiveState((current) => ({
                    ...current,
                    temporaryAccessExpiresAt: event.currentTarget.value,
                  }))
                }
                type="datetime-local"
                value={activeState.temporaryAccessExpiresAt}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-[11px] font-medium text-foreground">
              {translateInlineText(locale, "Initial project scope")}
            </label>
            {projectOptions.length ? (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,var(--surface-canvas)_5%)] p-2">
                <div className="grid gap-2">
                  {projectOptions.map((project) => (
                    <label
                      key={`active-project-${project.id}`}
                      className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-[color:color-mix(in_srgb,var(--surface-2)_80%,var(--surface-1)_20%)]"
                    >
                      <input
                        checked={activeState.projectIds.includes(project.id)}
                        name="projectIds"
                        onChange={() =>
                          setActiveState((current) => ({
                            ...current,
                            projectIds: toggleSelection(current.projectIds, project.id),
                          }))
                        }
                        type="checkbox"
                        value={project.id}
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block text-[13px] font-medium text-foreground">
                          {project.name}
                        </span>
                        <span className="block text-[12px] text-muted-foreground">
                          {project.slug} · {translateInlineText(locale, project.status)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[13px] leading-5 text-muted-foreground">
                {emptyProjectsMessage}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/45 pt-4">
            <Button onClick={() => closeActiveDialog(false)} type="button" variant="ghost">
              {translateInlineText(locale, "Cancel")}
            </Button>
            <Button disabled={isActivePending} type="submit">
              {isActivePending
                ? translateInlineText(locale, "Creating member...")
                : translateInlineText(locale, "Create active member")}
            </Button>
          </div>
        </form>
      </ResourceCreateDialog>
    </>
  );
}
