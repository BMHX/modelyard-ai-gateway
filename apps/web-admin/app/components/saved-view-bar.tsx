"use client";

import { Link } from "@/i18n/navigation";
import { useEffect, useId, useMemo, useState } from "react";

import { useT } from "../lib/i18n-client";

import type { SavedViewSurface } from "@teamops/contracts";

import { cn } from "@/lib/utils";

import { ConfirmSubmitButton } from "./confirm-submit-button";
import { DisclosureSummary } from "./disclosure-summary";
import { PendingSubmitButton } from "./pending-submit-button";
import { ResourceInlineNotice } from "./resource-inline-notice";
import { getSafeReturnTo } from "../lib/navigation";

export type SavedViewBarItem = {
  id?: string;
  label: string;
  hint: string;
  href: string;
  onClick?: () => void;
  active: boolean;
  badgeLabel?: string;
};

export type SavedViewBarSection = {
  key: string;
  title: string;
  description?: string;
  items: SavedViewBarItem[];
  emptyMessage?: string;
  allowDelete?: boolean;
};

export type SavedViewBarNotice = {
  tone: "success" | "error";
  message: string;
};

export type SavedViewSaveConfig = {
  workspaceId: string;
  surface: SavedViewSurface;
  redirectPath: string;
  filtersJson: string;
  suggestedName: string;
};

const shellKey = (value: string) => `shell.${value}`;

export type SavedViewBarActiveConfig = {
  savedViewId: string;
  workspaceId: string;
  surface: SavedViewSurface;
  redirectPath: string;
  filtersJson: string;
  name: string;
  hint: string;
};

export function buildSavedViewOpenHref(savedViewId: string, nextHref: string) {
  const encodedSavedViewId = encodeURIComponent(savedViewId);
  const safeNextHref = getSafeReturnTo(nextHref);
  if (!safeNextHref) {
    return `/saved-views/${encodedSavedViewId}/open`;
  }

  const params = new URLSearchParams();
  params.set("next", safeNextHref);
  return `/saved-views/${encodedSavedViewId}/open?${params.toString()}`;
}

function trackSavedViewOpen(savedViewId: string, openHref: string) {
  void fetch(openHref, {
    method: "POST",
    keepalive: true,
    cache: "no-store",
  }).catch(() => undefined);
}

function removeSearchParam(href: string, key: string) {
  const url = new URL(href, "http://localhost");
  url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function SavedViewBar({
  title,
  description,
  sections,
  notice,
  saveConfig,
  activeConfig,
  createAction,
  updateAction,
  deleteAction,
  variant = "card",
}: {
  title: string;
  description?: string;
  sections: SavedViewBarSection[];
  notice?: SavedViewBarNotice | null;
  saveConfig?: SavedViewSaveConfig | null;
  activeConfig?: SavedViewBarActiveConfig | null;
  createAction?: (formData: FormData) => Promise<void>;
  updateAction?: (formData: FormData) => Promise<void>;
  deleteAction?: (formData: FormData) => Promise<void>;
  variant?: "card" | "strip";
}) {
  const totalViews = sections.reduce((sum, section) => sum + section.items.length, 0);
  const tr = useT();
  const hasActiveView = Boolean(activeConfig);
  const defaultOpen = Boolean(notice) || hasActiveView || totalViews === 0;
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const panelId = useId();
  const detailClass =
    variant === "strip"
      ? "disclosure-panel disclosure-panel--tool rounded-xl border border-border/45 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)]"
      : "disclosure-panel disclosure-panel--tool rounded-lg border border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)]";
  const blockClass = cn(
    "grid gap-3 p-3",
    variant === "strip"
      ? "rounded-xl border border-border/40 bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--surface-2)_6%)]"
      : "rounded-lg border border-border/55 bg-background/50",
  );

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
    }
  }, [defaultOpen]);

  const summaryText = useMemo(() => {
    if (hasActiveView) {
      return activeConfig?.name ?? description ?? tr(shellKey("savedViews.single"));
    }

    return description || tr(shellKey("savedViews.count"), {count: totalViews});
  }, [activeConfig?.name, description, hasActiveView, totalViews]);

  return (
    <details className={detailClass} open={isOpen}>
      <summary
        aria-controls={panelId}
        aria-expanded={isOpen}
        className="disclosure-panel__summary [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setIsOpen((current) => !current);
        }}
      >
        <DisclosureSummary
          description={summaryText}
          meta={tr(shellKey("savedViews.countShort"), {count: totalViews})}
          title={title}
          variant="tool"
        />
      </summary>

      <div
        className={cn(
          "space-y-4 border-t border-border/45",
          variant === "strip" ? "px-0 py-3" : "px-4 py-4",
        )}
        id={panelId}
      >
        {saveConfig && createAction ? (
          <div className={blockClass}>
            <div className="cell-stack">
              <strong>{tr(shellKey("savedViews.saveCurrent"))}</strong>
            </div>
            <form action={createAction} className="toolbar__row">
              <input name="workspaceId" type="hidden" value={saveConfig.workspaceId} />
              <input name="surface" type="hidden" value={saveConfig.surface} />
              <input name="redirectPath" type="hidden" value={saveConfig.redirectPath} />
              <input name="filtersJson" type="hidden" value={saveConfig.filtersJson} />
              <div className="field field--inline">
                <label htmlFor={`${saveConfig.surface}-saved-view-name`}>{tr(shellKey("savedViews.viewName"))}</label>
                <input
                  defaultValue={saveConfig.suggestedName}
                  id={`${saveConfig.surface}-saved-view-name`}
                  maxLength={120}
                  name="name"
                  placeholder={tr(shellKey("savedViews.namePlaceholder"))}
                />
              </div>
              <div className="toolbar__actions">
                <PendingSubmitButton
                  className="button button--ghost"
                  pendingLabel={tr(shellKey("savedViews.saving"))}
                >{tr(shellKey("savedViews.saveFilters"))}</PendingSubmitButton>
              </div>
            </form>
          </div>
        ) : null}
        {notice ? (
          <ResourceInlineNotice
            label={notice.tone === "error" ? tr(shellKey("savedViews.noticeError")) : tr(shellKey("savedViews.noticeSaved"))}
            message={notice.message}
            tone={notice.tone}
          />
        ) : null}
        {activeConfig && updateAction ? (
          <div className={blockClass}>
            <div className="cell-stack">
              <strong>{tr(shellKey("savedViews.current"))}</strong>
            </div>
            <form action={updateAction} className="toolbar__row">
              <input name="savedViewId" type="hidden" value={activeConfig.savedViewId} />
              <input name="workspaceId" type="hidden" value={activeConfig.workspaceId} />
              <input name="surface" type="hidden" value={activeConfig.surface} />
              <input name="redirectPath" type="hidden" value={activeConfig.redirectPath} />
              <input name="filtersJson" type="hidden" value={activeConfig.filtersJson} />
              <div className="field field--inline">
                <label htmlFor={`${activeConfig.surface}-active-saved-view-name`}>{tr(shellKey("savedViews.viewName"))}</label>
                <input
                  defaultValue={activeConfig.name}
                  id={`${activeConfig.surface}-active-saved-view-name`}
                  maxLength={120}
                  name="name"
                  placeholder={tr(shellKey("savedViews.renamePlaceholder"))}
                />
              </div>
              <div className="toolbar__actions">
                <PendingSubmitButton
                  className="button button--ghost"
                  pendingLabel={tr(shellKey("savedViews.updating"))}
                >{tr(shellKey("savedViews.updateCurrent"))}</PendingSubmitButton>
              </div>
            </form>
            <p className="meta">{activeConfig.hint}</p>
          </div>
        ) : null}

        {sections.map((section) => (
          <div className={blockClass} key={section.key}>
            <div className="filter-section__header">
              <div className="cell-stack">
                <strong>{section.title}</strong>
                {section.description ? <span className="meta">{section.description}</span> : null}
              </div>
            </div>
            {section.items.length ? (
              <div className="quick-view-grid" role="list">
                {section.items.map((view) => {
                  const savedViewId = view.id ?? null;
                  const openHref = savedViewId
                    ? buildSavedViewOpenHref(savedViewId, view.href)
                    : view.href;
                  const handleClick = savedViewId
                    ? () => trackSavedViewOpen(savedViewId, openHref)
                    : undefined;

                  return (
                    <div
                      className={`quick-view${view.active ? " quick-view--active" : ""}`}
                      key={`${section.key}-${view.id ?? view.label}`}
                      role="listitem"
                    >
                      {view.onClick ? (
                        <button
                          aria-current={view.active ? "page" : undefined}
                          className="text-left"
                          onClick={view.onClick}
                          type="button"
                        >
                          <strong>{view.label}</strong>
                          <span className="meta">{view.hint}</span>
                          {view.badgeLabel ? <span className="tag">{view.badgeLabel}</span> : null}
                        </button>
                      ) : (
                        <Link
                          aria-current={view.active ? "page" : undefined}
                          href={openHref}
                          onClick={handleClick}
                          prefetch={view.id ? false : undefined}
                        >
                          <strong>{view.label}</strong>
                          <span className="meta">{view.hint}</span>
                          {view.badgeLabel ? <span className="tag">{view.badgeLabel}</span> : null}
                        </Link>
                      )}
                      {section.allowDelete && deleteAction && view.id ? (
                        <form action={deleteAction} className="inline-actions">
                          <input name="savedViewId" type="hidden" value={view.id} />
                          <input name="savedViewName" type="hidden" value={view.label} />
                          <input
                            name="redirectPath"
                            type="hidden"
                            value={
                              activeConfig?.savedViewId === view.id
                                ? removeSearchParam(
                                    saveConfig?.redirectPath ?? view.href,
                                    "savedViewId",
                                  )
                                : saveConfig?.redirectPath ?? view.href
                            }
                          />
                          <input name="workspaceId" type="hidden" value={saveConfig?.workspaceId ?? ""} />
                          <input name="surface" type="hidden" value={saveConfig?.surface ?? ""} />
                          <ConfirmSubmitButton
                            aria-label={tr(shellKey("savedViews.deleteAria"), {name: view.label})}
                            className="button button--ghost button--micro"
                            confirmDescription={tr(shellKey("savedViews.deleteDescription"))}
                            confirmLabel={tr(shellKey("savedViews.deleteLabel"))}
                            confirmTitle={tr(shellKey("savedViews.deleteTitle"), {name: view.label})}
                            pendingLabel={tr(shellKey("savedViews.deleting"))}
                          >{tr(shellKey("savedViews.delete"))}</ConfirmSubmitButton>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="meta">{section.emptyMessage ?? tr(shellKey("savedViews.empty"))}</p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
