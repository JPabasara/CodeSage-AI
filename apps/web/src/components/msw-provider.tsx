"use client"

import { useEffect, useState } from "react"

// Starts the MSW browser worker before rendering the app, but ONLY when
// NEXT_PUBLIC_API_MOCKING === "enabled". This is the single on/off switch for
// the fake backend: Phase 12 flips the env flag to turn it off — no code edits.
//
// Why gate the children: if the app rendered first, its data hooks could fire a
// fetch() before the worker is intercepting, and that request would escape to
// the real network (and fail). We wait until the worker is ready, then render.
export function MswProvider({ children }: { children: React.ReactNode }) {
  const on = process.env.NEXT_PUBLIC_API_MOCKING === "enabled"

  // When mocking is off, there is nothing to wait for → render immediately.
  const [ready, setReady] = useState(!on)

  useEffect(() => {
    if (!on) return
    let active = true
    // Dynamic import so msw/browser is never bundled into the production build
    // when mocking is off.
    import("@/lib/mocks/browser")
      .then(({ worker }) => worker.start({ onUnhandledRequest: "bypass" }))
      .catch((err) => {
        // Don't trap the app behind a broken worker — render anyway.
        console.error("[MSW] worker failed to start", err)
      })
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [on])

  return ready ? <>{children}</> : null
}
