import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        className={cn(
          "flex h-[36px] w-full rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 py-2 text-[13px] text-foreground shadow-none transition-[border-color,box-shadow,background-color,color] outline-none placeholder:text-muted-foreground/68 hover:border-[color:var(--border-strong)] focus-visible:border-[color:var(--primary-border-strong)] focus-visible:bg-background disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[color:color-mix(in_srgb,var(--surface-2)_84%,var(--surface-1)_16%)] aria-[invalid=true]:border-[color:var(--destructive-border)] aria-[invalid=true]:bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--destructive-soft)_6%)] aria-[invalid=true]:focus-visible:border-[color:var(--destructive-strong)]",
          className,
        )}
        ref={ref}
        type={type}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
