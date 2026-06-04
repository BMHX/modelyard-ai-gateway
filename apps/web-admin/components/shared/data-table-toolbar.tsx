import type * as React from "react";
import { Search } from "lucide-react";

import { SectionHeader } from "@/components/shared/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DataTableToolbarProps = {
  title?: string;
  description?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function DataTableToolbar({
  title,
  description,
  searchPlaceholder = "Search records",
  searchValue = "",
  onSearchChange,
  filters,
  actions,
  className,
}: DataTableToolbarProps) {
  return (
    <div
      className={cn(
        "grid gap-4 rounded-lg border border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-2)_78%,var(--surface-1)_22%)] p-4",
        className,
      )}
    >
      {title ? <SectionHeader description={description} title={title} /> : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(event) => onSearchChange?.(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              value={searchValue}
            />
          </div>
          {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions ?? (
            <Button size="sm" variant="outline">
              Configure view
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
