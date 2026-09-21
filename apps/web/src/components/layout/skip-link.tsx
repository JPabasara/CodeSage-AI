"use client"

export type SkipLinkProps = {
  /** The target element id to jump to. Defaults to 'main-content'. */
  targetId?: string
}

export function SkipLink({ targetId = "main-content" }: Readonly<SkipLinkProps>) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      Skip to content
    </a>
  )
}
