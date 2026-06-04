"use client";

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { DisclosureSummaryVariant } from "./disclosure-summary";

type LazyDisclosureSectionProps = {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
  bodyClassName?: string;
  variant?: DisclosureSummaryVariant;
  defaultOpen?: boolean;
  persistMount?: boolean;
  unmountOnClose?: boolean;
  deferBodyVisibility?: boolean;
  compactDeferred?: boolean;
};

export function LazyDisclosureSection({
  summary,
  children,
  className,
  summaryClassName,
  bodyClassName,
  variant = "section",
  defaultOpen = false,
  persistMount = true,
  unmountOnClose = false,
  deferBodyVisibility = false,
  compactDeferred = false,
}: LazyDisclosureSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [hasMountedBody, setHasMountedBody] = useState(defaultOpen);
  const closeTimeoutRef = useRef<number | null>(null);
  const shouldPersistMount = persistMount && !unmountOnClose;
  const disclosureId = useId();
  const bodyId = `${disclosureId}-body`;

  useEffect(() => {
    if (defaultOpen) {
      setHasMountedBody(true);
    }
  }, [defaultOpen]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const shouldRenderBody = useMemo(
    () => isOpen || hasMountedBody || !shouldPersistMount,
    [hasMountedBody, isOpen, shouldPersistMount],
  );

  function handleSummaryClick(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    setIsOpen((current) => {
      const next = !current;
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      if (next) {
        setHasMountedBody(true);
      } else if (unmountOnClose) {
        closeTimeoutRef.current = window.setTimeout(() => {
          setHasMountedBody(false);
          closeTimeoutRef.current = null;
        }, 260);
      }
      return next;
    });
  }

  return (
    <details
      className={cn("disclosure-panel", `disclosure-panel--${variant}`, className)}
      open={isOpen}
    >
      <summary
        aria-controls={bodyId}
        aria-expanded={isOpen}
        className={cn(
          "disclosure-panel__summary cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          summaryClassName,
        )}
        onClick={handleSummaryClick}
      >
        {summary}
      </summary>
      {shouldRenderBody ? (
        <div
          aria-busy={deferBodyVisibility && !isOpen ? true : undefined}
          className={cn(
            "disclosure-panel__body",
            deferBodyVisibility && "deferred-secondary-panel",
            deferBodyVisibility && compactDeferred && "deferred-secondary-panel--compact",
            bodyClassName,
          )}
          data-state={isOpen ? "open" : "closed"}
          id={bodyId}
          role="region"
        >
          <div className="disclosure-panel__body-inner">{children}</div>
        </div>
      ) : null}
    </details>
  );
}
