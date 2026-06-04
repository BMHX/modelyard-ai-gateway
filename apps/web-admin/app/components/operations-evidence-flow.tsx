import { Link } from "@/i18n/navigation";

import { cn } from "@/lib/utils";

export type OperationsEvidenceMetric = {
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "critical" | "resolved";
};

export type OperationsEvidenceLane = {
  eyebrow: string;
  title: string;
  href?: string | null;
  ctaLabel?: string | null;
  tone?: "neutral" | "warning" | "critical" | "resolved";
};

function getSignalClassName(tone: OperationsEvidenceMetric["tone"]) {
  if (tone === "critical") {
    return "border-destructive/24 bg-destructive/[0.08] text-[var(--destructive-strong)]";
  }

  if (tone === "warning") {
    return "border-warning/24 bg-warning/[0.08] text-[var(--warning-strong)]";
  }

  if (tone === "resolved") {
    return "border-success/24 bg-success/[0.08] text-[var(--success-strong)]";
  }

  return "border-border/70 bg-background/30 text-foreground";
}

function getLaneClassName(tone: OperationsEvidenceLane["tone"]) {
  if (tone === "critical") {
    return "border-destructive/22 bg-destructive/[0.06] hover:border-destructive/30 hover:bg-destructive/[0.09]";
  }

  if (tone === "warning") {
    return "border-warning/22 bg-warning/[0.06] hover:border-warning/30 hover:bg-warning/[0.09]";
  }

  if (tone === "resolved") {
    return "border-success/22 bg-success/[0.06] hover:border-success/30 hover:bg-success/[0.09]";
  }

  return "border-border/70 bg-background/24 hover:border-border/90 hover:bg-background/40";
}

export function OperationsEvidenceFlow({
  title,
  description,
  scopeLabel,
  scopeSummary,
  activeViewLabel,
  metrics,
  lanes,
  footer,
}: {
  title: string;
  description?: string | null;
  scopeLabel: string;
  scopeSummary: string;
  activeViewLabel: string;
  metrics: OperationsEvidenceMetric[];
  lanes: OperationsEvidenceLane[];
  footer?: string | null;
}) {
  return (
    <div className="operations-flow">
      <div className="space-y-1.5">
        <div className="cell-stack">
          <h2 className="text-[1.375rem] font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
          {description ? <p className="text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
      </div>

      <div className="rounded-[16px] border border-border/70 bg-background/24 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="cell-stack">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{scopeLabel}</span>
            <strong className="text-[15px] font-semibold leading-5 text-foreground">{scopeSummary}</strong>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-7 items-center rounded-full border border-border/70 bg-background/40 px-2.5 text-[11px] font-medium text-muted-foreground">
              {activeViewLabel}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {metrics.map((metric) => (
            <span
              key={metric.label}
              className={cn(
                "inline-grid min-h-9 grid-cols-[auto_auto] items-center gap-x-2 rounded-full border px-3",
                getSignalClassName(metric.tone),
              )}
            >
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{metric.label}</span>
              <strong className={cn("text-[13px] font-semibold", metric.value.length > 22 && "text-xs sm:text-[13px]")}>{metric.value}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {lanes.map((lane) => {
          const content = (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="grid gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{lane.eyebrow}</span>
                  <strong className="text-[15px] font-semibold leading-5 tracking-[-0.02em] text-foreground">{lane.title}</strong>
                </div>
                {lane.ctaLabel ? <span className="text-[11px] font-medium text-muted-foreground">{lane.ctaLabel}</span> : null}
              </div>
          </>
          );

          if (!lane.href) {
            return (
              <div
                key={`${lane.eyebrow}-${lane.title}`}
                className={cn(
                  "grid gap-2.5 rounded-[14px] border px-4 py-3",
                  getLaneClassName(lane.tone),
                )}
              >
                {content}
              </div>
            );
          }

          return (
            <Link
              key={`${lane.eyebrow}-${lane.title}`}
              className={cn(
                "grid gap-2.5 rounded-[14px] border px-4 py-3 transition-[border-color,background-color] duration-150",
                getLaneClassName(lane.tone),
              )}
              href={lane.href}
            >
              {content}
            </Link>
          );
        })}
      </div>

      {footer ? <p className="text-[13px] leading-5 text-muted-foreground">{footer}</p> : null}
    </div>
  );
}
