import { cn } from "@/lib/utils"

export function SkipLink({
  targetId = "main-content",
  children = "Skip to main content",
}: Readonly<{
  targetId?: string
  children?: React.ReactNode
}>) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        "sr-only focus:not-sr-only",
        "focus:fixed focus:left-4 focus:top-4 focus:z-50",
        "focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground",
        "focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
      )}
    >
      {children}
    </a>
  )
}
