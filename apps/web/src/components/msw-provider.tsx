"use client"

import { useEffect, useState } from "react"

// Starts the MSW worker before rendering the app, and only when mocking is on.
export function MswProvider({ children }: { children: React.ReactNode }) {
  const mocking = process.env.NEXT_PUBLIC_API_MOCKING
  const on = mocking === "enabled" || mocking === "e2e"

  const [ready, setReady] = useState(!on)

  useEffect(() => {
    if (!on) return
    let active = true
    // Dynamic import so msw/browser is never bundled into the production build when mocking is off.
    import("@/lib/mocks/browser")
      .then(({ worker }) => worker.start({ onUnhandledRequest: "bypass" }))
      .catch((err) => {
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
