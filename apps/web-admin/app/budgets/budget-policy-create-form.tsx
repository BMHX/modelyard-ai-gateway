"use client";

import { useState, type ChangeEvent } from "react";

import type { BudgetPolicySummary, Environment, Project } from "@teamops/contracts";

import { PendingSubmitButton } from "../components/pending-submit-button";
import { findActiveBudgetPolicyForScope } from "../lib/budget-posture";
import {
  filterEnvironmentsForProject,
  formatEnvironmentOptionLabel,
  formatProjectOptionLabel,
} from "../lib/resource-scope";
import { createBudgetPolicyAction } from "./actions";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import enBudgetMessages from "../messages/en/budgets.json";
import zhBudgetMessages from "../messages/zh/budgets.json";

export type BudgetPolicyCreateFormProps = {
  redirectPath: string;
  workspaceId: string;
  projects: Project[];
  environments: Environment[];
  existingPolicies: BudgetPolicySummary[];
  locale: AppLocale;
};


function resolveBudgetMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  const nested = key.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" && part in (current as Record<string, unknown>)
      ? (current as Record<string, unknown>)[part]
      : null, messages);
  return typeof nested === "string" ? nested : null;
}

function createBudgetTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhBudgetMessages : enBudgetMessages) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    const template = resolveBudgetMessage(messages, key);
    if (!template) return translateInlineText(locale, key);
    return template.replace(/\{(\w+)\}/g, (_, token) => String(values?.[token] ?? `{${token}}`));
  };
}

export function BudgetPolicyCreateForm({
  redirectPath,
  workspaceId,
  projects,
  environments,
  existingPolicies,
  locale,
}: BudgetPolicyCreateFormProps) {
  const tr = createBudgetTranslator(locale);
  const activeProjects = projects.filter((project) => project.status === "active");
  const activeProjectIds = new Set(activeProjects.map((project) => project.id));
  const activeEnvironments = environments.filter(
    (environment) => environment.status === "active" && activeProjectIds.has(environment.projectId),
  );
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");

  const projectNameById = Object.fromEntries(activeProjects.map((project) => [project.id, project.name]));
  const environmentsById = Object.fromEntries(activeEnvironments.map((environment) => [environment.id, environment]));
  const availableEnvironments = filterEnvironmentsForProject(activeEnvironments, projectId || null);
  const selectedEnvironment = environmentId ? environmentsById[environmentId] ?? null : null;
  const hiddenArchivedProjectCount = projects.length - activeProjects.length;
  const hiddenArchivedEnvironmentCount = environments.length - activeEnvironments.length;

  function handleProjectChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextProjectId = event.target.value;
    setProjectId(nextProjectId);

    if (!environmentId) {
      return;
    }

    const nextEnvironment = environmentsById[environmentId];
    if (!nextEnvironment || (nextProjectId && nextEnvironment.projectId !== nextProjectId)) {
      setEnvironmentId("");
    }
  }

  function handleEnvironmentChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextEnvironmentId = event.target.value;
    setEnvironmentId(nextEnvironmentId);

    if (!nextEnvironmentId) {
      return;
    }

    const nextEnvironment = environmentsById[nextEnvironmentId];
    if (nextEnvironment) {
      setProjectId(nextEnvironment.projectId);
    }
  }

  const selectedRuntimeLabel = selectedEnvironment ? translateInlineText(locale, selectedEnvironment.runtime) : null;
  const selectedEnvironmentNameMatchesRuntime =
    selectedEnvironment && selectedRuntimeLabel
      ? (() => {
          const normalizedEnvironmentName = selectedEnvironment.name.trim().toLocaleLowerCase(locale === "zh" ? "zh-CN" : "en-US");
          const normalizedRuntime = selectedEnvironment.runtime.trim().toLocaleLowerCase(locale === "zh" ? "zh-CN" : "en-US");
          const normalizedRuntimeLabel = selectedRuntimeLabel.trim().toLocaleLowerCase(locale === "zh" ? "zh-CN" : "en-US");

          return normalizedEnvironmentName === normalizedRuntime || normalizedEnvironmentName === normalizedRuntimeLabel;
        })()
      : false;
  const scopePreview = selectedEnvironment
    ? `${projectNameById[selectedEnvironment.projectId] ?? tr("Project")} / ${
        selectedEnvironmentNameMatchesRuntime
          ? selectedRuntimeLabel
          : selectedRuntimeLabel
            ? `${selectedEnvironment.name} · ${selectedRuntimeLabel}`
            : selectedEnvironment.name
      }`
    : projectId
      ? projectNameById[projectId] ?? projectId
      : tr("Workspace wide");
  const archivedScopeNote =
    hiddenArchivedProjectCount || hiddenArchivedEnvironmentCount
      ? tr("Archived scopes stay hidden from new policy creation: {projects} projects and {environments} environments.", {
          projects: hiddenArchivedProjectCount,
          environments: hiddenArchivedEnvironmentCount,
        })
      : null;
  const conflictingPolicy = findActiveBudgetPolicyForScope(existingPolicies, {
    projectId: projectId || null,
    environmentId: environmentId || null,
  });
  const hasScopeConflict = Boolean(conflictingPolicy);

  return (
    <form className="grid gap-4" action={createBudgetPolicyAction}>
      <input name="workspaceId" type="hidden" value={workspaceId} />
      <input name="redirectPath" type="hidden" value={redirectPath} />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="field">
          <label htmlFor="projectId">{tr("Project scope")}</label>
          <select id="projectId" name="projectId" onChange={handleProjectChange} value={projectId}>
            <option value="">{tr("Workspace wide")}</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {formatProjectOptionLabel(project, locale)}
              </option>
            ))}
          </select>
        </div>

        <div className="field gap-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="environmentId">{tr("Environment")}</label>
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">{tr("Optional.")}</span>
          </div>
          <select
            id="environmentId"
            name="environmentId"
            onChange={handleEnvironmentChange}
            value={environmentId}
          >
            <option value="">{tr("No environment override")}</option>
            {availableEnvironments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {formatEnvironmentOptionLabel(environment, locale)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_98%,var(--surface-canvas)_2%)] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {tr("Scope preview")}
            </p>
            <p className="text-sm font-medium text-foreground">{scopePreview}</p>
          </div>
          {archivedScopeNote ? (
            <p className="max-w-lg text-[12px] text-muted-foreground md:text-right">{archivedScopeNote}</p>
          ) : null}
        </div>
      </div>

      {hasScopeConflict ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">{tr("An active policy already exists for this scope.")}</p>
          <p className="mt-1 text-[13px] text-amber-900/90">
            {tr("Choose another project or environment before creating a new policy.")}
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="field">
          <label htmlFor="monthlyUsdLimit">{tr("Hard limit (USD)")}</label>
          <input
            id="monthlyUsdLimit"
            name="monthlyUsdLimit"
            type="number"
            min="0.01"
            step="0.01"
            defaultValue="100"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="softLimitPercent">{tr("Soft threshold (%)")}</label>
          <input
            id="softLimitPercent"
            name="softLimitPercent"
            type="number"
            min="1"
            max="100"
            step="1"
            defaultValue="80"
            required
          />
        </div>
      </div>

      <div className="flex justify-end">
        <PendingSubmitButton className="button" disabled={hasScopeConflict} pendingLabel={tr("Creating policy...")}>
          {tr("Create policy")}
        </PendingSubmitButton>
      </div>
    </form>
  );
}
