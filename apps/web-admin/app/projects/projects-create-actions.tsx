"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { Project } from "@teamops/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ResourceCreateDialog } from "../components/resource-create-dialog";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { buildClientActionNoticeHref } from "../lib/client-action-notice";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import {
  createEnvironmentMutationAction,
  createProjectMutationAction,
} from "./actions";

type ProjectsCreateActionsProps = {
  workspaceId: string;
  currentPageHref: string;
  locale: AppLocale;
  activeProjects: Array<Pick<Project, "id" | "name">>;
  className?: string;
  showEnvironmentAction?: boolean;
  projectButtonClassName?: string;
  environmentButtonClassName?: string;
};

const selectClassName =
  "flex h-[36px] w-full rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 py-2 text-[13px] text-foreground shadow-none transition-[border-color,box-shadow,background-color,color] outline-none hover:border-[color:var(--border-strong)] focus-visible:border-[color:var(--primary-border-strong)] focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/16 disabled:cursor-not-allowed disabled:opacity-50";

export function ProjectsCreateActions({
  workspaceId,
  currentPageHref,
  locale,
  activeProjects,
  className,
  showEnvironmentAction = true,
  projectButtonClassName,
  environmentButtonClassName,
}: ProjectsCreateActionsProps) {
  const router = useRouter();
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const environmentNameInputRef = useRef<HTMLInputElement>(null);
  const [isProjectOpen, setIsProjectOpen] = useState(false);
  const [isEnvironmentOpen, setIsEnvironmentOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [environmentProjectId, setEnvironmentProjectId] = useState(
    activeProjects[0]?.id ?? "",
  );
  const [environmentName, setEnvironmentName] = useState("");
  const [environmentSlug, setEnvironmentSlug] = useState("");
  const [environmentRuntime, setEnvironmentRuntime] = useState<
    "development" | "staging" | "production"
  >("production");
  const [projectErrorMessage, setProjectErrorMessage] = useState<string | null>(
    null,
  );
  const [environmentErrorMessage, setEnvironmentErrorMessage] = useState<
    string | null
  >(null);
  const [isProjectPending, setIsProjectPending] = useState(false);
  const [isEnvironmentPending, setIsEnvironmentPending] = useState(false);

  const environmentUnavailableMessage = useMemo(
    () =>
      activeProjects.length
        ? null
        : locale === "zh"
          ? "请先创建或重新启用一个项目，然后再添加环境。"
          : "Create or reactivate a project before adding environments.",
    [activeProjects.length, locale],
  );

  useEffect(() => {
    setEnvironmentProjectId(activeProjects[0]?.id ?? "");
  }, [activeProjects]);

  useEffect(() => {
    if (!isProjectOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      projectNameInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isProjectOpen]);

  useEffect(() => {
    if (!isEnvironmentOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      environmentNameInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isEnvironmentOpen]);

  function handleProjectOpenChange(nextOpen: boolean) {
    setIsProjectOpen(nextOpen);
    if (!nextOpen) {
      setProjectErrorMessage(null);
      setIsProjectPending(false);
    }
  }

  function handleEnvironmentOpenChange(nextOpen: boolean) {
    setIsEnvironmentOpen(nextOpen);
    if (!nextOpen) {
      setEnvironmentErrorMessage(null);
      setIsEnvironmentPending(false);
    }
  }

  function handleProjectSubmit(formData: FormData) {
    setIsProjectPending(true);
    setProjectErrorMessage(null);

    startTransition(async () => {
      const result = await createProjectMutationAction({
        workspaceId,
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
      });

      setIsProjectPending(false);

      if (result.status === "error") {
        setProjectErrorMessage(result.message);
        return;
      }

      setIsProjectOpen(false);
      setProjectName("");
      setProjectSlug("");
      router.replace(
        buildClientActionNoticeHref(
          currentPageHref,
          {
            notice: "created",
            message: result.message,
            focusProjectId: result.project.id,
          },
          `project-${result.project.id}`,
        ),
      );
    });
  }

  function handleEnvironmentSubmit(formData: FormData) {
    if (!activeProjects.length) {
      setEnvironmentErrorMessage(environmentUnavailableMessage);
      return;
    }

    setIsEnvironmentPending(true);
    setEnvironmentErrorMessage(null);

    startTransition(async () => {
      const result = await createEnvironmentMutationAction({
        workspaceId,
        projectId: String(formData.get("projectId") ?? ""),
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
        runtime: String(formData.get("runtime") ?? "production") as
          | "development"
          | "staging"
          | "production",
      });

      setIsEnvironmentPending(false);

      if (result.status === "error") {
        setEnvironmentErrorMessage(result.message);
        return;
      }

      setIsEnvironmentOpen(false);
      setEnvironmentName("");
      setEnvironmentSlug("");
      setEnvironmentRuntime("production");
      setEnvironmentProjectId(activeProjects[0]?.id ?? "");
      router.replace(
        buildClientActionNoticeHref(
          currentPageHref,
          {
            notice: "created",
            message: result.message,
            focusEnvironmentId: result.environment.id,
          },
          `environment-${result.environment.id}`,
        ),
      );
    });
  }

  return (
    <>
      <div className={className ?? "flex flex-wrap items-center gap-2"}>
        <Button
          className={projectButtonClassName}
          onClick={() => setIsProjectOpen(true)}
          size="sm"
          type="button"
        >
          {translateInlineText(locale, "Create project")}
        </Button>
        {showEnvironmentAction ? (
          <Button
            className={environmentButtonClassName}
            onClick={() => setIsEnvironmentOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            {translateInlineText(locale, "Create environment")}
          </Button>
        ) : null}
      </div>

      <ResourceCreateDialog
        description={
          locale === "zh"
            ? "在不离开资源页的前提下创建项目结构。"
            : "Create a project without breaking the current inventory flow."
        }
        onOpenChange={handleProjectOpenChange}
        open={isProjectOpen}
        size="sm"
        title={translateInlineText(locale, "Create project")}
      >
        <form action={handleProjectSubmit} className="grid gap-4">
          {projectErrorMessage ? (
            <ResourceInlineNotice
              label={translateInlineText(locale, "Error")}
              message={projectErrorMessage}
              tone="error"
            />
          ) : null}

          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="project-create-name">
                {translateInlineText(locale, "Project name")}
              </label>
              <Input
                id="project-create-name"
                name="name"
                onChange={(event) => setProjectName(event.currentTarget.value)}
                placeholder="customer-support-agent"
                ref={projectNameInputRef}
                required
                value={projectName}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="project-create-slug">
                {translateInlineText(locale, "Slug")}
              </label>
              <Input
                id="project-create-slug"
                name="slug"
                onChange={(event) => setProjectSlug(event.currentTarget.value)}
                placeholder={translateInlineText(locale, "Optional override")}
                value={projectSlug}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/45 pt-4">
            <Button onClick={() => handleProjectOpenChange(false)} type="button" variant="ghost">
              {translateInlineText(locale, "Cancel")}
            </Button>
            <Button disabled={isProjectPending} type="submit">
              {isProjectPending
                ? translateInlineText(locale, "Creating project...")
                : translateInlineText(locale, "Create project")}
            </Button>
          </div>
        </form>
      </ResourceCreateDialog>

      <ResourceCreateDialog
        description={
          locale === "zh"
            ? "把新环境挂到现有项目下，同时保留当前筛选上下文。"
            : "Add an environment under an active project while keeping the current scope in place."
        }
        onOpenChange={handleEnvironmentOpenChange}
        open={isEnvironmentOpen}
        size="md"
        title={translateInlineText(locale, "Create environment")}
      >
        <form action={handleEnvironmentSubmit} className="grid gap-4">
          {environmentErrorMessage ? (
            <ResourceInlineNotice
              label={translateInlineText(locale, "Error")}
              message={environmentErrorMessage}
              tone="error"
            />
          ) : null}

          {environmentUnavailableMessage ? (
            <ResourceInlineNotice
              label={translateInlineText(locale, "Setup")}
              message={environmentUnavailableMessage}
              tone="warning"
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="environment-create-project">
                {translateInlineText(locale, "Project")}
              </label>
              <select
                className={selectClassName}
                disabled={!activeProjects.length}
                id="environment-create-project"
                name="projectId"
                onChange={(event) => setEnvironmentProjectId(event.currentTarget.value)}
                value={environmentProjectId}
              >
                {activeProjects.length ? null : (
                  <option value="">
                    {translateInlineText(locale, "Create project")}
                  </option>
                )}
                {activeProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="environment-create-name">
                {translateInlineText(locale, "Environment name")}
              </label>
              <Input
                id="environment-create-name"
                name="name"
                onChange={(event) => setEnvironmentName(event.currentTarget.value)}
                placeholder={translateInlineText(locale, "production")}
                ref={environmentNameInputRef}
                required
                value={environmentName}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="environment-create-runtime">
                {translateInlineText(locale, "Runtime")}
              </label>
              <select
                className={selectClassName}
                id="environment-create-runtime"
                name="runtime"
                onChange={(event) =>
                  setEnvironmentRuntime(
                    event.currentTarget.value as
                      | "development"
                      | "staging"
                      | "production",
                  )
                }
                value={environmentRuntime}
              >
                <option value="development">{translateInlineText(locale, "development")}</option>
                <option value="staging">{translateInlineText(locale, "staging")}</option>
                <option value="production">{translateInlineText(locale, "production")}</option>
              </select>
            </div>

            <div className="grid gap-2 sm:col-span-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="environment-create-slug">
                {translateInlineText(locale, "Slug")}
              </label>
              <Input
                id="environment-create-slug"
                name="slug"
                onChange={(event) => setEnvironmentSlug(event.currentTarget.value)}
                placeholder={translateInlineText(locale, "Optional override")}
                value={environmentSlug}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/45 pt-4">
            <Button onClick={() => handleEnvironmentOpenChange(false)} type="button" variant="ghost">
              {translateInlineText(locale, "Cancel")}
            </Button>
            <Button disabled={isEnvironmentPending || !activeProjects.length} type="submit">
              {isEnvironmentPending
                ? translateInlineText(locale, "Creating environment...")
                : translateInlineText(locale, "Create environment")}
            </Button>
          </div>
        </form>
      </ResourceCreateDialog>
    </>
  );
}
