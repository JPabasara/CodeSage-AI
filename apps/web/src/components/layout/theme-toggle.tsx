"use client"

import { useSyncExternalStore } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { SidebarMenuButton } from "@/components/ui/sidebar"

// "Has this rendered in a browser yet?" as a store that never changes: the
// server snapshot is false, the client snapshot is true, and nothing ever
// notifies. React asks the right one on each side by itself.
//
// This is the hydration guard rather than `useState` + `useEffect`, which would
// be setting state during an effect purely to answer a question React can
// already answer. The lint rule that forbids that is right.
const NEVER_CHANGES = () => () => {}
const ON_THE_CLIENT = () => true
const ON_THE_SERVER = () => false

/**
 * The FR-22 theme switch, in the rail's account area beside Sign out.
 *
 * Two states, not three. The app starts on the operating system's setting, and
 * pressing this makes an explicit choice that is then remembered — which is what
 * FR-22 asks for. A visible "System" option would be a third thing to explain
 * for a case that is already the default.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  // The server cannot know which theme this browser will land on, so the first
  // render here has to match the server's or React reports a mismatch. This
  // delays the real answer until hydration is done.
  //
  // What that costs is a *label* correcting itself, never a page flashing white:
  // next-themes puts the class on <html> from an inline script that runs before
  // first paint, so the colours are right immediately.
  const hydrated = useSyncExternalStore(
    NEVER_CHANGES,
    ON_THE_CLIENT,
    ON_THE_SERVER,
  )

  const isDark = hydrated && resolvedTheme === "dark"
  const target = isDark ? "light" : "dark"
  const label = isDark ? "Light mode" : "Dark mode"
  const Icon = isDark ? Sun : Moon

  return (
    <SidebarMenuButton
      onClick={() => setTheme(target)}
      tooltip={label}
      // The visible text names the destination, which the icon already implies.
      // Said aloud, "Dark mode, button" does not tell you whether pressing turns
      // it on or off, so the accessible name spells the action out.
      aria-label={`Switch to ${target} mode`}
    >
      <Icon />
      <span>{label}</span>
    </SidebarMenuButton>
  )
}
