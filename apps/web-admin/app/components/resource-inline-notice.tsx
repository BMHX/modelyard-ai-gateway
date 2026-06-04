import { forwardRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type ResourceInlineNoticeProps = {
  label?: string;
  message: string;
  detail?: ReactNode;
  actions?: ReactNode;
  tone?: "success" | "error" | "warning";
  className?: string;
};

const toneClassNameByTone = {
  success:
    "border-success/16 bg-success/[0.06] text-[color:var(--success-strong)]",
  warning:
    "border-warning/18 bg-warning/[0.06] text-[color:var(--warning-strong)]",
  error:
    "border-destructive/18 bg-destructive/[0.06] text-[var(--destructive-strong)]",
} as const;

export const ResourceInlineNotice = forwardRef<HTMLDivElement, ResourceInlineNoticeProps>(
  function ResourceInlineNotice(
    {
      label,
      message,
      detail,
      actions,
      tone = "success",
      className,
    },
    ref,
  ) {
    const resolvedLabel = label ?? tone;

    return (
      <div
        aria-live={tone === "error" ? "assertive" : "polite"}
        className={cn(
          "inline-notice rounded-xl border px-3 py-2.5 text-sm motion-surface",
          toneClassNameByTone[tone],
          className,
        )}
        ref={ref}
        role={tone === "error" ? "alert" : "status"}
        tabIndex={-1}
      >
        <div className="space-y-1.5">
          <strong className="text-[10px] font-semibold uppercase tracking-[0.12em]">
            {resolvedLabel}
          </strong>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[13px] leading-5 text-muted-foreground">{message}</p>
            {detail ? (
              <div className="text-[12px] leading-5 text-muted-foreground">
                {detail}
              </div>
            ) : null}
            {actions ? <div className="pt-1">{actions}</div> : null}
          </div>
        </div>
      </div>
    );
  },
);

ResourceInlineNotice.displayName = "ResourceInlineNotice";
