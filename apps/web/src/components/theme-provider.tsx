"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

// Mounts next-themes for the whole app.
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
