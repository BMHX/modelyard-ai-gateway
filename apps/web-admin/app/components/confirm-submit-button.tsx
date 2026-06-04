"use client";

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

import { translateInlineText } from "@/app/lib/i18n";
import { usePathLocale } from "@/app/lib/i18n-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "type"
> & {
  children: ReactNode;
  pendingLabel?: ReactNode;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export function ConfirmSubmitButton({
  cancelLabel,
  children,
  className,
  confirmDescription,
  confirmLabel,
  confirmTitle,
  disabled,
  formAction,
  formNoValidate,
  name,
  pendingLabel,
  value,
  ...props
}: ConfirmSubmitButtonProps) {
  const locale = usePathLocale();
  const hiddenSubmitRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const status = useFormStatus();
  const resolvedCancelLabel = cancelLabel ?? translateInlineText(locale, "Cancel");
  const resolvedConfirmLabel = confirmLabel ?? translateInlineText(locale, "Confirm");
  const currentAction = "action" in status ? status.action : undefined;
  const isOwnPending =
    status.pending && (formAction ? currentAction === formAction : true);
  const canForwardName = typeof formAction !== "function";

  useEffect(() => {
    if (status.pending) {
      setOpen(false);
    }
  }, [status.pending]);

  return (
    <>
      <button
        {...props}
        aria-busy={isOwnPending || undefined}
        className={className}
        disabled={disabled || status.pending}
        onClick={() => setOpen(true)}
        type="button"
      >
        {isOwnPending && pendingLabel ? pendingLabel : children}
      </button>

      <button
        aria-hidden="true"
        className="hidden"
        formAction={formAction}
        formNoValidate={formNoValidate}
        ref={hiddenSubmitRef}
        tabIndex={-1}
        type="submit"
        value={value}
        {...(canForwardName && name ? { name } : {})}
      />

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} type="button" variant="ghost">
              {resolvedCancelLabel}
            </Button>
            <Button
              onClick={() => hiddenSubmitRef.current?.click()}
              type="button"
              variant="destructive"
            >
              {resolvedConfirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
