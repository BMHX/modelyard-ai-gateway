"use client";

import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ResourceCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showHeader?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  footerClassName?: string;
};

const sizeClassNameMap = {
  sm: "w-[min(92vw,30rem)]",
  md: "w-[min(92vw,42rem)]",
  lg: "w-[min(94vw,54rem)]",
  xl: "w-[min(96vw,76rem)]",
} as const;

export function ResourceCreateDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  showHeader = true,
  children,
  footer,
  className,
  bodyClassName,
  footerClassName,
}: ResourceCreateDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn(
          "flex max-h-[min(90vh,58rem)] flex-col overflow-hidden rounded-[2rem] border border-border bg-card p-0 text-foreground shadow-none",
          sizeClassNameMap[size],
          className,
        )}
      >
        {showHeader ? (
          <DialogHeader className="shrink-0 border-b border-border/40 bg-muted/20 px-8 py-6 pr-14">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
                {title}
              </DialogTitle>
              {description ? (
                <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
                  {description}
                </DialogDescription>
              ) : null}
            </div>
          </DialogHeader>
        ) : null}
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-8 py-6", bodyClassName)}>
          {children}
        </div>
        {footer ? (
          <div className={cn("shrink-0 border-t border-border/40 bg-card px-8 py-5", footerClassName)}>
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
