"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
    className={cn(
      "flex h-9 w-full items-center justify-between rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-2)_3%)] px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground transition-[border-color,background-color,color,box-shadow] hover:border-[color:var(--border-strong)] focus:border-[color:var(--primary-border-strong)] focus:bg-background disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className,
    )}
    ref={ref}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-4 opacity-60" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton className={cn("flex cursor-default items-center justify-center py-1", className)} ref={ref} {...props}>
    <ChevronUp className="size-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton className={cn("flex cursor-default items-center justify-center py-1", className)} ref={ref} {...props}>
    <ChevronDown className="size-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      className={cn(
        "ui-motion-panel relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--border-strong)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_98%,var(--surface-2)_2%)] text-popover-foreground shadow-none",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className,
      )}
      position={position}
      ref={ref}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label className={cn("px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground", className)} ref={ref} {...props} />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item
      className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-[13px] text-foreground outline-none transition-[background-color,color,box-shadow,font-weight] data-[highlighted]:bg-[color:color-mix(in_srgb,var(--surface-hover)_62%,var(--surface-selected)_38%)] data-[highlighted]:text-foreground data-[highlighted]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border-default)_78%,transparent)] data-[state=checked]:bg-[color:color-mix(in_srgb,var(--surface-selected)_26%,var(--surface-1)_74%)] data-[state=checked]:font-medium data-[state=checked]:text-foreground data-[state=checked]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary-border)_68%,transparent)] data-[highlighted][data-state=checked]:bg-[color:color-mix(in_srgb,var(--surface-selected)_36%,var(--surface-hover)_64%)] data-[highlighted][data-state=checked]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary-border-strong)_72%,transparent)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center text-[color:var(--primary-strong)]">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border/60", className)} ref={ref} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
