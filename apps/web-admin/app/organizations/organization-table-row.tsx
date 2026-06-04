"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type OrganizationTableRowProps = {
  children: React.ReactNode;
  href: string;
  isFocused?: boolean;
  id?: string;
};

export function OrganizationTableRow({
  children,
  href,
  isFocused,
  id,
}: OrganizationTableRowProps) {
  const router = useRouter();

  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'button, a, input, select, textarea, summary, [role="button"], [data-no-row-navigation="true"]',
      )
    ) {
      return;
    }

    router.push(href);
  }

  return (
    <TableRow
      id={id}
      onClick={handleRowClick}
      className={cn(
        "group transition-colors cursor-pointer hover:bg-muted/40",
        isFocused && "bg-primary/5 border-primary/20 hover:bg-primary/5"
      )}
    >
      {children}
    </TableRow>
  );
}
