"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type CommandPaletteGroupItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  section: string;
  sectionLabel?: string;
  keywords: string;
  shortcutLabel?: string;
  action?: () => void;
};

type CommandPaletteGroup = {
  section: string;
  label: string;
  items: CommandPaletteGroupItem[];
};

export function AppShellCommandPalette({
  allowAutoFocus,
  emptyLabel,
  filterLabel,
  footerActions,
  groupedItems,
  onOpenChange,
  onSelectItem,
  open,
  placeholder,
  query,
  queryActionLabel,
  queryRunLabel,
  setQuery,
}: {
  allowAutoFocus: boolean;
  emptyLabel: string;
  filterLabel: string;
  footerActions: string[];
  groupedItems: CommandPaletteGroup[];
  onOpenChange: (open: boolean) => void;
  onSelectItem: (item: CommandPaletteGroupItem) => void;
  open: boolean;
  placeholder: string;
  query: string;
  queryActionLabel: string;
  queryRunLabel: string;
  setQuery: (query: string) => void;
}) {
  return (
    <CommandDialog onOpenChange={onOpenChange} open={open} title={placeholder}>
      <CommandInput
        autoFocus={allowAutoFocus}
        className="h-10 text-[13px]"
        onValueChange={setQuery}
        placeholder={placeholder}
        value={query}
      />
      <CommandList className="max-h-[340px]">
        <CommandEmpty>{emptyLabel}</CommandEmpty>
        {groupedItems.map((group) => (
          <CommandGroup heading={group.label} key={group.section}>
            {group.items.map((item) => (
              <CommandItem
                className="rounded-md px-3 py-1.5"
                key={item.id}
                keywords={[item.keywords]}
                onSelect={() => onSelectItem(item)}
                value={`${item.sectionLabel ?? item.section} ${item.label} ${item.description} ${item.keywords}`}
              >
                <div className="grid min-w-0 gap-0.5">
                  <span className="truncate text-[13px] font-medium">
                    {item.label}
                  </span>
                  <span className="truncate text-[10.5px] text-muted-foreground">
                    {item.description}
                  </span>
                </div>
                <CommandShortcut className="text-[10px]">
                  {item.shortcutLabel ??
                    (item.action ? queryRunLabel : queryActionLabel)}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-1)_84%,var(--surface-canvas)_16%)] px-3 py-2 text-[11px] text-muted-foreground">
        <span className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] px-2 py-1 font-medium text-foreground">
          / {filterLabel}
        </span>
        {footerActions.map((action, index) => (
          <span key={action}>
            {index > 0 ? "· " : ""}
            {action}
          </span>
        ))}
      </div>
    </CommandDialog>
  );
}
