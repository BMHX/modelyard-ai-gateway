"use client";

import {useEffect} from "react";
import {AlertTriangle} from "lucide-react";

import {Button} from "@/components/ui/button";

export default function ErrorPage({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="motion-enter flex min-h-[40vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--destructive-soft)_60%,var(--surface-1)_40%)]">
        <AlertTriangle className="size-5 text-[color:var(--destructive-strong)]" />
      </div>
      <div className="space-y-1.5">
        <p className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">Something went wrong</p>
        <p className="text-[13px] leading-5 text-muted-foreground">
          {error.digest ? `Error ID: ${error.digest}` : "An unexpected error occurred."}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
