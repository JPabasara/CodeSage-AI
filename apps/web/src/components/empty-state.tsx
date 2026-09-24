import { cn } from "@/lib/utils"

/**
 * Nothing here yet, and what to do next. Not an error and not a lock — those
 * are `ErrorState` and the locked cards.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: Readonly<{
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}>) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <span
          className="mb-1 text-muted-foreground [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}
