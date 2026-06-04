"use client";

import type { MouseEvent, PointerEvent, ReactNode } from "react";

import { Link } from "@/i18n/navigation";

type SummaryActionLinkProps = {
  href: string;
  className?: string;
  children: ReactNode;
};

export function SummaryActionLink({ href, className, children }: SummaryActionLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
  }

  function handlePointerDown(event: PointerEvent<HTMLAnchorElement>) {
    event.stopPropagation();
  }

  return (
    <Link className={className} href={href} onClick={handleClick} onPointerDown={handlePointerDown}>
      {children}
    </Link>
  );
}
