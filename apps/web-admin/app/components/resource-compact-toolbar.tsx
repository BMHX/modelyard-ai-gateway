"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { useT } from "@/app/lib/i18n-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CompactToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  filterCount?: number;
  onResetFilters?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function CompactToolbar({
  query,
  onQueryChange,
  placeholder = "Search...",
  filterCount = 0,
  onResetFilters,
  actions,
  children,
  className,
}: CompactToolbarProps) {
  const t = useT("shared");
  const [isFocused, setIsFocused] = useState(false);
  const [localQuery, setLocalQuery] = useState(query);
  const filterLabel = t("toolbar.filters");
  const refineResultsLabel = t("toolbar.refineResults");
  const resetAllFiltersLabel = t("toolbar.resetAllFilters");

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (localQuery.trim() !== query.trim()) {
        onQueryChange(localQuery);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [localQuery, onQueryChange, query]);

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4", className)}>
      <div className="flex flex-1 items-center gap-3">
        <div 
          className={cn(
            "relative flex h-9 items-center rounded-full border border-border/60 bg-muted/20 px-3 transition-all duration-300",
            isFocused ? "w-[280px] sm:w-[360px] border-primary/40 bg-card ring-2 ring-primary/10" : "w-[200px] sm:w-[260px]"
          )}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            className="h-full w-full border-none bg-transparent py-0 text-sm shadow-none focus-visible:ring-0"
            onBlur={() => setIsFocused(false)}
            onChange={(e) => setLocalQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            placeholder={placeholder}
            value={localQuery}
          />
          {localQuery && (
            <button 
              className="ml-1 text-muted-foreground hover:text-foreground"
              onClick={() => setLocalQuery("")}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {children && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                className={cn(
                  "h-9 gap-1.5 rounded-full px-4 shadow-none",
                  filterCount > 0 ? "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary" : "border-border/60"
                )} 
                variant="outline"
              >
                <SlidersHorizontal className="size-3.5" />
                <span className="text-xs font-medium">{filterLabel}</span>
                {filterCount > 0 && (
                  <Badge 
                    className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full border-none bg-primary px-0 text-[9px] tabular-nums text-primary-foreground"
                  >
                    {filterCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px] p-2">
              <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {refineResultsLabel}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="space-y-4 p-2">
                {children}
              </div>
              {onResetFilters && filterCount > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    className="justify-center text-[11px] font-medium text-primary hover:text-primary-strong focus:text-primary-strong"
                    onSelect={(e) => {
                      e.preventDefault();
                      onResetFilters();
                    }}
                  >
                    {resetAllFiltersLabel}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex items-center gap-2">
        {actions}
      </div>
    </div>
  );
}

export function FilterField({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-foreground/80">
        {label}
      </label>
      {children}
    </div>
  );
}
