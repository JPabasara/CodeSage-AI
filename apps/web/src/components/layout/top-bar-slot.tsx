"use client"

import { createContext, useContext, useState } from "react"
import { createPortal } from "react-dom"

// Places in the top bar that a page can fill with its own controls.
//
// The dashboard's branch selector and Scan button belong in the app bar, but
// their state belongs to the dashboard — it knows the branch, the scan and the
// report. A portal lets the controls render up there while staying in the
// dashboard's React tree: same state, same context, no lifting.

export type TopBarSlotName = "context" | "actions"

type Slots = Record<TopBarSlotName, HTMLElement | null>
type SlotSetters = Record<TopBarSlotName, (node: HTMLElement | null) => void>

const SlotsContext = createContext<{ slots: Slots; set: SlotSetters } | null>(
  null,
)

export function TopBarSlotProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [context, setContext] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  return (
    <SlotsContext.Provider
      value={{
        slots: { context, actions },
        set: { context: setContext, actions: setActions },
      }}
    >
      {children}
    </SlotsContext.Provider>
  )
}

/** Where the top bar hosts a page's controls. Empty until a page fills it. */
export function TopBarSlot({
  name,
  className,
}: Readonly<{ name: TopBarSlotName; className?: string }>) {
  const slots = useContext(SlotsContext)
  return (
    <div
      ref={slots?.set[name]}
      data-top-bar-slot={name}
      className={className}
    />
  )
}

/**
 * Render `children` into a top-bar slot.
 *
 * Outside the app shell — a component test, say — there is no top bar, so the
 * controls render in place instead of disappearing.
 */
export function TopBarPortal({
  name,
  children,
}: Readonly<{ name: TopBarSlotName; children: React.ReactNode }>) {
  const slots = useContext(SlotsContext)
  if (!slots) return children
  const target = slots.slots[name]
  return target ? createPortal(children, target) : null
}
