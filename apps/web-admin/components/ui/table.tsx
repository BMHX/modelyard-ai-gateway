import * as React from "react";

import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-x-auto bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] [scrollbar-width:thin]">
    <table className={cn("w-max min-w-full caption-bottom text-[13px] leading-5", className)} ref={ref} {...props} />
  </div>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead className={cn("[&_tr]:border-b [&_tr]:border-[color:var(--border-default)]", className)} ref={ref} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody className={cn("[&_tr:last-child]:border-0", className)} ref={ref} {...props} />,
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot className={cn("border-t border-border/60 bg-secondary/30 font-medium [&>tr]:last:border-b-0", className)} ref={ref} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr
    className={cn(
      "border-b border-border/55 transition-colors hover:bg-[color:color-mix(in_srgb,var(--surface-2)_82%,var(--surface-1)_18%)] data-[state=selected]:bg-[color:color-mix(in_srgb,var(--surface-selected)_72%,var(--surface-1)_28%)] data-[state=selected]:hover:bg-[color:color-mix(in_srgb,var(--surface-selected)_72%,var(--surface-1)_28%)]",
      className,
    )}
    ref={ref}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      className={cn(
        "h-10 bg-[color:color-mix(in_srgb,var(--surface-2)_76%,var(--surface-1)_24%)] px-3.5 text-left align-bottom text-[12px] font-semibold tracking-[0.02em] text-[color:var(--text-2)] whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td className={cn("px-3.5 py-3 align-top text-[13px] leading-5 text-foreground [&:has([role=checkbox])]:pr-0", className)} ref={ref} {...props} />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => <caption className={cn("mt-4 text-sm text-muted-foreground", className)} ref={ref} {...props} />,
);
TableCaption.displayName = "TableCaption";

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
