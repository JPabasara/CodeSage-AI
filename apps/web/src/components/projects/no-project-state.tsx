"use client"

import Link from "next/link"
import { FolderGit2, Gauge, History, SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSession } from "@/hooks/use-session"
import { cn } from "@/lib/utils"

type NoProjectPage = "dashboard" | "history" | "override"

const COPY: Record<
  NoProjectPage,
  { icon: typeof Gauge; heading: string; body: string }
> = {
  dashboard: {
    icon: Gauge,
    heading: "Connect a repository to see its dashboard",
    body: "Each connected repository gets a health score, a file health map and a ranked list of what to refactor first.",
  },
  history: {
    icon: History,
    heading: "Connect a repository to see its scan history",
    body: "Every scan of a repository is kept, so you can compare its health over time.",
  },
  override: {
    icon: SlidersHorizontal,
    heading: "Connect a repository to give it its own profile",
    body: "A project override needs a project. Until then, everything uses the workspace default.",
  },
}

/** The one reason a role cannot connect, said where the button is. */
export const CONNECT_LOCKED_REASON =
  "Only org-admins and managers can connect repositories"

/**
 * A workspace with no repositories yet, on a page that is about one.
 *
 * Not an error. One sentence on what will be here, and the way to get there. A
 * role that cannot connect sees the button disabled with the reason, rather
 * than a button that fails or no way forward at all.
 */
export function NoProjectState({
  page,
  compact = false,
}: Readonly<{ page: NoProjectPage; compact?: boolean }>) {
  const { data: session } = useSession()
  const canConnect =
    session?.permissions?.includes("repository:connect") ?? false
  const { icon: Icon, heading, body } = COPY[page]
  const Heading = compact ? "h2" : "h1"

  return (
    <div
      className={cn(
        !compact &&
          "flex min-h-full items-start justify-center px-4 py-10 sm:py-16",
      )}
    >
      <section
        data-testid="no-project-state"
        className={cn(
          "w-full rounded-lg border bg-card p-6",
          compact ? "max-w-none" : "max-w-lg",
        )}
      >
        <span className="mb-4 flex size-10 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <Heading
          className={cn(
            "font-semibold tracking-tight",
            compact ? "text-[15px]" : "text-xl",
          )}
        >
          {heading}
        </Heading>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
        <div className="mt-5">
          {canConnect ? (
            <Button asChild>
              <Link href="/projects">
                <FolderGit2 aria-hidden="true" />
                Connect repository
              </Link>
            </Button>
          ) : (
            // A disabled button takes no pointer or focus, so the caption hangs
            // on a focusable wrapper instead.
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Button disabled aria-describedby="connect-locked-reason">
                    <FolderGit2 aria-hidden="true" />
                    Connect repository
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent id="connect-locked-reason">
                {CONNECT_LOCKED_REASON}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </section>
    </div>
  )
}
