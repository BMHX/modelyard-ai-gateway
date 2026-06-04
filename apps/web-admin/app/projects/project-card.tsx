"use client";
import { FolderKanban, ChevronDown, Blocks } from "lucide-react";
import { motion } from "framer-motion";
import type { Project, Environment } from "@teamops/contracts";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { PendingSubmitButton } from "../components/pending-submit-button";
import { ConfirmSubmitButton } from "../components/confirm-submit-button";
import { buildContextualHref } from "../lib/navigation";
import { archiveProjectAction, updateProjectAction } from "./actions";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import enProjectsMessages from "../messages/en/projects.json";
import zhProjectsMessages from "../messages/zh/projects.json";
import { EnvironmentCard } from "./environment-card";
function resolveProjectMessage(
  messages: Record<string, unknown>,
  key: string,
): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  const nested = key
    .split(".")
    .reduce<unknown>(
      (current, part) =>
        current &&
        typeof current === "object" &&
        part in (current as Record<string, unknown>)
          ? (current as Record<string, unknown>)[part]
          : null,
      messages,
    );
  return typeof nested === "string" ? nested : null;
}
function createProjectsTranslator(locale: AppLocale) {
  const messages = (
    locale === "zh" ? zhProjectsMessages : enProjectsMessages
  ) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    const template = resolveProjectMessage(messages, key);
    if (!template) return translateInlineText(locale, key);
    return template.replace(/\{(\w+)\}/g, (_, token) =>
      String(values?.[token] ?? `{${token}}`),
    );
  };
}
function getStatusTagClass(status: "active" | "archived") {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border";
  return status === "archived"
    ? `${base} bg-red-950/30 text-red-400 border-red-900/50`
    : `${base} bg-muted text-muted-foreground border-border`;
}
const primaryActionButtonClassName =
  "border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-selected)_72%,var(--surface-1)_28%)] text-foreground shadow-none hover:border-[color:var(--primary-border-strong)] hover:bg-[color:color-mix(in_srgb,var(--surface-selected)_82%,var(--surface-1)_18%)]";
const secondaryActionButtonClassName =
  "border-[color:color-mix(in_srgb,var(--border-default)_76%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] text-[color:var(--text-2)] shadow-none hover:border-[color:var(--border-strong)] hover:bg-[color:color-mix(in_srgb,var(--surface-2)_72%,var(--surface-1)_28%)] hover:text-foreground";
type ProjectCardProps = {
  project: Project;
  linkedEnvironments: Environment[];
  allProjects: Project[];
  workspaceId: string | null;
  currentPageHref: string;
  focusedProjectId: string | null;
  focusedEnvironmentId: string | null;
  noticeTag: { label: string; className: string } | null;
  noticeMessage?: string;
  noticeTone?: "success" | "warning" | "error";
  locale: AppLocale;
  canManageResources?: boolean;
  style?: React.CSSProperties;
};
export function ProjectCard({
  project,
  linkedEnvironments,
  allProjects,
  workspaceId,
  currentPageHref,
  focusedProjectId,
  focusedEnvironmentId,
  noticeTag,
  noticeMessage,
  noticeTone,
  locale,
  canManageResources = true,
  style,
}: ProjectCardProps) {
  const tr = createProjectsTranslator(locale);
  const activeLinkedEnvironmentCount = linkedEnvironments.filter(
    (e) => e.status === "active",
  ).length;
  const localizedProjectName = translateInlineText(locale, project.name);
  return (
    <div
      id={`project-${project.id}`}
      className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-none"
      style={style}
    >
      {" "}
      <form action={updateProjectAction} className="p-4 sm:p-5 space-y-4">
        {" "}
        <input
          name="workspaceId"
          type="hidden"
          value={workspaceId ?? ""}
        />{" "}
        <input name="projectId" type="hidden" value={project.id} />{" "}
        <input
          name="redirectPath"
          type="hidden"
          value={`${currentPageHref}#project-${project.id}`}
        />{" "}
        <input name="previousStatus" type="hidden" value={project.status} />{" "}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          {" "}
          <div className="space-y-1.5 flex-1 min-w-0">
            {" "}
            <div className="flex flex-wrap items-center gap-2">
              {" "}
              <div className="flex items-center gap-2 min-w-0">
                {" "}
                <FolderKanban
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />{" "}
                <h3 className="text-lg font-semibold tracking-tight text-foreground truncate">
                  {localizedProjectName}
                </h3>{" "}
              </div>{" "}
              <span className={getStatusTagClass(project.status)}>
                {tr(project.status)}
              </span>{" "}
            </div>{" "}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              {" "}
              <span className="font-mono bg-muted/50 px-1.5 py-0.5 rounded border border-border/40 text-[10px]">
                {project.slug}
              </span>{" "}
              <span className="flex items-center gap-1.5">
                {" "}
                <Blocks className="size-3" />{" "}
                {`${activeLinkedEnvironmentCount}/${linkedEnvironments.length} ${tr("active environments")}`}{" "}
              </span>{" "}
            </div>{" "}
          </div>{" "}
          <div className="flex items-center gap-2 shrink-0">
            {" "}
            {canManageResources && (
              <a
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${secondaryActionButtonClassName}`}
                href={buildContextualHref(
                  `/members?workspaceId=${encodeURIComponent(workspaceId ?? "")}&task=assign-projects&projectId=${encodeURIComponent(project.id)}`,
                  currentPageHref,
                )}
              >
                {" "}
                {tr("Assign members")}{" "}
              </a>
            )}{" "}
            <a
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${secondaryActionButtonClassName}`}
              href={buildContextualHref(
                `/usage-events?workspaceId=${encodeURIComponent(workspaceId ?? "")}&projectId=${encodeURIComponent(project.id)}`,
                currentPageHref,
              )}
            >
              {" "}
              {tr("View usage")}{" "}
            </a>{" "}
          </div>{" "}
        </div>{" "}
        {canManageResources && (
          <details
            className="group border-t border-border/40 pt-3"
            open={focusedProjectId === project.id}
          >
            {" "}
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group-open:text-foreground">
              {" "}
              <span className="flex items-center gap-2">
                {" "}
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />{" "}
                {tr("Settings")}{" "}
              </span>{" "}
            </summary>{" "}
            <div className="mt-3 p-4 bg-muted/20 rounded-xl border border-border/40 space-y-4">
              {" "}
              {focusedProjectId === project.id && noticeTag && noticeMessage ? (
                <ResourceInlineNotice
                  label={noticeTag.label}
                  message={noticeMessage}
                  tone={noticeTone ?? "success"}
                />
              ) : null}{" "}
              <div className="grid gap-4 sm:grid-cols-2">
                {" "}
                <div className="space-y-1.5">
                  {" "}
                  <label
                    className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60"
                    htmlFor={`project-name-${project.id}`}
                  >
                    {tr("Name")}
                  </label>{" "}
                  <input
                    className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm text-foreground outline-none transition-all"
                    id={`project-name-${project.id}`}
                    name="name"
                    defaultValue={project.name}
                    required
                  />{" "}
                </div>{" "}
                <div className="space-y-1.5">
                  {" "}
                  <label
                    className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60"
                    htmlFor={`project-slug-${project.id}`}
                  >
                    {tr("Slug")}
                  </label>{" "}
                  <input
                    className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm text-foreground outline-none transition-all"
                    id={`project-slug-${project.id}`}
                    name="slug"
                    defaultValue={project.slug}
                  />{" "}
                </div>{" "}
              </div>{" "}
              <div className="flex flex-wrap items-end justify-between gap-4 pt-3 border-t border-border/40">
                {" "}
                <div className="space-y-1.5 min-w-[140px]">
                  {" "}
                  <label
                    className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60"
                    htmlFor={`project-status-${project.id}`}
                  >
                    {tr("Status")}
                  </label>{" "}
                  <select
                    className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm text-foreground appearance-none outline-none transition-all"
                    id={`project-status-${project.id}`}
                    name="status"
                    defaultValue={project.status}
                  >
                    {" "}
                    <option value="active">{tr("active")}</option>{" "}
                    <option value="archived">{tr("archived")}</option>{" "}
                  </select>{" "}
                </div>{" "}
                <div className="flex items-center gap-2">
                  {" "}
                  {project.status === "archived" ? (
                    <PendingSubmitButton
                      className={`px-4 py-2 text-xs font-semibold rounded-full transition-all ${primaryActionButtonClassName}`}
                      formAction={updateProjectAction.bind(null, "active")}
                      pendingLabel={tr("Reactivating...")}
                    >
                      {" "}
                      {tr("Reactivate project")}{" "}
                    </PendingSubmitButton>
                  ) : (
                    <ConfirmSubmitButton
                      className="px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-400/10 border border-red-400/20 rounded-full transition-all"
                      confirmDescription={tr(
                        "This will remove the project from the active creation path while keeping linked environments visible for review.",
                      )}
                      confirmLabel={tr("Archive project")}
                      confirmTitle={`Archive ${project.name}?`}
                      formAction={archiveProjectAction}
                      formNoValidate
                      pendingLabel={tr("Archiving...")}
                    >
                      {" "}
                      {tr("Archive project")}{" "}
                    </ConfirmSubmitButton>
                  )}{" "}
                  <PendingSubmitButton
                    className={`px-4 py-2 text-xs font-semibold rounded-full transition-all ${primaryActionButtonClassName}`}
                    formAction={updateProjectAction}
                    pendingLabel={tr("Saving...")}
                  >
                    {" "}
                    {tr("Save project")}{" "}
                  </PendingSubmitButton>{" "}
                </div>{" "}
              </div>{" "}
            </div>{" "}
          </details>
        )}{" "}
      </form>{" "}
      {linkedEnvironments.length > 0 && (
        <div className="bg-muted/30 border-t border-border/40">
          {" "}
          <div className="px-4 sm:px-5 py-2 flex items-center gap-2 border-b border-border/40">
            {" "}
            <Blocks className="size-3.5 text-muted-foreground" />{" "}
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              {tr("Environments")}
            </span>{" "}
          </div>{" "}
          <div className="grid gap-px bg-border/40">
            {" "}
            {linkedEnvironments.map((env) => (
              <EnvironmentCard
                key={env.id}
                environment={env}
                parentProject={project}
                allProjects={allProjects}
                workspaceId={workspaceId}
                currentPageHref={currentPageHref}
                focusedEnvironmentId={focusedEnvironmentId}
                noticeTag={noticeTag}
                noticeMessage={noticeMessage}
                noticeTone={noticeTone}
                locale={locale}
                canManageResources={canManageResources}
              />
            ))}{" "}
          </div>{" "}
        </div>
      )}{" "}
    </div>
  );
}
