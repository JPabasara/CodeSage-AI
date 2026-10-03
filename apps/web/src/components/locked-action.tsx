"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// A main action this role cannot take: shown disabled, with the reason on hover and on keyboard focus.
export function LockedAction({
  reason,
  children,
}: Readonly<{ reason: string; children: React.ReactNode }>) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={reason}
            className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
