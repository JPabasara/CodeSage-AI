"use client"

import { useEffect, useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** Lines of context above and below the finding. */
const CONTEXT = 2
/** A long range is cut here; the GitHub link shows the rest. */
const MAX_LINES = 14

// One request per file and commit for the whole session: the commit pins the content.
const files = new Map<string, Promise<string[]>>()

function fileLines(url: string) {
  let lines = files.get(url)
  if (!lines) {
    lines = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`excerpt ${response.status}`)
      return (await response.text()).split(/\r?\n/)
    })
    // A failure is not remembered, so a later visit can try again.
    lines.catch(() => files.delete(url))
    files.set(url, lines)
  }
  return lines
}

/** The lines a finding points at, read from the analysed commit on GitHub. */
export function CodeExcerpt({
  rawUrl,
  line,
  endLine,
}: Readonly<{ rawUrl: string; line: number; endLine?: number | null }>) {
  const [state, setState] = useState<{
    url: string
    lines?: string[]
    failed?: boolean
  }>({ url: rawUrl })

  // A new file starts from its own loading state, not the last file's lines.
  if (state.url !== rawUrl) setState({ url: rawUrl })

  useEffect(() => {
    let live = true
    fileLines(rawUrl).then(
      (lines) => live && setState({ url: rawUrl, lines }),
      () => live && setState({ url: rawUrl, failed: true }),
    )
    return () => {
      live = false
    }
  }, [rawUrl])

  // Private, moved or offline: the location and the GitHub link still say where.
  if (state.failed) return null

  if (!state.lines) {
    return (
      <div
        aria-hidden="true"
        className="space-y-2 rounded-md border bg-muted/60 px-3 py-3"
      >
        {[72, 88, 64, 80, 48].map((width) => (
          <Skeleton
            key={width}
            className="h-3"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    )
  }

  const last =
    endLine != null && Number.isSafeInteger(endLine) && endLine > line
      ? endLine
      : line
  const from = Math.max(1, line - CONTEXT)
  const to = Math.min(state.lines.length, last + CONTEXT, from + MAX_LINES - 1)
  if (from > state.lines.length) return null

  const shown = state.lines.slice(from - 1, to)
  return (
    // Focusable, so a long line can be scrolled sideways from the keyboard too.
    <figure
      aria-label={`Code at lines ${from} to ${to}`}
      tabIndex={0}
      className="overflow-x-auto rounded-md border bg-muted/60 py-2.5 font-mono text-[0.78125rem] leading-[1.65] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <pre>
        <code>
          {shown.map((text, index) => {
            const number = from + index
            const marked = number >= line && number <= last
            return (
              <div
                key={number}
                data-marked={marked || undefined}
                className={cn(
                  "px-3 whitespace-pre",
                  marked &&
                    "bg-[color-mix(in_oklab,hsl(var(--severity-high))_14%,transparent)]",
                )}
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-10 text-muted-foreground tabular-nums select-none"
                >
                  {number}
                </span>
                {text || " "}
              </div>
            )
          })}
        </code>
      </pre>
    </figure>
  )
}
