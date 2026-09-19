"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * Mounts next-themes for the whole app.
 *
 * It exists as its own file because it has to be a Client Component — the theme
 * comes from `localStorage` and the operating system, neither of which the
 * server can see — and the root layout is a Server Component that should stay
 * one. This wrapper is the only thing that crosses that line.
 *
 * Everything that reads the theme must be inside it, `<Toaster>` included: it
 * has called `useTheme()` since the day it was added, and with no provider above
 * it that call has always returned the default.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
