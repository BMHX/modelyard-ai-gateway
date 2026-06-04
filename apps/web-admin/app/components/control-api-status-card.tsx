import type { ComponentProps, ReactNode } from "react";

import { AlertTriangle, ChevronDown, ServerCrash } from "lucide-react";

import { getT } from "@/app/lib/i18n-server";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { ControlApiIssue } from "../lib/control-api";

type ControlApiStatusSeverity = "critical" | "warning" | "setup" | "default";

type ControlApiStatusContent = {
  title: string;
  description: string;
  action: string | null;
  severity: ControlApiStatusSeverity;
  severityLabel: string;
};

const badgeStatusBySeverity: Record<ControlApiStatusSeverity, ComponentProps<typeof StatusBadge>["status"]> = {
  critical: "critical",
  warning: "warning",
  setup: "setup",
  default: "default",
};

const stripToneClassNameBySeverity: Record<ControlApiStatusSeverity, string> = {
  critical: "border-destructive/12 bg-[color:color-mix(in_srgb,var(--surface-2)_89%,var(--destructive-soft)_11%)]",
  warning: "border-warning/12 bg-[color:color-mix(in_srgb,var(--surface-2)_91%,var(--warning-soft)_9%)]",
  setup: "border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-1)_90%,var(--surface-canvas)_10%)]",
  default: "border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-1)_90%,var(--surface-canvas)_10%)]",
};

const accentToneClassNameBySeverity: Record<ControlApiStatusSeverity, string> = {
  critical: "bg-destructive",
  warning: "bg-warning/72",
  setup: "bg-foreground/28",
  default: "bg-foreground/18",
};

const iconToneClassNameBySeverity: Record<ControlApiStatusSeverity, string> = {
  critical: "text-destructive",
  warning: "text-warning/90",
  setup: "text-muted-foreground",
  default: "text-muted-foreground",
};

const summaryBadgeClassNameBySeverity: Record<ControlApiStatusSeverity, string> = {
  critical: "border-destructive/22 bg-destructive/[0.05] text-[var(--destructive-strong)]",
  warning: "border-warning/12 bg-warning/[0.035] font-normal text-foreground/74",
  setup: "border-border/42 bg-background/28 font-normal text-foreground/68",
  default: "border-border/40 bg-background/22 font-normal text-foreground/62",
};

const cardToneClassNameBySeverity: Record<ControlApiStatusSeverity, string> = {
  critical: "border-destructive/18 bg-[color:color-mix(in_srgb,var(--surface-2)_90%,var(--destructive-soft)_10%)]",
  warning: "border-warning/16 bg-[color:color-mix(in_srgb,var(--surface-2)_91%,var(--warning-soft)_9%)]",
  setup: "border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-2)_88%,var(--surface-1)_12%)]",
  default: "border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-2)_86%,var(--surface-1)_14%)]",
};

const cardIconToneClassNameBySeverity: Record<ControlApiStatusSeverity, string> = {
  critical: "border-destructive/22 bg-destructive/[0.08] text-[var(--destructive-strong)]",
  warning: "border-warning/18 bg-warning/[0.08] text-warning",
  setup: "border-[color:var(--border-subtle)] bg-background/40 text-muted-foreground",
  default: "border-[color:var(--border-subtle)] bg-background/36 text-muted-foreground",
};

const cardBadgeClassNameBySeverity: Record<ControlApiStatusSeverity, string> = {
  critical: "",
  warning: "border-warning/18 bg-warning/[0.03] font-normal text-foreground/72",
  setup: "border-border/52 bg-background/38 font-normal text-foreground/66",
  default: "border-border/45 bg-transparent font-normal text-foreground/60",
};

const detailToneClassNameBySeverity: Record<ControlApiStatusSeverity, string> = {
  critical: "border-destructive/12 bg-[color:color-mix(in_srgb,var(--surface-3)_84%,var(--destructive-soft)_16%)]",
  warning: "border-warning/12 bg-[color:color-mix(in_srgb,var(--surface-3)_86%,var(--warning-soft)_14%)]",
  setup: "border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-2)_74%,var(--surface-1)_26%)]",
  default: "border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-2)_68%,var(--surface-1)_32%)]",
};

function buildIssueContent(issue: ControlApiIssue): ControlApiStatusContent {
  if (issue.kind === "missing-auth") {
    return {
      title: "shell.statusCard.missingAuth.title",
      description: "shell.statusCard.missingAuth.description",
      action: "shell.statusCard.missingAuth.action",
      severity: "setup",
      severityLabel: "shell.statusCard.severity.setup",
    };
  }

  if (issue.kind === "missing-route" && issue.resource === "workspace-options") {
    return {
      title: "shell.statusCard.loading.title",
      description: "shell.statusCard.loading.description",
      action: "shell.statusCard.loading.action",
      severity: "default",
      severityLabel: "shell.statusCard.severity.notice",
    };
  }

  if (issue.kind === "missing-table") {
    return {
      title: "shell.statusCard.missingData.title",
      description: "shell.statusCard.missingData.description",
      action: "shell.statusCard.missingData.action",
      severity: "warning",
      severityLabel: "shell.statusCard.severity.notice",
    };
  }

  if (issue.kind === "unavailable") {
    return {
      title: "shell.statusCard.unavailable.title",
      description: "shell.statusCard.unavailable.description",
      action: "shell.statusCard.unavailable.action",
      severity: "critical",
      severityLabel: "shell.statusCard.severity.unavailable",
    };
  }

  return {
    title: "shell.statusCard.pageUnavailable.title",
    description: "shell.statusCard.pageUnavailable.description",
    action: "shell.statusCard.pageUnavailable.action",
    severity: "warning",
    severityLabel: "shell.statusCard.severity.notice",
  };
}

export async function ControlApiStatusCard({
  issue,
  heading,
  mode = "blocking",
  presentation = "card",
  detailsDefaultOpen = false,
  footer,
}: {
  issue: ControlApiIssue;
  heading?: string;
  mode?: "blocking" | "inline";
  presentation?: "card" | "summary-strip";
  detailsDefaultOpen?: boolean;
  footer?: ReactNode;
}) {
  const tr = await getT();
  const content = buildIssueContent(issue);
  const isBlocking = mode === "blocking";
  const icon = issue.kind === "unavailable" ? ServerCrash : AlertTriangle;
  const Icon = icon;
  const severity = content.severity;
  const badgeStatus = badgeStatusBySeverity[severity];

  if (presentation === "summary-strip") {
    return (
      <details
        aria-live="polite"
        className={cn(
          "group/status rounded-lg border px-3 py-2.5",
          stripToneClassNameBySeverity[severity],
        )}
        open={detailsDefaultOpen || undefined}
        role="status"
      >
        <summary className="cursor-pointer list-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
          <div className="flex items-start gap-3">
            <span className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center", iconToneClassNameBySeverity[severity])}>
              <Icon aria-hidden="true" className="size-3.5" />
            </span>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="hidden text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:inline">
                  {tr("Status")}
                </span>
                <StatusBadge
                  className={cn(
                    "min-h-5 px-2 py-0 text-[10px] shadow-none sm:text-[11px]",
                    summaryBadgeClassNameBySeverity[severity],
                  )}
                  indicator={severity === "critical"}
                  status={badgeStatus}
                >
                  {tr(content.severityLabel)}
                </StatusBadge>
              </div>

              <div className="space-y-1">
                <p className="text-[12.5px] font-medium leading-5 text-foreground sm:text-sm">{tr(content.title)}</p>
                <p className="hidden max-w-[72ch] text-[12px] leading-5 text-muted-foreground sm:block">
                  {tr(content.description)}
                </p>
              </div>
            </div>

            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <span className="hidden sm:inline">{tr("Details")}</span>
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 transition-transform duration-200 group-open/status:rotate-180"
              />
            </span>
          </div>
        </summary>

        <div className="mt-3 grid gap-3 border-t border-border/45 pt-3">
          <div className={cn("grid gap-2 rounded-xl border p-3", detailToneClassNameBySeverity[severity])}>
            <p className="text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">{tr(content.description)}</p>
            {content.action ? (
              <div className="flex items-start gap-2.5 text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
                <span className={cn("mt-2 size-1.5 rounded-full", accentToneClassNameBySeverity[severity])} />
                <span>{tr(content.action)}</span>
              </div>
            ) : null}
          </div>

          {footer ? <div className="flex flex-wrap gap-2">{footer}</div> : null}
        </div>
      </details>
    );
  }

  return (
    <Card
      className={cn(
        isBlocking && "span-12",
        cardToneClassNameBySeverity[severity],
      )}
    >
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "inline-flex size-10 items-center justify-center rounded-xl border",
                cardIconToneClassNameBySeverity[severity],
              )}
            >
              <Icon aria-hidden="true" className="size-5" />
            </span>
            <div className="grid gap-2">
              <CardTitle className="text-lg tracking-tight sm:text-xl">{tr(heading ?? content.title)}</CardTitle>
              <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-7">{tr(content.description)}</p>
            </div>
          </div>
          <StatusBadge
            className={cardBadgeClassNameBySeverity[severity]}
            indicator={severity === "critical"}
            status={badgeStatus}
          >
            {tr(content.severityLabel)}
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {content.action ? (
          <div className="flex items-start gap-3 text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
            <span className={cn("mt-2 size-1.5 rounded-full", accentToneClassNameBySeverity[severity])} />
            <span>{tr(content.action)}</span>
          </div>
        ) : null}

        {footer ? <div className="flex flex-wrap gap-2">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
