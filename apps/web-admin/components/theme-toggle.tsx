"use client";

import * as React from "react";
import { Check, LaptopMinimal, MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const themeOptions = [
  {
    value: "light",
    label: "Light",
    icon: SunMedium,
  },
  {
    value: "dark",
    label: "Dark",
    icon: MoonStar,
  },
  {
    value: "system",
    label: "System",
    icon: LaptopMinimal,
  },
] as const;

export function ThemeToggle() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const activeTheme = themeOptions.find((option) => option.value === theme) ?? themeOptions[1];
  const ActiveIcon = activeTheme.icon;
  const resolvedThemeLabel = resolvedTheme === "light" ? "Light" : "Dark";
  const buttonLabel = theme === "system" ? `System · ${resolvedThemeLabel}` : activeTheme.label;
  const buttonDescription =
    theme === "system"
      ? `Following your system appearance, currently ${resolvedThemeLabel.toLowerCase()}.`
      : `Using the ${activeTheme.label.toLowerCase()} theme.`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Change color theme"
          aria-live="polite"
          className="min-w-0 gap-2 rounded-full px-3"
          size="sm"
          title={buttonDescription}
          variant="outline"
        >
          <ActiveIcon className="size-4" />
          <span className="hidden sm:inline">{buttonLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {themeOptions.map((option) => {
          const OptionIcon = option.icon;
          const isActive = theme === option.value;
          const description =
            option.value === "system"
              ? `Match your device appearance. Currently ${resolvedThemeLabel}.`
              : `Always use ${option.label.toLowerCase()} mode.`;
          return (
            <DropdownMenuItem
              className="flex items-center gap-2"
              key={option.value}
              onClick={() => setTheme(option.value)}
            >
              <OptionIcon className="size-4" />
              <div className="grid flex-1 gap-0.5">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </div>
              <Check className={cn("size-4 text-[var(--primary-strong)] opacity-0 transition-opacity", isActive && "opacity-100")} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
