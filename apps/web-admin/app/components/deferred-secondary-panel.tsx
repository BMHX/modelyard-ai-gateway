import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DeferredSecondaryPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("deferred-secondary-panel", className)}>{children}</div>;
}
