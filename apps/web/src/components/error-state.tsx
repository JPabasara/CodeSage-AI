"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The one way this app says "that read failed".
 *
 * It exists because there were four of these, written four different ways, and
 * two of them had no Retry at all — so whether a failed screen was a dead end
 * depended on which screen you were standing on. One component means one answer.
 *
 * `title` is what failed in the user's words; `detail` is the API's sentence,
 * which per the contract is a curated message and never a stack trace (SEC-16).
 * They are separate nodes rather than one string so the reason can be styled
 * down — it is context, not the headline.
 */
export interface ErrorStateProps {
  /** What failed, in the user's words — "Couldn't load projects". */
  title: string
  /** Why, from the error. Omitted when there is nothing useful to add. */
  detail?: string
  /**
   * Omit only when there is genuinely nothing to retry. A failed read that
   * offers no way back is the state this component exists to prevent.
   */
  onRetry?: () => void
  /** Layout only — the caller owns where this sits on its page. */
  className?: string
}

export function ErrorState({
  title,
  detail,
  onRetry,
  className,
}: Readonly<ErrorStateProps>) {
  return (
    // role="alert" announces it when it replaces the skeleton. This is one of
    // the few places assertive is right: the thing the user was waiting for is
    // not coming, and they need to know now rather than at the end of a sentence.
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
