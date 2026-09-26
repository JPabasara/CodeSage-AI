"use client"

import { useEffect, useState } from "react"

import { pickLine } from "@/lib/scan-messages"

/** How long each friendly line stays up: long enough to read it unhurried. */
export const LINE_ROTATE_MS = 15_000

/**
 * One line from `pool`, replaced at random every {@link LINE_ROTATE_MS}.
 *
 * `poolKey` names the pool (the stage, plus whether it is slow). When it
 * changes, a line from the new pool shows at once rather than at the next tick,
 * so a stage change is never captioned by the previous stage.
 */
export function useRotatingLine(
  pool: readonly string[],
  poolKey: string,
  random: () => number = Math.random,
) {
  const [state, setState] = useState(() => ({
    key: poolKey,
    line: pickLine(pool, undefined, random),
  }))

  // A new pool: switch during render, the way React recommends for state
  // derived from props, so no frame shows the old stage's line.
  let current = state
  if (state.key !== poolKey) {
    current = { key: poolKey, line: pickLine(pool, state.line, random) }
    setState(current)
  }

  useEffect(() => {
    const id = setInterval(() => {
      setState((previous) => ({
        key: previous.key,
        line: pickLine(pool, previous.line, random),
      }))
    }, LINE_ROTATE_MS)
    return () => clearInterval(id)
    // `pool` follows `poolKey`; `random` is fixed per caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey])

  return current.line
}
