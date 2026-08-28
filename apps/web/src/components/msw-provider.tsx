"use client"

import { useEffect, useState } from "react"

// Starts the MSW worker before rendering the app, and only when mocking is on.
// One env flag is the whole on/off switch for the fake backend.
//
// The children are gated because if the app rendered first, its data hooks could
// fetch before the worker was intercepting and escape to the real network.
export function MswProvider({ children }: { children: React.ReactNode }) {
  // "enabled" mocks the data endpoints; "e2e" additionally mocks auth so a
  // headless browser never has to complete an OIDC flow. See lib/mocks/browser.
  const mocking = process.env.NEXT_PUBLIC_API_MOCKING
  const on = mocking === "enabled" || mocking === "e2e"

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
