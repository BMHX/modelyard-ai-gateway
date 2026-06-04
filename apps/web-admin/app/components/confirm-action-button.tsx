"use client";

import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

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

type ConfirmActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "type"
> & {
  children: ReactNode;
  pending?: boolean;
  pendingLabel?: ReactNode;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
};

export function ConfirmActionButton({
  cancelLabel,
  children,
  className,
  confirmDescription,
  confirmLabel,
  confirmTitle,
  disabled,
  onConfirm,
  pending = false,
  pendingLabel,
  ...props
}: ConfirmActionButtonProps) {
  const locale = usePathLocale();
  const [open, setOpen] = useState(false);
  const resolvedCancelLabel = cancelLabel ?? translateInlineText(locale, "Cancel");
  const resolvedConfirmLabel = confirmLabel ?? translateInlineText(locale, "Confirm");

  useEffect(() => {
    if (pending) {
      setOpen(false);
    }
  }, [pending]);

  return (
    <>
      <button
        {...props}
        aria-busy={pending || undefined}
        className={className}
        disabled={disabled || pending}
        onClick={() => setOpen(true)}
        type="button"
      >
        {pending && pendingLabel ? pendingLabel : children}
      </button>

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
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
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
