"use client";

import { Link } from "@/i18n/navigation";

import { cn } from "@/lib/utils";

type ReviewQueueStat = {
  label: string;
  value: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
};

type WorkspacesReviewQueueSummaryProps = {
  stats: ReviewQueueStat[];
  reviewQueueHref?: string;
  onReviewQueueOpen?: () => void;
  title: string;
  openLabel: string;
};

export function WorkspacesReviewQueueSummary({
  stats,
  reviewQueueHref,
  onReviewQueueOpen,
  title,
  openLabel,
}: WorkspacesReviewQueueSummaryProps) {
  if (!stats.length) {
    return null;
  }

  return (
    <section className="motion-enter motion-enter-fast motion-delay-1 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </p>
        {onReviewQueueOpen ? (
          <button
            className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={onReviewQueueOpen}
            type="button"
          >
            {openLabel}
          </button>
        ) : reviewQueueHref ? (
          <Link
            className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            href={reviewQueueHref}
          >
            {openLabel}
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {stats.map((stat) => {
          const className = cn(
            "inline-flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-[border-color,background-color,color]",
            stat.active
              ? "border-border bg-[color:color-mix(in_srgb,var(--surface-selected)_16%,var(--surface-1)_84%)] text-foreground"
              : "border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-canvas)_8%)] text-muted-foreground hover:border-border hover:text-foreground",
          );

          const content = (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {stat.label}
              </span>
              <strong className="text-[12.5px] font-semibold text-foreground">{stat.value}</strong>
            </>
          );

          if (stat.onClick) {
            return (
              <button
                aria-current={stat.active ? "page" : undefined}
                className={className}
                key={stat.label}
                onClick={stat.onClick}
                type="button"
              >
                {content}
              </button>
            );
          }

          return (
            <Link
              aria-current={stat.active ? "page" : undefined}
              className={className}
              href={stat.href ?? "#"}
              key={stat.label}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
