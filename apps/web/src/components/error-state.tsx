"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The one way this app says "that read failed".
export interface ErrorStateProps {
  title: string
  /** Why, from the error. Omitted when there is nothing useful to add. */
  detail?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({
  title,
  detail,
  onRetry,
  className,
}: Readonly<ErrorStateProps>) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-start gap-3 text-sm", className)}
    >
      <div className="space-y-1">
        <p className="text-destructive font-medium">{title}</p>
        {detail ? <p className="text-muted-foreground">{detail}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}
