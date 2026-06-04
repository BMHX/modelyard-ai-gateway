"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex min-h-8 items-center gap-0.5 rounded-full border border-[color:color-mix(in_srgb,var(--border-default)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-2)_4%)] p-0.5 text-muted-foreground",
      className,
    )}
    ref={ref}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    className={cn(
      "inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-transparent px-3 pb-0.5 pt-0 text-[12px] font-medium text-muted-foreground shadow-none transition-[color,border-color,background-color,box-shadow] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/16 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 data-[state=active]:border-[color:var(--border-default)] data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-none",
      className,
    )}
    ref={ref}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => <TabsPrimitive.Content className={cn("mt-3 outline-none", className)} ref={ref} {...props} />);
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
