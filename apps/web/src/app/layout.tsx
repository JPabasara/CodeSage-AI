import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { cn } from "@/lib/utils"
import { MswProvider } from "@/components/msw-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { SkipLink } from "@/components/layout/skip-link"
import { Toaster } from "@/components/ui/sonner"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  // A template, so each route says where it is and the product name still ends every tab.
  title: {
    default: "CodeSage AI",
    template: "%s | CodeSage AI",
  },
  description:
    "Find the technical debt in a repository, and rank it by what your team " +
    "actually cares about.",
  icons: {
    icon: [{ url: "/codesage-favicon.svg", type: "image/svg+xml" }],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
      )}
    >
      <body className="min-h-full flex flex-col">
        <SkipLink />
        <ThemeProvider
          // `class`, because globals.css keys its dark palette off `.dark`.
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <MswProvider>{children}</MswProvider>
          {/* Inside the provider: <Toaster> reads useTheme(). */}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
