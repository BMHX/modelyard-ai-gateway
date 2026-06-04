"use client";

import { Link } from "@/i18n/navigation";

import { useT } from "@/app/lib/i18n-client";
import { cn } from "@/lib/utils";

import { describeNavigationTarget } from "../lib/navigation";

type NavigationContextNoticeProps = {
  returnTo?: string | null;
  headingPrefix: string;
  detailSuffix?: string;
  className?: string;
};

export function NavigationContextNotice({
  returnTo,
  headingPrefix,
  className,
}: NavigationContextNoticeProps) {
  const tr = useT();
  const currentTarget = describeNavigationTarget(returnTo);

  if (!currentTarget) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-3 py-2 text-[12px] text-muted-foreground",
        className,
      )}
    >
      <span className="font-medium uppercase tracking-[0.08em] text-muted-foreground/78">{tr(headingPrefix)}</span>
      <span aria-hidden="true">·</span>
      <Link className="font-medium text-foreground/78 transition-colors hover:text-foreground" href={currentTarget.href}>
        {tr(currentTarget.label)}
      </Link>
    </div>
  );
}
