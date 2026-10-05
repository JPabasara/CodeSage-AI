"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"

import { cn } from "@/lib/utils"

/** Pixels per second for the slide, so a long name moves no faster than a short one. */
const SLIDE_SPEED = 40

/**
 * "Scan <branch>" that never outgrows its button. A branch name too long for
 * the button's maximum width is clipped with a fade. Hovering or focusing the
 * button slides it along to show the rest (not under reduced motion). The full
 * name stays in the text, so the button's accessible name is unchanged.
 */
export function ScanButtonLabel({ branch }: Readonly<{ branch?: string }>) {
  const clipRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)

  useEffect(() => {
    const clip = clipRef.current
    const text = textRef.current
    if (!clip || !text) return
    const measure = () =>
      setShift(Math.max(0, text.scrollWidth - clip.clientWidth))
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(clip)
    return () => observer.disconnect()
  }, [branch])

  if (!branch) return <span>Scan</span>

  const overflows = shift > 0
  const slide = {
    "--branch-shift": `${shift}px`,
    "--branch-slide-time": `${Math.max(2, shift / SLIDE_SPEED + 1)}s`,
  } as CSSProperties

  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="shrink-0">Scan</span>
      {/* A real space, so the button's name reads "Scan main", not "Scanmain". */}{" "}
      <span
        ref={clipRef}
        data-overflows={overflows || undefined}
        className={cn(
          "min-w-0 overflow-hidden",
          overflows &&
            "mask-[linear-gradient(to_right,black_80%,transparent)] group-hover/button:mask-none group-focus-visible/button:mask-none",
        )}
      >
        <span
          ref={textRef}
          style={overflows ? slide : undefined}
          className={cn(
            "inline-block whitespace-nowrap",
            overflows &&
              "motion-safe:group-hover/button:animate-[branch-slide_var(--branch-slide-time)_ease-in-out_infinite_alternate] motion-safe:group-focus-visible/button:animate-[branch-slide_var(--branch-slide-time)_ease-in-out_infinite_alternate]",
          )}
        >
          {branch}
        </span>
      </span>
    </span>
  )
}
