"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * A main action this role cannot take: shown disabled, with the reason on
 * hover and on keyboard focus.
 *
 * A disabled button takes neither pointer nor focus, so the caption hangs on a
 * focusable wrapper. Admin-only and destructive controls are hidden instead —
 * this is only for actions worth knowing exist.
 */
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
