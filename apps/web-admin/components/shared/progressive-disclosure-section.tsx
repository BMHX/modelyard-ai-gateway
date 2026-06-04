"use client"

import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

interface ProgressiveDisclosureSectionProps {
  title?: string
  description?: string
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}

export function ProgressiveDisclosureSection({
  title = "Advanced Settings",
  description,
  children,
  defaultOpen = false,
  className,
}: ProgressiveDisclosureSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn("w-full space-y-2 rounded-lg border p-4", className)}
    >
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium leading-none">{title}</h4>
          {description && (
            <p className="text-sm text-muted-foreground mt-1.5">
              {description}
            </p>
          )}
        </div>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="sr-only">Toggle {title}</span>
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-4 pt-2">
        <div className="h-px bg-border my-4" />
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
