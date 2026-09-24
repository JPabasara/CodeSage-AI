import { cn } from "@/lib/utils"

/**
 * The one page heading: a title on the page itself, not inside a card.
 *
 * `context` sits right after the title in quieter text — the project a page is
 * about, say — so it reads as part of the heading rather than a second one.
 * `aside` holds what belongs beside the heading: a few figures, or the page's
 * main action.
 */
export function PageHeader({
  title,
  context,
  description,
  aside,
  className,
}: Readonly<{
  title: React.ReactNode
  context?: React.ReactNode
  description?: React.ReactNode
  aside?: React.ReactNode
  className?: string
}>) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {context ? (
            <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              {context}
            </div>
          ) : null}
        </div>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {aside ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">{aside}</div>
      ) : null}
    </header>
  )
}
