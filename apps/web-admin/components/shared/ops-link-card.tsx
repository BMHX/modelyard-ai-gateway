import { ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";

type OpsTone = "critical" | "warning" | "neutral";

function getToneStatus(tone: OpsTone) {
  if (tone === "critical") {
    return "critical" as const;
  }

  if (tone === "warning") {
    return "warning" as const;
  }

  return "default" as const;
}

function getToneClassName(tone: OpsTone) {
  const baseClassName =
    "group relative overflow-hidden rounded-xl border p-4 text-left transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 motion-reduce:transition-none";

  if (tone === "critical") {
    return cn(
      baseClassName,
      "border-destructive/16 bg-[color:color-mix(in_srgb,var(--surface-1)_88%,var(--destructive-soft)_12%)] hover:border-destructive/24 hover:bg-[color:color-mix(in_srgb,var(--surface-1)_84%,var(--destructive-soft)_16%)]",
    );
  }

  if (tone === "warning") {
    return cn(
      baseClassName,
      "border-warning/16 bg-[color:color-mix(in_srgb,var(--surface-1)_90%,var(--warning-soft)_10%)] hover:border-warning/24 hover:bg-[color:color-mix(in_srgb,var(--surface-1)_86%,var(--warning-soft)_14%)]",
    );
  }

  return cn(
    baseClassName,
    "border-[color:var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-2)_4%)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-hover)]",
  );
}

export function OpsLinkCard({
  href,
  onClick,
  title,
  description,
  tone = "neutral",
  eyebrow,
  badge,
  ctaLabel = "Open",
  meta,
  icon: Icon,
  className,
}: {
  href: string;
  onClick?: () => void;
  title: string;
  description: string;
  tone?: OpsTone;
  eyebrow?: string;
  badge?: string;
  ctaLabel?: string;
  meta?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const classes = cn(getToneClassName(tone), className);
  const content = (
    <>
      {(eyebrow || badge) ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {eyebrow ? (
            <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {Icon ? <Icon className="size-3.5 text-[var(--primary)]" /> : null}
              {eyebrow}
            </span>
          ) : (
            <span />
          )}
          {badge ? <StatusBadge status={getToneStatus(tone)}>{badge}</StatusBadge> : null}
        </div>
      ) : null}

      <strong className="mt-2 block text-[14px] font-semibold leading-5 tracking-[-0.015em] text-foreground">{title}</strong>
      <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{description}</p>
      {meta ? <div className="mt-3 text-[12px] leading-5 text-muted-foreground">{meta}</div> : null}

      <div className="mt-4 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground">
        {ctaLabel}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5" />
      </div>
    </>
  );

  if (onClick) {
    return (
      <button className={classes} onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return (
    <Link className={classes} href={href}>
      {content}
    </Link>
  );
}
