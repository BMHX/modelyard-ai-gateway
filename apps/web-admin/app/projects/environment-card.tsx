"use client";
import {
  Blocks,
  ChevronDown,
  FlaskConical,
  Rocket,
  Wrench,
} from "lucide-react";
import type { Environment, Project } from "@teamops/contracts";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { PendingSubmitButton } from "../components/pending-submit-button";
import { ConfirmSubmitButton } from "../components/confirm-submit-button";
import { buildContextualHref } from "../lib/navigation";
import { archiveEnvironmentAction, updateEnvironmentAction } from "./actions";
import { motion } from "framer-motion";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import enProjectsMessages from "../messages/en/projects.json";
import zhProjectsMessages from "../messages/zh/projects.json";
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
  return status === "archived"
    ? "px-2 py-1 rounded-full border border-red-900/50 bg-red-950/20 text-red-400 text-xs font-medium"
    : "px-2 py-1 rounded-full border border-border bg-muted/50 text-muted-foreground text-xs font-medium";
}
const primaryActionButtonClassName =
  "border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-selected)_72%,var(--surface-1)_28%)] text-foreground shadow-none hover:border-[color:var(--primary-border-strong)] hover:bg-[color:color-mix(in_srgb,var(--surface-selected)_82%,var(--surface-1)_18%)]";
const secondaryActionButtonClassName =
  "border-[color:color-mix(in_srgb,var(--border-default)_76%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] text-[color:var(--text-2)] shadow-none hover:border-[color:var(--border-strong)] hover:bg-[color:color-mix(in_srgb,var(--surface-2)_72%,var(--surface-1)_28%)] hover:text-foreground";
function getRuntimeIcon(runtime: Environment["runtime"]) {
  switch (runtime) {
    case "development":
      return Wrench;
    case "staging":
      return FlaskConical;
    case "production":
      return Rocket;
    default:
      return Wrench;
  }
}
type EnvironmentCardProps = {
  environment: Environment;
  parentProject: Project | null;
  allProjects: Project[];
  workspaceId: string | null;
  currentPageHref: string;
  focusedEnvironmentId: string | null;
  noticeTag: { label: string; className: string } | null;
  noticeMessage?: string;
  noticeTone?: "success" | "warning" | "error";
  locale: AppLocale;
  canManageResources?: boolean;
  style?: React.CSSProperties;
};
export function EnvironmentCard({
  environment,
  parentProject,
  allProjects,
  workspaceId,
  currentPageHref,
  focusedEnvironmentId,
  noticeTag,
  noticeMessage,
  noticeTone,
  locale,
  canManageResources = true,
  style,
}: EnvironmentCardProps) {
  const tr = createProjectsTranslator(locale);
  const RuntimeIcon = getRuntimeIcon(environment.runtime);
  const localizedEnvironmentName = translateInlineText(
    locale,
    environment.name,
  );
  const localizedRuntime = translateInlineText(locale, environment.runtime);
  const localizedParentProjectName = parentProject
    ? translateInlineText(locale, parentProject.name)
    : tr("Unknown project");
  return (
    <motion.form
      layout
      whileHover={{ scale: 1.002 }}
      transition={{ duration: 0.2 }}
      id={`environment-${environment.id}`}
      className="bg-card/40 border border-border/60 rounded-xl p-4"
      action={updateEnvironmentAction}
      style={style}
    >
      {" "}
      <input name="workspaceId" type="hidden" value={workspaceId ?? ""} />{" "}
      <input name="environmentId" type="hidden" value={environment.id} />{" "}
      <input
        name="redirectPath"
        type="hidden"
        value={`${currentPageHref}#environment-${environment.id}`}
      />{" "}
      <input name="previousStatus" type="hidden" value={environment.status} />{" "}
      <div className="flex flex-col gap-4">
        {" "}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          {" "}
          <div className="grid gap-1">
            {" "}
            <div className="flex flex-wrap items-center gap-2">
              {" "}
              <div className="flex min-w-0 items-center gap-2">
                {" "}
                <Blocks
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={1.9}
                />{" "}
                <h3 className="text-foreground tracking-tight font-medium text-base m-0">
                  {localizedEnvironmentName}
                </h3>{" "}
              </div>{" "}
              <span className={getStatusTagClass(environment.status)}>
                {tr(environment.status)}
              </span>{" "}
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-border bg-muted/50 text-muted-foreground text-[10px] font-medium">
                {" "}
                <RuntimeIcon
                  aria-hidden="true"
                  className="size-3 shrink-0"
                  strokeWidth={1.9}
                />{" "}
                {localizedRuntime}{" "}
              </span>{" "}
            </div>{" "}
            <p className="text-muted-foreground text-xs m-0">
              {" "}
              {localizedParentProjectName}{" "}
            </p>{" "}
          </div>{" "}
          <div className="flex flex-wrap items-center gap-2">
            {" "}
            <a
              className={`inline-flex items-center justify-center rounded-full border px-2 py-1 text-[10px] font-medium transition-colors ${secondaryActionButtonClassName}`}
              href={buildContextualHref(
                `/usage-events?workspaceId=${encodeURIComponent(workspaceId ?? "")}&environmentId=${encodeURIComponent(environment.id)}`,
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
            className="group border-t border-border/60 pt-3"
            open={focusedEnvironmentId === environment.id ? true : undefined}
          >
            {" "}
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              {" "}
              <span className="text-foreground tracking-tight font-medium text-xs">
                {" "}
                {tr("Environment basics")}{" "}
              </span>{" "}
              <ChevronDown
                aria-hidden="true"
                className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-180"
                strokeWidth={1.9}
              />{" "}
            </summary>{" "}
            <div className="mt-3 space-y-4 rounded-xl bg-muted/20 border border-border/40 p-4">
              {" "}
              {focusedEnvironmentId === environment.id &&
              noticeTag &&
              noticeMessage ? (
                <ResourceInlineNotice
                  label={noticeTag.label}
                  message={noticeMessage}
                  tone={noticeTone ?? "success"}
                />
              ) : null}{" "}
              <div className="grid gap-4">
                {" "}
                <div className="flex flex-col gap-1.5">
                  {" "}
                  <label
                    className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
                    htmlFor={`environment-project-${environment.id}`}
                  >
                    {tr("Project")}
                  </label>{" "}
                  <select
                    id={`environment-project-${environment.id}`}
                    name="projectId"
                    defaultValue={environment.projectId}
                    className="w-full rounded-lg border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground focus:border-primary focus:outline-none"
                  >
                    {" "}
                    {allProjects.map((projectOption) => (
                      <option key={projectOption.id} value={projectOption.id}>
                        {" "}
                        {translateInlineText(locale, projectOption.name)}{" "}
                        {projectOption.status === "archived"
                          ? `(${tr("archived")})`
                          : ""}{" "}
                      </option>
                    ))}{" "}
                  </select>{" "}
                </div>{" "}
                <div className="grid gap-4 xl:grid-cols-2">
                  {" "}
                  <div className="flex flex-col gap-1.5">
                    {" "}
                    <label
                      className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
                      htmlFor={`environment-name-${environment.id}`}
                    >
                      {tr("Name")}
                    </label>{" "}
                    <input
                      id={`environment-name-${environment.id}`}
                      name="name"
                      defaultValue={environment.name}
                      required
                      className="w-full rounded-lg border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground focus:border-primary focus:outline-none"
                    />{" "}
                  </div>{" "}
                  <div className="flex flex-col gap-1.5">
                    {" "}
                    <label
                      className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
                      htmlFor={`environment-slug-${environment.id}`}
                    >
                      {tr("Slug")}
                    </label>{" "}
                    <input
                      id={`environment-slug-${environment.id}`}
                      name="slug"
                      defaultValue={environment.slug}
                      className="w-full rounded-lg border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground focus:border-primary focus:outline-none"
                    />{" "}
                  </div>{" "}
                </div>{" "}
              </div>{" "}
              <div className="grid gap-4 border-t border-border/60 pt-4 xl:grid-cols-2">
                {" "}
                <div className="flex flex-col gap-1.5">
                  {" "}
                  <label
                    className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
                    htmlFor={`environment-runtime-${environment.id}`}
                  >
                    {tr("Runtime")}
                  </label>{" "}
                  <select
                    id={`environment-runtime-${environment.id}`}
                    name="runtime"
                    defaultValue={environment.runtime}
                    className="w-full rounded-lg border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground focus:border-primary focus:outline-none"
                  >
                    {" "}
                    <option value="development">
                      {translateInlineText(locale, "development")}
                    </option>{" "}
                    <option value="staging">
                      {translateInlineText(locale, "staging")}
                    </option>{" "}
                    <option value="production">
                      {translateInlineText(locale, "production")}
                    </option>{" "}
                  </select>{" "}
                </div>{" "}
                <div className="flex flex-col gap-1.5">
                  {" "}
                  <label
                    className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
                    htmlFor={`environment-status-${environment.id}`}
                  >
                    {tr("Status")}
                  </label>{" "}
                  <select
                    id={`environment-status-${environment.id}`}
                    name="status"
                    defaultValue={environment.status}
                    className="w-full rounded-lg border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground focus:border-primary focus:outline-none"
                  >
                    {" "}
                    <option value="active">{tr("active")}</option>{" "}
                    <option value="archived">{tr("archived")}</option>{" "}
                  </select>{" "}
                </div>{" "}
              </div>{" "}
              <div className="flex flex-wrap gap-2 xl:justify-end">
                {" "}
                <PendingSubmitButton
                  className={`inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${primaryActionButtonClassName}`}
                  formAction={updateEnvironmentAction}
                  pendingLabel={tr("Saving...")}
                >
                  {" "}
                  {tr("Save environment")}{" "}
                </PendingSubmitButton>{" "}
                {environment.status === "archived" ? (
                  <PendingSubmitButton
                    className={`inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${primaryActionButtonClassName}`}
                    formAction={updateEnvironmentAction.bind(null, "active")}
                    pendingLabel={tr("Reactivating...")}
                  >
                    {" "}
                    {tr("Reactivate")}{" "}
                  </PendingSubmitButton>
                ) : (
                  <ConfirmSubmitButton
                    className="inline-flex items-center justify-center rounded-full border border-red-900/30 bg-transparent px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-950/30"
                    confirmDescription={tr(
                      "This will keep the environment visible for review but remove it from active routing until reactivated.",
                    )}
                    confirmLabel={tr("Archive environment")}
                    confirmTitle={`Archive ${environment.name}?`}
                    formAction={archiveEnvironmentAction}
                    formNoValidate
                    pendingLabel={tr("Archiving...")}
                  >
                    {" "}
                    {tr("Archive")}{" "}
                  </ConfirmSubmitButton>
                )}{" "}
              </div>{" "}
              <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
                {" "}
                <a
                  className={`inline-flex items-center justify-center rounded-full border px-2 py-1 text-[10px] font-medium transition-colors ${secondaryActionButtonClassName}`}
                  href={buildContextualHref(
                    `/alerts?workspaceId=${encodeURIComponent(workspaceId ?? "")}&environmentId=${encodeURIComponent(environment.id)}`,
                    currentPageHref,
                  )}
                >
                  {" "}
                  {tr("View alerts")}{" "}
                </a>{" "}
              </div>{" "}
            </div>{" "}
          </details>
        )}{" "}
      </div>{" "}
    </motion.form>
  );
}
