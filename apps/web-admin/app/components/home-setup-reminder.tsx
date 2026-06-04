"use client";

import { startTransition, useState } from "react";

import { Link } from "@/i18n/navigation";

import { cn } from "@/lib/utils";

import { ResourceInlineNotice } from "./resource-inline-notice";
import { updateWorkspaceGuidePreferenceAction } from "./home-actions";

function GuideSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-2 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-background"
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative flex h-5 w-9 items-center rounded-full border transition-colors",
          checked
            ? "border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-selected)_82%,var(--surface-1)_18%)]"
            : "border-border/70 bg-background",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 size-4 rounded-full bg-foreground transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

export function HomeSetupReminder({
  activeLabel,
  href,
  initialGuideActive,
  nextText,
  openLabel,
  remainingText,
  title,
  workspaceId,
}: {
  activeLabel: string;
  href: string;
  initialGuideActive: boolean;
  nextText: string;
  openLabel: string;
  remainingText: string;
  title: string;
  workspaceId: string | null;
}) {
  const [isGuideActive, setIsGuideActive] = useState(initialGuideActive);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleCheckedChange(checked: boolean) {
    if (!workspaceId || isPending || checked === isGuideActive) {
      return;
    }

    const nextGuideActive = checked;
    setErrorMessage(null);
    setIsPending(true);
    setIsGuideActive(nextGuideActive);

    startTransition(async () => {
      const result = await updateWorkspaceGuidePreferenceAction({
        workspaceId,
        exited: !nextGuideActive,
      });

      setIsPending(false);

      if (result.status === "error") {
        setIsGuideActive(!nextGuideActive);
        setErrorMessage(result.message);
      }
    });
  }

  if (!isGuideActive) {
    return null;
  }

  return (
    <section className="space-y-2">
      {errorMessage ? (
        <ResourceInlineNotice
          label={activeLabel}
          message={errorMessage}
          tone="warning"
        />
      ) : null}
      <section className="motion-enter motion-enter-fast rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--warning-soft)_04%)] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[14px] font-semibold tracking-tight text-foreground">{title}</p>
            <p className="text-[13px] leading-5 text-muted-foreground">
              {remainingText} {nextText}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <GuideSwitch
              checked
              label={activeLabel}
              onCheckedChange={handleCheckedChange}
            />
            <Link
              aria-disabled={isPending}
              className={cn(
                "inline-flex items-center rounded-md border border-border/60 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-background",
                isPending && "pointer-events-none opacity-60",
              )}
              href={href}
            >
              {openLabel}
            </Link>
          </div>
        </div>
      </section>
    </section>
  );
}
