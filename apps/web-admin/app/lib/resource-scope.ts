import type { Environment, Project } from "@teamops/contracts";
import type { AppLocale } from "./i18n";
import { translateInlineText } from "./i18n";

const projectStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Project["status"], number>;

const environmentStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Environment["status"], number>;

function getIntlLocale(locale?: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

export function compareDisplayLabels(
  left: string,
  right: string,
  locale?: AppLocale,
) {
  return left.localeCompare(right, getIntlLocale(locale));
}

export function sortProjectsForDisplay(projects: Project[], locale?: AppLocale) {
  return [...projects].sort(
    (left, right) =>
      projectStatusOrder[left.status] -
        projectStatusOrder[right.status] ||
      compareDisplayLabels(left.name, right.name, locale),
  );
}

export function sortEnvironmentsForDisplay(
  environments: Environment[],
  projects: Project[],
  locale?: AppLocale,
) {
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

  return [...environments].sort(
    (left, right) =>
      compareDisplayLabels(
        projectNameById.get(left.projectId) ?? "",
        projectNameById.get(right.projectId) ?? "",
        locale,
      ) ||
      environmentStatusOrder[left.status] - environmentStatusOrder[right.status] ||
      compareDisplayLabels(left.name, right.name, locale),
  );
}

export function filterEnvironmentsForProject(environments: Environment[], projectId: string | null) {
  return projectId ? environments.filter((environment) => environment.projectId === projectId) : environments;
}

export function formatProjectOptionLabel(project: Project, locale?: AppLocale) {
  const archivedLabel = locale === "zh" ? "（已归档）" : " (archived)";
  return `${project.name}${project.status === "archived" ? archivedLabel : ""}`;
}

export function formatEnvironmentOptionLabel(
  environment: Environment,
  locale?: AppLocale,
) {
  const archivedLabel = locale === "zh" ? " · 已归档" : " · archived";
  const translatedName = locale ? translateInlineText(locale, environment.name) : environment.name;
  const runtimeLabel = locale ? translateInlineText(locale, environment.runtime) : environment.runtime;

  if (translatedName !== environment.name) {
    return `${translatedName}${environment.status === "archived" ? archivedLabel : ""}`;
  }

  if (environment.name.trim().toLowerCase() === environment.runtime.trim().toLowerCase()) {
    return `${runtimeLabel}${environment.status === "archived" ? archivedLabel : ""}`;
  }

  return `${environment.name} (${runtimeLabel})${environment.status === "archived" ? archivedLabel : ""}`;
}
