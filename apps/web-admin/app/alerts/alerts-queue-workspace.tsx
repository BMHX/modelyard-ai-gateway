"use client";

import { Link } from "@/i18n/navigation";
import { memo, useMemo, useState } from "react";
import enAlertsMessages from "../messages/en/alerts.json";
import zhAlertsMessages from "../messages/zh/alerts.json";
import { translateInlineText, type AppLocale } from "../lib/i18n";

import type { AlertCollaborationState } from "../components/alert-collaboration-panel";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  batchUpdateAlertsAction,
  reopenAlertAction,
  resolveAlertAction,
  updateAlertCollaborationAction,
} from "./actions";

type TranslationValues = Record<string, string | number | undefined>

function formatMessage(template: string, values?: TranslationValues) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function resolveAlertMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  if (exact && typeof exact === "object" && "" in exact && typeof (exact as Record<string, unknown>)[""] === "string") {
    return (exact as Record<string, string>)[""];
  }

  const nested = key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return null;
    }
    return (current as Record<string, unknown>)[part];
  }, messages);

  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object" && "" in nested && typeof (nested as Record<string, unknown>)[""] === "string") {
    return (nested as Record<string, string>)[""];
  }
  return null;
}

function createAlertsTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhAlertsMessages : enAlertsMessages) as Record<string, unknown>;
  return (text: string, values?: TranslationValues) => {
    const fallback = typeof values?.default === "string" ? values.default : text;
    const template = resolveAlertMessage(messages, text) ?? translateInlineText(locale, fallback);
    return formatMessage(template, values);
  };
}

function getAckTagState(ackState: AlertCollaborationState["ackState"]) {
  if (ackState === "resolved") {
    return {
      className: "tag tag--resolved",
      label: "resolved",
    } as const;
  }

  if (ackState === "needs-ack") {
    return {
      className: "tag tag--critical",
      label: "needs ack",
    } as const;
  }

  return {
    className: "tag tag--warning",
    label: "acknowledged",
  } as const;
}

function getSlaTagClassName(tone: AlertCollaborationState["slaTone"]) {
  if (tone === "critical") {
    return "tag tag--critical";
  }
  if (tone === "warning") {
    return "tag tag--warning";
  }
  if (tone === "resolved") {
    return "tag tag--resolved";
  }
  return "tag";
}

function getSeverityTagClassName(severity: AlertQueueRow["severity"]) {
  if (severity === "critical") {
    return "inline-filter-link tag--critical";
  }

  if (severity === "warning") {
    return "inline-filter-link tag--warning";
  }

  return "inline-filter-link";
}

type AlertQueueNotice = {
  className: string;
  title: string;
  body: string;
} | null;

type AlertQueueRow = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  code: string;
  codeLabel: string;
  status: "open" | "resolved";
  createdAtLabel: string;
  resolvedAtLabel: string | null;
  scopeLabel: string;
  scopeMeta: string;
  ageClassName: string;
  ageLabel: string;
  ageSummary: string;
  showAgeBadge: boolean;
  escalationClassName: string;
  escalationLabel: string;
  escalationSummary: string;
  isEscalationRisk: boolean;
  isUnassigned: boolean;
  needsAck: boolean;
  detailHref: string;
  usageHref: string;
  budgetHref: string;
  auditHref: string;
  scopePivotHref: string;
  onScopePivot?: () => void;
  ownerPivotHref: string;
  severityPivotHref: string;
  onSeverityPivot?: () => void;
  codePivotHref: string;
  onCodePivot?: () => void;
  statusPivotHref: string;
  onStatusPivot?: () => void;
  collaboration: AlertCollaborationState & {
    slaDueAt: string;
  };
};

const AlertQueueCollaborationCell = memo(function AlertQueueCollaborationCell({
  redirectPath,
  row,
  tr,
}: {
  redirectPath: string;
  row: AlertQueueRow;
  tr: (text: string, values?: TranslationValues) => string;
}) {
  const ackTag = getAckTagState(row.collaboration.ackState);
  const statusLine = `${tr("collaboration.notes", {
    count: row.collaboration.noteCount,
  })} · ${row.collaboration.lastUpdatedLabel}`;

  return (
    <div className="flex min-w-0 flex-col gap-2 py-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p
            className="truncate text-sm font-semibold text-foreground"
            title={row.collaboration.ownerHint ?? row.collaboration.ownerLabel}
          >
            {row.collaboration.ownerLabel || tr("No owner")}
          </p>
          <p className="truncate text-[12px] leading-5 text-muted-foreground" title={statusLine}>{statusLine}</p>
        </div>
        <span className={ackTag.className}>{tr(ackTag.label)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] leading-5">
        {row.collaboration.slaLabel ? (
          <span className={getSlaTagClassName(row.collaboration.slaTone)}>{row.collaboration.slaLabel}</span>
        ) : null}
        <Link
          className="truncate font-medium text-muted-foreground transition-colors hover:text-foreground"
          href={row.collaboration.runbookHref}
        >
          {row.collaboration.runbookLabel}
        </Link>
        <Link
          className="truncate font-medium text-muted-foreground transition-colors hover:text-foreground"
          href={row.collaboration.ticketHref}
        >
          {row.collaboration.ticketLabel}
        </Link>
        {row.status === "open" && row.collaboration.ackState === "needs-ack" ? (
          <form action={updateAlertCollaborationAction}>
            <input name="alertId" type="hidden" value={row.id} />
            <input name="redirectPath" type="hidden" value={redirectPath} />
            <input name="ackState" type="hidden" value="acknowledged" />
            <input name="ownerLabel" type="hidden" value={row.collaboration.ownerLabel} />
            <input name="note" type="hidden" value={row.collaboration.latestNote ?? ""} />
            <input name="slaDueAt" type="hidden" value={row.collaboration.slaDueAt} />
            <input name="runbookHref" type="hidden" value={row.collaboration.runbookHref} />
            <input name="runbookLabel" type="hidden" value={row.collaboration.runbookLabel} />
            <input name="ticketHref" type="hidden" value={row.collaboration.ticketHref} />
            <input name="ticketLabel" type="hidden" value={row.collaboration.ticketLabel} />
            <button className="font-medium text-foreground transition-colors hover:text-primary" type="submit">
              {tr("Acknowledge")}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
});

const AlertQueueTableRow = memo(function AlertQueueTableRow({
  isSelected,
  onToggleSelection,
  redirectPath,
  row,
  tr,
}: {
  isSelected: boolean;
  onToggleSelection: (alertId: string) => void;
  redirectPath: string;
  row: AlertQueueRow;
  tr: (text: string, values?: TranslationValues) => string;
}) {
  return (
    <tr className={isSelected ? "table-row-selected" : undefined}>
      <td className="align-top">
        <input
          aria-label={tr("Select alert {title}", { title: row.title })}
          checked={isSelected}
          onChange={() => onToggleSelection(row.id)}
          type="checkbox"
        />
      </td>
      <td className="align-top">
        <div className="grid gap-2 py-1">
          <div className="flex flex-wrap items-center gap-2.5">
            {row.onSeverityPivot ? (
              <button className={getSeverityTagClassName(row.severity)} onClick={row.onSeverityPivot} type="button">
                {tr(row.severity)}
              </button>
            ) : (
              <a className={getSeverityTagClassName(row.severity)} href={row.severityPivotHref}>
                {tr(row.severity)}
              </a>
            )}
            <Link className="detail-link" href={row.detailHref}>
              <strong className="text-[15px] font-semibold leading-6 text-foreground">{tr(row.title)}</strong>
            </Link>
            {row.status === "resolved" ? (
              row.onStatusPivot ? (
                <button
                  className="inline-filter-link tag--resolved"
                  onClick={row.onStatusPivot}
                  title={row.resolvedAtLabel ?? undefined}
                  type="button"
                >
                  {tr(row.status)}
                </button>
              ) : (
                <a className="inline-filter-link tag--resolved" href={row.statusPivotHref} title={row.resolvedAtLabel ?? undefined}>
                  {tr(row.status)}
                </a>
              )
            ) : null}
          </div>
          <p className="max-w-[56ch] truncate text-[13px] leading-5 text-muted-foreground" title={tr(row.body)}>
            {tr(row.body)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {row.onCodePivot ? (
              <button
                className="inline-filter-link inline-filter-link--subtle"
                onClick={row.onCodePivot}
                title={row.code}
                type="button"
              >
                {row.codeLabel}
              </button>
            ) : (
              <a className="inline-filter-link inline-filter-link--subtle" href={row.codePivotHref} title={row.code}>
                {row.codeLabel}
              </a>
            )}
            {row.isEscalationRisk ? <span className={row.escalationClassName}>{row.escalationLabel}</span> : null}
            {row.showAgeBadge ? <span className={row.ageClassName} title={row.ageSummary}>{row.ageLabel}</span> : null}
          </div>
        </div>
      </td>
      <td className="align-top">
        <div className="grid gap-1.5 py-1">
          {row.onScopePivot ? (
            <button className="truncate text-left text-sm font-medium text-foreground transition-colors hover:text-primary" onClick={row.onScopePivot} type="button">
              {tr(row.scopeLabel)}
            </button>
          ) : (
            <a className="truncate text-sm font-medium text-foreground transition-colors hover:text-primary" href={row.scopePivotHref}>
              {tr(row.scopeLabel)}
            </a>
          )}
          <span className="text-[12px] leading-5 text-muted-foreground">{tr(row.scopeMeta)}</span>
        </div>
      </td>
      <td className="align-top">
        <AlertQueueCollaborationCell redirectPath={redirectPath} row={row} tr={tr} />
      </td>
      <td className="align-top">
        <div className="flex flex-col items-start gap-2 py-1">
          <form action={row.status === "open" ? resolveAlertAction : reopenAlertAction}>
            <input name="alertId" type="hidden" value={row.id} />
            <input name="redirectPath" type="hidden" value={redirectPath} />
            <button className="button button--ghost button--micro" type="submit">
              {row.status === "open" ? tr("Resolve") : tr("Reopen")}
            </button>
          </form>
          <Link className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground whitespace-nowrap" href={row.detailHref}>
            {tr("Open triage")}
          </Link>
        </div>
      </td>
    </tr>
  );
});

export function AlertsQueueWorkspace({
  rows,
  allAlertsCount,
  currentViewSummary,
  redirectPath,
  queueActionNotice,
  locale,
}: {
  rows: AlertQueueRow[];
  allAlertsCount: number;
  currentViewSummary: string;
  redirectPath: string;
  queueActionNotice: AlertQueueNotice;
  locale: AppLocale;
}) {
  const tr = createAlertsTranslator(locale);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ownerLabel, setOwnerLabel] = useState("");

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIdSet.has(row.id)),
    [rows, selectedIdSet],
  );
  const selectedOpenCount = selectedRows.filter((row) => row.status === "open").length;
  const selectedCriticalCount = selectedRows.filter((row) => row.severity === "critical").length;
  const selectedNeedsAckCount = selectedRows.filter((row) => row.needsAck).length;
  const visibleCriticalIds = rows.filter((row) => row.severity === "critical").map((row) => row.id);
  const visibleUrgentIds = rows
    .filter((row) => row.status === "open" && (row.isEscalationRisk || row.needsAck || row.severity === "critical"))
    .map((row) => row.id);
  const showCurrentViewSummary = currentViewSummary !== tr("All alerts");

  function toggleSelection(alertId: string) {
    setSelectedIds((current) => (current.includes(alertId) ? current.filter((id) => id !== alertId) : [...current, alertId]));
  }

  function setSelection(nextIds: string[]) {
    setSelectedIds(Array.from(new Set(nextIds)));
  }

  return (
    <article className="card span-8" id="alert-table">
      <div className="summary-row">
        <p>
          {tr("Showing {count} of {total} alerts", { count: rows.length, total: allAlertsCount })}
        </p>
        {showCurrentViewSummary ? <p className="meta">{currentViewSummary}</p> : null}
      </div>

      {queueActionNotice ? (
        <div className={queueActionNotice.className}>
          <div className="cell-stack">
            <strong>{queueActionNotice.title}</strong>
            <span className="meta">{queueActionNotice.body}</span>
          </div>
        </div>
      ) : null}

      {rows.length ? (
        <>
          <div
            className={`resource-table-selection-bar mb-4 flex flex-col gap-3 px-4 py-3${
              selectedIds.length ? " resource-table-selection-bar--active" : ""
            }`}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="cell-stack">
                <div className="badge-row">
                  <span className="tag">{selectedIds.length ? tr("{count} selected", { count: selectedIds.length }) : tr("No selection")}</span>
                  <span className="tag">{tr("{count} open", { count: rows.filter((row) => row.status === "open").length })}</span>
                </div>
                {selectedIds.length ? (
                  <p className="resource-table-selection-bar__detail text-sm">
                    {tr("Selected summary: {open} open · {critical} critical · {needsAck} need ack", {
                      open: selectedOpenCount,
                      critical: selectedCriticalCount,
                      needsAck: selectedNeedsAckCount,
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setSelection(rows.map((row) => row.id))} size="sm" type="button" variant="outline">
                  {tr("Select visible")}
                </Button>
                <Button onClick={() => setSelection(visibleUrgentIds)} size="sm" type="button" variant="outline">
                  {tr("Select urgent")}
                </Button>
                <Button onClick={() => setSelection(visibleCriticalIds)} size="sm" type="button" variant="outline">
                  {tr("Select critical")}
                </Button>
                {selectedIds.length ? (
                  <Button onClick={() => setSelection([])} size="sm" type="button" variant="ghost">
                    {tr("Clear")}
                  </Button>
                ) : null}
              </div>
            </div>

            {selectedIds.length ? (
              <form action={batchUpdateAlertsAction} className="border-t border-border/55 pt-3" id="alerts-batch-form">
                <input type="hidden" name="redirectPath" value={redirectPath} />
                {selectedIds.map((alertId) => (
                  <input key={alertId} name="alertIds" type="hidden" value={alertId} />
                ))}

                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-1 flex-col gap-3 xl:max-w-2xl xl:flex-row xl:items-center">
                    <label className="text-sm font-medium text-foreground xl:shrink-0" htmlFor="batch-owner-label">
                      {tr("Owner label")}
                    </label>
                    <input
                      className="h-10 w-full rounded-lg border border-input bg-[color:color-mix(in_srgb,var(--surface-2)_82%,var(--surface-1)_18%)] px-3.5 text-sm text-foreground outline-none transition-[border-color,background-color,color] placeholder:text-muted-foreground focus-visible:border-primary/55 focus-visible:bg-[color:color-mix(in_srgb,var(--surface-2)_76%,var(--primary-soft)_24%)] focus-visible:ring-2 focus-visible:ring-ring/35"
                      id="batch-owner-label"
                      name="ownerLabel"
                      onChange={(event) => setOwnerLabel(event.currentTarget.value)}
                      placeholder={tr("Owner label placeholder")}
                      value={ownerLabel}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button disabled={!ownerLabel.trim()} name="batchIntent" type="submit" value="assign">
                      {tr("Assign selected")}
                    </Button>
                    <Button name="batchIntent" type="submit" value="ack" variant="outline">
                      {tr("Acknowledge selected")}
                    </Button>
                    <Button name="batchIntent" type="submit" value="resolve" variant="outline">
                      {tr("Resolve selected")}
                    </Button>
                    <Button onClick={() => setSelection([])} size="sm" type="button" variant="ghost">
                      {tr("Clear selection")}
                    </Button>
                  </div>
                </div>
              </form>
            ) : null}
          </div>

          <div className="table-wrap legacy-resource-table-wrap">
            <table className="table legacy-resource-table">
              <thead>
                <tr>
                  <th className="w-[44px]">{tr("Select")}</th>
                  <th className="min-w-[360px]">{tr("Alert")}</th>
                  <th>{tr("Scope")}</th>
                  <th className="min-w-[200px]">{tr("Collaboration")}</th>
                  <th className="w-[1%] min-w-[110px] whitespace-nowrap">{tr("Action")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <AlertQueueTableRow
                    isSelected={selectedIdSet.has(row.id)}
                    key={row.id}
                    onToggleSelection={toggleSelection}
                    redirectPath={redirectPath}
                    row={row}
                    tr={tr}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState
          action={
            <Button onClick={() => setSelection([])} size="sm" type="button" variant="outline">
              {tr("Clear selection")}
            </Button>
          }
          compact
          description={tr("No alerts match.")}
          title={tr("Nothing matches this queue view")}
        />
      )}
    </article>
  );
}
