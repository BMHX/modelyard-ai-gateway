"use client";

import { useEffect, useState } from "react";

type CopyButtonProps = {
  value: string;
  label?: string;
  className?: string;
};

export function CopyButton({ value, label = "Copy", className = "" }: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setStatus("idle");
    }, 1600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [status]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <>
      <button
        aria-label={
          status === "copied"
            ? `${label} succeeded`
            : status === "error"
              ? `${label} failed, activate to retry`
              : label
        }
        className={`button button--ghost button--micro${className ? ` ${className}` : ""}`}
        onClick={handleCopy}
        type="button"
      >
        {status === "copied" ? "Copied" : status === "error" ? "Retry copy" : label}
      </button>
      <span aria-live="polite" className="visually-hidden">
        {status === "copied" ? `${label} copied to clipboard.` : status === "error" ? `Copy failed. Activate to retry.` : ""}
      </span>
    </>
  );
}
