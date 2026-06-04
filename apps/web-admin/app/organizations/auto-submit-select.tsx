"use client";

import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type AutoSubmitSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function AutoSubmitSelect({ children, onChange, className, ...props }: AutoSubmitSelectProps) {
  return (
    <select
      {...props}
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 py-1.5 text-[13px] text-foreground outline-none transition-[border-color,background-color,color,box-shadow] hover:border-[color:var(--border-strong)] focus:border-[color:var(--primary-border-strong)] focus:bg-background disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      onChange={(e) => {
        onChange?.(e);
        e.currentTarget.form?.requestSubmit();
      }}
    >
      {children}
    </select>
  );
}
