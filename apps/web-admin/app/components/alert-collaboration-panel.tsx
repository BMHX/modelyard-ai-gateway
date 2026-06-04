"use client";

import { Link } from "@/i18n/navigation";
import { useT } from "@/app/lib/i18n-client";

export type AlertCollaborationState = {
  alertId: string;
  ownerLabel: string;
  ownerHint?: string | null;
  ackState: "needs-ack" | "acknowledged" | "resolved";
  slaLabel?: string | null;
  slaTone: "critical" | "warning" | "resolved" | null;
  noteCount: number;
  latestNote?: string | null;
  runbookHref: string;
  runbookLabel: string;
  ticketHref: string;
  ticketLabel: string;
  lastUpdatedLabel: string;
};

function getAckTag(ackState: AlertCollaborationState["ackState"]) {
  if (ackState === "resolved") {
    return {
      label: "resolved",
      className: "tag tag--resolved",
    };
  }

  if (ackState === "needs-ack") {
    return {
      label: "needs ack",
      className: "tag tag--critical",
    };
  }

  return {
    label: "acknowledged",
    className: "tag tag--warning",
  };
}

export function AlertCollaborationPanel({
  collaboration,
  variant = "compact",
}: {
  collaboration: AlertCollaborationState;
  variant?: "compact" | "detail";
}) {
  const tr = useT("alerts");
  const ackTag = getAckTag(collaboration.ackState);
  const statusLine = `${tr("collaboration.notes", {
    count: collaboration.noteCount,
  })} · ${collaboration.lastUpdatedLabel}`;

  if (variant === "compact") {
    return (
      <div className="stack stack--tight">
        <div className="badge-row">
          <span className={ackTag.className}>{tr(ackTag.label)}</span>
          <span className="tag" title={collaboration.ownerHint ?? ""}>{`${tr("Owner")} · ${collaboration.ownerLabel}`}</span>
          {collaboration.slaLabel ? (
            <span
              className={
                collaboration.slaTone === "critical" ? "tag tag--critical"
                : collaboration.slaTone === "warning" ? "tag tag--warning"
                : collaboration.slaTone === "resolved" ? "tag tag--resolved"
                : "tag"
              }
            >
              {collaboration.slaLabel}
            </span>
          ) : null}
        </div>
        <span className="meta">{statusLine}</span>
        <div className="inline-actions">
          <Link className="button button--ghost button--micro" href={collaboration.runbookHref}>
            {collaboration.runbookLabel}
          </Link>
          <Link className="button button--ghost button--micro" href={collaboration.ticketHref}>
            {collaboration.ticketLabel}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stack stack--tight rounded-lg border border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-2)_82%,var(--surface-1)_18%)] p-4">
      <div className="badge-row">
        <span className={ackTag.className}>{tr(ackTag.label)}</span>
        <span className="tag" title={collaboration.ownerHint ?? ""}>{`${tr("Owner")} · ${collaboration.ownerLabel}`}</span>
        {collaboration.slaLabel ? (
          <span
            className={
              collaboration.slaTone === "critical" ? "tag tag--critical"
              : collaboration.slaTone === "warning" ? "tag tag--warning"
              : collaboration.slaTone === "resolved" ? "tag tag--resolved"
              : "tag"
            }
          >
            {collaboration.slaLabel}
          </span>
        ) : null}
      </div>
      <span className="meta">{statusLine}</span>
      <div className="inline-actions">
        <Link className="button button--ghost button--micro" href={collaboration.runbookHref}>
          {collaboration.runbookLabel}
        </Link>
        <Link className="button button--ghost button--micro" href={collaboration.ticketHref}>
          {collaboration.ticketLabel}
        </Link>
      </div>
    </div>
  );
}
