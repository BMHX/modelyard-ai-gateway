"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

type PendingSubmitButtonProps = Omit<ButtonProps, "children" | "type"> & {
  children: ReactNode;
  pendingLabel?: ReactNode;
};

export function PendingSubmitButton({
  children,
  disabled,
  formAction,
  name,
  pendingLabel,
  value,
  variant,
  size,
  className,
  ...props
}: PendingSubmitButtonProps) {
  const status = useFormStatus();
  const currentAction = "action" in status ? status.action : undefined;
  const isOwnPending =
    status.pending && (formAction ? currentAction === formAction : true);
  const canForwardName = typeof formAction !== "function";

  return (
    <Button
      {...props}
      variant={variant}
      size={size}
      className={className}
      aria-busy={isOwnPending || undefined}
      disabled={disabled || status.pending}
      formAction={formAction}
      {...(canForwardName && name ? { name } : {})}
      type="submit"
      value={value}
    >
      {isOwnPending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
