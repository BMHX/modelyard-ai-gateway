import { memberUsesProjectAssignments, type Environment, type Project } from "@teamops/contracts";
import type { CSSProperties } from "react";
import { ChevronDown, FlaskConical, FolderKanban, Rocket, Wrench } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";

import { AppShell } from "../components/app-shell";
import { ConfirmSubmitButton } from "../components/confirm-submit-button";
import { PendingSubmitButton } from "../components/pending-submit-button";
import { ResourceTableSection } from "../components/resource-table-section";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { SummaryActionLink } from "../components/summary-action-link";
import { loadProjectsPageData } from "../lib/control-api";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import enProjectsMessages from "../messages/en/projects.json";
import zhProjectsMessages from "../messages/zh/projects.json";
import { getCurrentLocale } from "../lib/i18n-server";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import {
  archiveEnvironmentAction,
  archiveProjectAction,
  updateEnvironmentAction,
  updateProjectAction,
} from "./actions";
import { ProjectsCreateActions } from "./projects-create-actions";

export const dynamic = "force-dynamic";

const projectStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Project["status"], number>;
const environmentStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Environment["status"], number>;

type ProjectsPageProps = {
  searchParams?: Promise<{
    workspaceId?: string;
    focusProjectId?: string;
    focusEnvironmentId?: string;
    q?: string;
    projectStatus?: string;
    environmentStatus?: string;
    notice?: string;
    message?: string;
    returnTo?: string;
  }>;
};

function getDaysSince(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000)));
}


function resolveProjectMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  const nested = key.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" && part in (current as Record<string, unknown>)
      ? (current as Record<string, unknown>)[part]
      : null, messages);
  return typeof nested === "string" ? nested : null;
}

function createProjectsTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhProjectsMessages : enProjectsMessages) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    const template = resolveProjectMessage(messages, key);
    if (!template) return translateInlineText(locale, key);
    return template.replace(/\{(\w+)\}/g, (_, token) => String(values?.[token] ?? `{${token}}`));
  };
}

function translateLegacyProjectNoticeMessage(locale: AppLocale, message: string, tr: ReturnType<typeof createProjectsTranslator>) {
  if (!message) {
    return message;
  }

  const legacyPatterns: Array<[RegExp, string]> = [
    [/^Created project (.+)\.$/, locale === "zh" ? "已创建项目 $1。" : "Created project $1."],
    [/^Updated project (.+)\.$/, locale === "zh" ? "已更新项目 $1。" : "Updated project $1."],
    [/^Archived project (.+)\.$/, locale === "zh" ? "已归档项目 $1。" : "Archived project $1."],
    [/^Reactivated project (.+)\.$/, locale === "zh" ? "已重新激活项目 $1。" : "Reactivated project $1."],
    [/^Created environment (.+)\.$/, locale === "zh" ? "已创建环境 $1。" : "Created environment $1."],
    [/^Updated environment (.+)\.$/, locale === "zh" ? "已更新环境 $1。" : "Updated environment $1."],
    [/^Archived environment (.+)\.$/, locale === "zh" ? "已归档环境 $1。" : "Archived environment $1."],
    [/^Reactivated environment (.+)\.$/, locale === "zh" ? "已重新激活环境 $1。" : "Reactivated environment $1."],
  ];

  for (const [pattern, replacement] of legacyPatterns) {
    if (pattern.test(message)) {
      return message.replace(pattern, replacement);
    }
  }

  return tr(message);
}

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

function getStatusTagClass(status: "active" | "archived") {
  return status === "archived" ? "tag tag--critical" : "tag";
}

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

function getNoticeTag(notice?: string | null) {
  if (notice === "created") {
    return {
      key: "created",
      className: "tag status-tag--success",
    };
  }

  if (notice === "updated") {
    return {
      key: "updated",
      className: "tag status-tag--success",
    };
  }

  if (notice === "archived") {
    return {
      key: "archived",
      className: "tag tag--warning",
    };
  }

  if (notice === "reactivated") {
    return {
      key: "reactivated",
      className: "tag status-tag--success",
    };
  }

  if (notice === "error") {
    return {
      key: "error",
      className: "tag status-tag--error",
    };
  }

  return null;
}

function createFormatters(locale: AppLocale) {
  const intlLocale = getIntlLocale(locale);

  return {
    compareLabels(left: string, right: string) {
      return left.localeCompare(right, intlLocale);
    },
    formatRelativeAgeLabel(value: string) {
      const days = getDaysSince(value);
      if (days === null) {
        return locale === "zh" ? "时间未知" : "unknown age";
      }

      if (days === 0) {
        return locale === "zh" ? "今天" : "today";
      }

      return new Intl.RelativeTimeFormat(intlLocale, {
        numeric: "always",
      }).format(-days, "day");
    },
  };
}

function buildProjectsPageHref(args?: {
  workspaceId?: string | null;
  q?: string | null;
  projectStatus?: string | null;
  environmentStatus?: string | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();

  if (args?.workspaceId) {
    params.set("workspaceId", args.workspaceId);
  }
  if (args?.q) {
    params.set("q", args.q);
  }
  if (args?.projectStatus && args.projectStatus !== "all") {
    params.set("projectStatus", args.projectStatus);
  }
  if (args?.environmentStatus && args.environmentStatus !== "all") {
    params.set("environmentStatus", args.environmentStatus);
  }

  const href = params.toString() ? `/projects?${params.toString()}` : "/projects";
  return buildContextualHref(href, args?.returnTo);
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const locale = await getCurrentLocale();
  const tr = createProjectsTranslator(locale);
  const { compareLabels } = createFormatters(locale);
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = getSafeReturnTo(resolvedSearchParams.returnTo);
  const query = resolvedSearchParams.q?.trim() ?? "";
  const projectStatusFilter = resolvedSearchParams.projectStatus === "archived" ? "archived" : resolvedSearchParams.projectStatus === "active" ? "active" : "all";
  const environmentStatusFilter =
    resolvedSearchParams.environmentStatus === "archived"
      ? "archived"
      : resolvedSearchParams.environmentStatus === "active"
        ? "active"
        : "all";
  const pageData = await loadProjectsPageData(resolvedSearchParams.workspaceId);
  const selectedWorkspace =
    pageData.selectedWorkspaceId
      ? pageData.workspaceOptions.find((workspace) => workspace.id === pageData.selectedWorkspaceId) ?? null
      : null;
  const sortedProjects = [...pageData.projects].sort(
    (left, right) =>
      projectStatusOrder[left.status] - projectStatusOrder[right.status] || compareLabels(left.name, right.name),
  );
  const projectNameById = new Map(sortedProjects.map((project) => [project.id, project.name]));
  const sortedEnvironments = [...pageData.environments].sort(
    (left, right) =>
      compareLabels(projectNameById.get(left.projectId) ?? "", projectNameById.get(right.projectId) ?? "") ||
      environmentStatusOrder[left.status] - environmentStatusOrder[right.status] ||
      compareLabels(left.name, right.name),
  );
  const activeProjects = sortedProjects.filter((project) => project.status === "active");
  const assignedProjectIdsByMember = new Map<string, Set<string>>();

  for (const assignment of pageData.memberProjectAssignments) {
    const assignedProjectIds = assignedProjectIdsByMember.get(assignment.memberId) ?? new Set<string>();
    assignedProjectIds.add(assignment.projectId);
    assignedProjectIdsByMember.set(assignment.memberId, assignedProjectIds);
  }

  const scopedMembersWithoutProjects = pageData.members.filter((member) => {
    if (member.status !== "active" || !memberUsesProjectAssignments(member)) {
      return false;
    }

    return (assignedProjectIdsByMember.get(member.id) ?? new Set<string>()).size === 0;
  });
  const visibleProjects = sortedProjects.filter((project) => {
    if (projectStatusFilter !== "all" && project.status !== projectStatusFilter) {
      return false;
    }
    const projectMatchesQuery = !query || `${project.name} ${project.slug}`.toLowerCase().includes(query.toLowerCase());
    
    const hasMatchingEnvironment = sortedEnvironments.some(env => 
      env.projectId === project.id && 
      (environmentStatusFilter === "all" || env.status === environmentStatusFilter) &&
      (!query || `${env.name} ${env.slug} ${env.runtime} ${project.name}`.toLowerCase().includes(query.toLowerCase()))
    );

    return projectMatchesQuery || hasMatchingEnvironment;
  });

  const resourcePanelStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    height: "100%",
  };
  const noWorkspaceDescription =
    locale === "zh"
      ? "请先在页头选择全局工作区，再管理项目与环境。"
      : "Choose the active workspace from the header before managing projects and environments.";
  const resourceListStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    flex: 1,
  };
  const resourceSectionHeaderStyle: CSSProperties = {
    alignItems: "center",
    marginBottom: 0,
    paddingBottom: "12px",
    borderBottom: "1px solid var(--border-subtle)",
  };
  const noticeTag = getNoticeTag(resolvedSearchParams.notice);
  const translatedNoticeMessage = resolvedSearchParams.message
    ? translateLegacyProjectNoticeMessage(locale, resolvedSearchParams.message, tr)
    : null;
  const focusedProjectId = resolvedSearchParams.focusProjectId?.trim() ?? null;
  const focusedEnvironmentId = resolvedSearchParams.focusEnvironmentId?.trim() ?? null;
  const currentPageHref = buildProjectsPageHref({
    workspaceId: pageData.selectedWorkspaceId,
    q: query || null,
    projectStatus: projectStatusFilter,
    environmentStatus: environmentStatusFilter,
    returnTo,
  });
  const openMembersHref = pageData.selectedWorkspaceId
    ? buildContextualHref(`/members?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId)}`, currentPageHref)
    : buildContextualHref("/members", currentPageHref);
  const assignmentQueueHref = pageData.selectedWorkspaceId
    ? buildContextualHref(
        `/members?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId)}&task=assign-projects`,
        currentPageHref,
      )
    : buildContextualHref("/members", currentPageHref);

  return (
    <AppShell
      headerMode="compact"
      sidebarVariant="minimal"
      showSupportPanels={false}
      title={tr("projects.title")}
      subtitle=""
      workspaceId={pageData.selectedWorkspaceId}
      workspaceLabel={selectedWorkspace ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}` : null}
    >
      <section className="space-y-6">
        {pageData.workspaceOptions.length ? (
          <>
            <ResourceTableSection>
              <form action="/projects" method="get" className="grid gap-4 p-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {pageData.workspaceOptions.length > 1 ? (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-foreground/80">{tr("Workspace")}</label>
                      <select
                        name="workspaceId"
                        defaultValue={pageData.selectedWorkspaceId ?? ""}
                        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                      >
                        {pageData.workspaceOptions.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.organizationName} / {workspace.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : pageData.selectedWorkspaceId ? (
                    <input name="workspaceId" type="hidden" value={pageData.selectedWorkspaceId} />
                  ) : null}
                  <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
                    <label className="text-[11px] font-semibold text-foreground/80">{tr("Search")}</label>
                    <input
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                      defaultValue={query}
                      name="q"
                      placeholder={tr("Project, env, slug, runtime")}
                      type="search"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-foreground/80">{tr("Project Status")}</label>
                    <select name="projectStatus" defaultValue={projectStatusFilter} className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                      <option value="all">{tr("all")}</option>
                      <option value="active">{tr("active")}</option>
                      <option value="archived">{tr("archived")}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-foreground/80">{tr("Environment Status")}</label>
                    <select name="environmentStatus" defaultValue={environmentStatusFilter} className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                      <option value="all">{tr("all")}</option>
                      <option value="active">{tr("active")}</option>
                      <option value="archived">{tr("archived")}</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border/50 pt-3">
                  {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <a className="button button--ghost button--micro h-9 whitespace-nowrap rounded-full px-3" href={openMembersHref}>
                      {tr("Open members")}
                    </a>
                    <a
                      className="button button--ghost button--micro h-9 whitespace-nowrap rounded-full px-3"
                      href={buildProjectsPageHref({
                        workspaceId: pageData.selectedWorkspaceId,
                        returnTo,
                      })}
                    >
                      {tr("Reset")}
                    </a>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
                    {pageData.selectedWorkspaceId ? (
                      <ProjectsCreateActions
                        activeProjects={activeProjects.map((project) => ({ id: project.id, name: project.name }))}
                        className="flex flex-wrap items-center gap-2"
                        currentPageHref={currentPageHref}
                        environmentButtonClassName="h-9 whitespace-nowrap rounded-full px-4"
                        locale={locale}
                        projectButtonClassName="h-9 whitespace-nowrap rounded-full px-4"
                        workspaceId={pageData.selectedWorkspaceId}
                      />
                    ) : null}
                    <button className="button h-9 whitespace-nowrap rounded-full px-4" type="submit">
                      {tr("Apply filters")}
                    </button>
                  </div>
                </div>
              </form>
            </ResourceTableSection>
          </>
        ) : null}

        {noticeTag && resolvedSearchParams.message && !focusedProjectId && !focusedEnvironmentId ? (
          <article className="card span-12">
            <div className="resource-card__header">
              <div>
                <h2>{tr("projects.notice.header")}</h2>
                <p>{translatedNoticeMessage}</p>
              </div>
              <span className={noticeTag.className}>{tr(`projects.notice.${noticeTag.key}`)}</span>
            </div>
          </article>
        ) : null}

        {pageData.selectedWorkspaceId ? (
          <>
            <article className="card span-12" style={resourcePanelStyle}>
              <div className="summary-row" style={resourceSectionHeaderStyle}>
                <div className="flex items-center gap-2">
                  <FolderKanban aria-hidden="true" className="size-4 text-muted-foreground" strokeWidth={1.9} />
                  <h2>{tr("Projects & Environments")}</h2>
                </div>
                <div className="badge-row">
                  <span className="tag">{`${visibleProjects.length}/${sortedProjects.length}`} {tr("Projects")}</span>
                  <span className="tag">{projectStatusFilter === "all" ? tr("all statuses") : tr(projectStatusFilter)}</span>
                </div>
              </div>
              {visibleProjects.length ? (
                <div className="stack" style={resourceListStyle}>
                  {visibleProjects.map((project) => {
                    const linkedEnvironments = sortedEnvironments.filter((environment) => environment.projectId === project.id);
                    const activeLinkedEnvironmentCount = linkedEnvironments.filter((environment) => environment.status === "active").length;
                    
                    const visibleLinkedEnvironments = linkedEnvironments.filter((environment) => {
                      if (environmentStatusFilter !== "all" && environment.status !== environmentStatusFilter) {
                        return false;
                      }
                      if (!query) return true;
                      return `${environment.name} ${environment.slug} ${environment.runtime} ${project.name}`.toLowerCase().includes(query.toLowerCase());
                    });

                    return (
                      <div key={project.id} className="flex flex-col gap-3">
                        <form
                        id={`project-${project.id}`}
                        key={project.id}
                        action={updateProjectAction}
                        className="group bg-card rounded-xl border border-border/60 shadow-sm hover:border-border/80 transition-colors"
                      >
                        <input name="workspaceId" type="hidden" value={pageData.selectedWorkspaceId ?? ""} />
                        <input name="projectId" type="hidden" value={project.id} />
                        <input name="redirectPath" type="hidden" value={`${currentPageHref}#project-${project.id}`} />
                        <input name="previousStatus" type="hidden" value={project.status} />

                        <details open={focusedProjectId === project.id ? true : undefined} className="[&_summary::-webkit-details-marker]:hidden">
                          <summary className="flex items-center justify-between p-4 cursor-pointer list-none select-none">
                            <div className="flex flex-col gap-1.5 min-w-0">
                              <div className="flex items-center gap-3">
                                <h3 className="text-sm font-semibold tracking-tight text-foreground truncate">{project.name}</h3>
                                <span className={cn(
                                  "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full",
                                  project.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                                )}>{tr(project.status)}</span>
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                {project.slug} <span className="mx-2 opacity-40">|</span> <span className="font-medium text-foreground/80">{activeLinkedEnvironmentCount}/{linkedEnvironments.length}</span> {tr("active environments")}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-4">
                              <SummaryActionLink
                                className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium rounded-full bg-secondary/60 text-secondary-foreground hover:bg-secondary transition-colors"
                                href={buildContextualHref(
                                  `/members?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId ?? "")}&task=assign-projects&projectId=${encodeURIComponent(project.id)}`,
                                  currentPageHref,
                                )}
                              >
                                {tr("Assign members")}
                              </SummaryActionLink>
                              <ChevronDown className="size-4 text-muted-foreground/50 transition-transform duration-200 group-open:rotate-180" />
                            </div>
                          </summary>

                          <div className="px-4 pb-4 pt-1 border-t border-border/40 bg-muted/10">
                            {focusedProjectId === project.id && noticeTag && resolvedSearchParams.message ? (
                              <div className="mb-4">
                                <ResourceInlineNotice
                                  label={tr(`projects.notice.${noticeTag.key}`)}
                                  message={translatedNoticeMessage ?? resolvedSearchParams.message}
                                  tone={resolvedSearchParams.notice === "error" ? "error" : resolvedSearchParams.notice === "archived" ? "warning" : "success"}
                                />
                              </div>
                            ) : null}

                            <div className="grid gap-5 md:grid-cols-3 pt-3">
                              <div className="space-y-1.5">
                                <label htmlFor={`project-name-${project.id}`} className="text-xs font-medium text-muted-foreground">{tr("Name")}</label>
                                <input className="w-full h-8 px-3 text-sm bg-background border border-border/60 rounded-md focus:ring-1 focus:ring-ring" id={`project-name-${project.id}`} name="name" defaultValue={project.name} required />
                              </div>
                              <div className="space-y-1.5">
                                <label htmlFor={`project-slug-${project.id}`} className="text-xs font-medium text-muted-foreground">{tr("Slug")}</label>
                                <input className="w-full h-8 px-3 text-sm bg-background border border-border/60 rounded-md focus:ring-1 focus:ring-ring" id={`project-slug-${project.id}`} name="slug" defaultValue={project.slug} />
                              </div>
                              <div className="space-y-1.5">
                                <label htmlFor={`project-status-${project.id}`} className="text-xs font-medium text-muted-foreground">{tr("Status")}</label>
                                <select className="w-full h-8 px-3 text-sm bg-background border border-border/60 rounded-md focus:ring-1 focus:ring-ring" id={`project-status-${project.id}`} name="status" defaultValue={project.status}>
                                  <option value="active">{tr("active")}</option>
                                  <option value="archived">{tr("archived")}</option>
                                </select>
                              </div>
                            </div>

                            <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/40">
                              <div className="flex gap-4">
                                <a className="text-xs text-muted-foreground hover:text-foreground transition-colors" href={buildContextualHref(`/usage-events?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId ?? "")}&projectId=${encodeURIComponent(project.id)}`, currentPageHref)}>
                                  {tr("View usage")}
                                </a>
                                <a className="text-xs text-muted-foreground hover:text-foreground transition-colors" href={buildContextualHref(`/alerts?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId ?? "")}&projectId=${encodeURIComponent(project.id)}`, currentPageHref)}>
                                  {tr("View alerts")}
                                </a>
                              </div>
                              <div className="flex gap-2">
                                {project.status === "archived" ? (
                                  <PendingSubmitButton className="h-8 px-3 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted" formAction={updateProjectAction.bind(null, "active")} pendingLabel={tr("Reactivating...")}>
                                    {tr("Reactivate")}
                                  </PendingSubmitButton>
                                ) : (
                                  <ConfirmSubmitButton className="h-8 px-3 text-xs font-medium rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10" confirmDescription={tr("This will remove the project from the active creation path while keeping linked environments visible for review.")} confirmLabel={tr("Archive project")} confirmTitle={tr("Archive {name}?", { name: project.name })} formAction={archiveProjectAction} formNoValidate pendingLabel={tr("Archiving...")}>
                                    {tr("Archive")}
                                  </ConfirmSubmitButton>
                                )}
                                <PendingSubmitButton className="h-8 rounded-md bg-foreground px-4 text-xs font-medium text-background hover:bg-foreground/92" formAction={updateProjectAction} pendingLabel={tr("Saving...")}>
                                  {tr("Save")}
                                </PendingSubmitButton>
                              </div>
                            </div>
                          </div>
                        </details>
                      </form>
                        
                        {visibleLinkedEnvironments.length > 0 && (
                          <div className="flex flex-col gap-3 pl-6 ml-6 border-l-2 border-border/40">
                            {visibleLinkedEnvironments.map((environment) => {
                              const RuntimeIcon = getRuntimeIcon(environment.runtime);
                              return (
                                <form
                        id={`environment-${environment.id}`}
                        key={environment.id}
                        action={updateEnvironmentAction}
                        className="group bg-card rounded-xl border border-border/60 shadow-sm hover:border-border/80 transition-colors"
                      >
                        <input name="workspaceId" type="hidden" value={pageData.selectedWorkspaceId ?? ""} />
                        <input name="environmentId" type="hidden" value={environment.id} />
                        <input name="redirectPath" type="hidden" value={`${currentPageHref}#environment-${environment.id}`} />
                        <input name="previousStatus" type="hidden" value={environment.status} />

                        <details open={focusedEnvironmentId === environment.id ? true : undefined} className="[&_summary::-webkit-details-marker]:hidden">
                          <summary className="flex items-center justify-between p-4 cursor-pointer list-none select-none">
                            <div className="flex flex-col gap-1.5 min-w-0">
                              <div className="flex items-center gap-3">
                                <h3 className="text-sm font-semibold tracking-tight text-foreground truncate">{environment.name}</h3>
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-muted/60 text-muted-foreground border border-border/50">
                                  <RuntimeIcon aria-hidden="true" className="size-3 opacity-70" />
                                  {translateInlineText(locale, environment.runtime)}
                                </span>
                                {environment.status === "archived" ? <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-destructive/10 text-destructive">{tr("archived")}</span> : null}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                <span className="font-medium text-foreground/70">{project.name}</span> <span className="mx-2 opacity-40">|</span> {environment.slug}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-4">
                              <SummaryActionLink
                                className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium rounded-full bg-secondary/60 text-secondary-foreground hover:bg-secondary transition-colors"
                                href={buildContextualHref(
                                  `/usage-events?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId ?? "")}&environmentId=${encodeURIComponent(environment.id)}`,
                                  currentPageHref,
                                )}
                              >
                                {tr("View usage")}
                              </SummaryActionLink>
                              <ChevronDown className="size-4 text-muted-foreground/50 transition-transform duration-200 group-open:rotate-180" />
                            </div>
                          </summary>

                          <div className="px-4 pb-4 pt-1 border-t border-border/40 bg-muted/10">
                            {focusedEnvironmentId === environment.id && noticeTag && resolvedSearchParams.message ? (
                              <div className="mb-4">
                                <ResourceInlineNotice
                                  label={tr(`projects.notice.${noticeTag.key}`)}
                                  message={translatedNoticeMessage ?? resolvedSearchParams.message}
                                  tone={resolvedSearchParams.notice === "error" ? "error" : resolvedSearchParams.notice === "archived" ? "warning" : "success"}
                                />
                              </div>
                            ) : null}

                            <div className="grid gap-5 md:grid-cols-2 pt-3">
                              <div className="space-y-1.5 md:col-span-2">
                                <label htmlFor={`environment-project-${environment.id}`} className="text-xs font-medium text-muted-foreground">{tr("Project")}</label>
                                <select
                                  className="w-full h-8 px-3 text-sm bg-background border border-border/60 rounded-md focus:ring-1 focus:ring-ring"
                                  id={`environment-project-${environment.id}`}
                                  name="projectId"
                                  defaultValue={environment.projectId}
                                >
                                  {sortedProjects.map((projectOption) => (
                                    <option key={projectOption.id} value={projectOption.id}>
                                      {projectOption.name}
                                      {projectOption.status === "archived" ? ` (${tr("archived")})` : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <label htmlFor={`environment-name-${environment.id}`} className="text-xs font-medium text-muted-foreground">{tr("Name")}</label>
                                <input className="w-full h-8 px-3 text-sm bg-background border border-border/60 rounded-md focus:ring-1 focus:ring-ring" id={`environment-name-${environment.id}`} name="name" defaultValue={environment.name} required />
                              </div>
                              <div className="space-y-1.5">
                                <label htmlFor={`environment-slug-${environment.id}`} className="text-xs font-medium text-muted-foreground">{tr("Slug")}</label>
                                <input className="w-full h-8 px-3 text-sm bg-background border border-border/60 rounded-md focus:ring-1 focus:ring-ring" id={`environment-slug-${environment.id}`} name="slug" defaultValue={environment.slug} />
                              </div>
                              <div className="space-y-1.5">
                                <label htmlFor={`environment-runtime-${environment.id}`} className="text-xs font-medium text-muted-foreground">{tr("Runtime")}</label>
                                <select
                                  className="w-full h-8 px-3 text-sm bg-background border border-border/60 rounded-md focus:ring-1 focus:ring-ring"
                                  id={`environment-runtime-${environment.id}`}
                                  name="runtime"
                                  defaultValue={environment.runtime}
                                >
                                  <option value="development">{translateInlineText(locale, "development")}</option>
                                  <option value="staging">{translateInlineText(locale, "staging")}</option>
                                  <option value="production">{translateInlineText(locale, "production")}</option>
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <label htmlFor={`environment-status-${environment.id}`} className="text-xs font-medium text-muted-foreground">{tr("Status")}</label>
                                <select className="w-full h-8 px-3 text-sm bg-background border border-border/60 rounded-md focus:ring-1 focus:ring-ring" id={`environment-status-${environment.id}`} name="status" defaultValue={environment.status}>
                                  <option value="active">{tr("active")}</option>
                                  <option value="archived">{tr("archived")}</option>
                                </select>
                              </div>
                            </div>

                            <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/40">
                              <div className="flex gap-4">
                                <a className="text-xs text-muted-foreground hover:text-foreground transition-colors" href={buildContextualHref(`/alerts?workspaceId=${encodeURIComponent(pageData.selectedWorkspaceId ?? "")}&environmentId=${encodeURIComponent(environment.id)}`, currentPageHref)}>
                                  {tr("View alerts")}
                                </a>
                              </div>
                              <div className="flex gap-2">
                                {environment.status === "archived" ? (
                                  <PendingSubmitButton className="h-8 px-3 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted" formAction={updateEnvironmentAction.bind(null, "active")} pendingLabel={tr("Reactivating...")}>
                                    {tr("Reactivate")}
                                  </PendingSubmitButton>
                                ) : (
                                  <ConfirmSubmitButton className="h-8 px-3 text-xs font-medium rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10" confirmDescription={tr("This will keep the environment visible for review but remove it from active routing until reactivated.")} confirmLabel={tr("Archive environment")} confirmTitle={tr("Archive {name}?", { name: environment.name })} formAction={archiveEnvironmentAction} formNoValidate pendingLabel={tr("Archiving...")}>
                                    {tr("Archive")}
                                  </ConfirmSubmitButton>
                                )}
                                <PendingSubmitButton className="h-8 rounded-md bg-foreground px-4 text-xs font-medium text-background hover:bg-foreground/92" formAction={updateEnvironmentAction} pendingLabel={tr("Saving...")}>
                                  {tr("Save")}
                                </PendingSubmitButton>
                              </div>
                            </div>
                          </div>
                        </details>
                      </form>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  action={
                    !sortedProjects.length && pageData.selectedWorkspaceId ? (
                      <ProjectsCreateActions
                        activeProjects={activeProjects.map((project) => ({ id: project.id, name: project.name }))}
                        className="flex items-center"
                        currentPageHref={currentPageHref}
                        locale={locale}
                        projectButtonClassName="h-9 rounded-full px-4"
                        showEnvironmentAction={false}
                        workspaceId={pageData.selectedWorkspaceId}
                      />
                    ) : undefined
                  }
                  compact
                  description={
                    sortedProjects.length
                      ? tr("No project matches the current filters.")
                      : tr("Create the first project to define structure.")
                  }
                  title={sortedProjects.length ? tr("No matching project") : tr("No projects yet")}
                />
              )}
            </article>

          </>
        ) : (
          <article className="card span-12">
            <EmptyState
              description={noWorkspaceDescription}
              title={tr("No workspace selected")}
            />
          </article>
        )}
      </section>
    </AppShell>
  );
}
