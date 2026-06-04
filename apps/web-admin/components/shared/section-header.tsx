import type * as React from "react";

import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function SectionHeader({ eyebrow, title, description, actions, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="grid gap-1">
        {eyebrow ? <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/72">{eyebrow}</span> : null}
        <h2 className="text-[14px] font-semibold leading-5 tracking-[-0.015em] text-foreground">{title}</h2>
        {description ? <p className="max-w-[40rem] text-[12.5px] leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}
