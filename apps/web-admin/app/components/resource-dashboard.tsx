"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ResourceDashboardProps = {
  children: ReactNode;
  className?: string;
};

export function ResourceDashboard({
  children,
  className,
}: ResourceDashboardProps) {
  return (
    <section 
      className={cn(
        "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
        className
      )}
    >
      {children}
    </section>
  );
}

type ResourceDashboardCardProps = {
  children: ReactNode;
  className?: string;
};

export function ResourceDashboardCard({
  children,
  className,
}: ResourceDashboardCardProps) {
  return (
    <div 
      className={cn(
        "rounded-2xl border border-border/40 bg-card/40 p-4 backdrop-blur-sm transition-all hover:border-border/60",
        className
      )}
    >
      {children}
    </div>
  );
}
