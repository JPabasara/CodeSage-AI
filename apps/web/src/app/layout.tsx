import type { Metadata } from "next"
import { Geist, Geist_Mono, Inter } from "next/font/google"
import "./globals.css"
import { cn } from "@/lib/utils"
import { MswProvider } from "@/components/msw-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Code Sage AI",
  description:
    "Find the technical debt in a repository, and rank it by what your team " +
    "actually cares about.",
}

// Authentication state is cookie-backed and therefore request-specific.
export const dynamic = "force-dynamic"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      // next-themes writes `class="dark"` and `style="color-scheme"` onto this
      // element from an inline script that runs BEFORE React hydrates — that is
      // what stops the page painting light and then snapping to dark. The
      // server's HTML therefore cannot match what React finds here, and this
      // tells React that the difference is intended rather than a bug. It
      // applies to this element only, not to the tree below it.
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        inter.variable,
      )}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          // `class`, because globals.css keys its dark palette off `.dark`.
          attribute="class"
          // Follow the operating system until the user says otherwise. Someone
          // who runs their machine dark should not be handed a white screen.
          defaultTheme="system"
          enableSystem
          // Colours swap instantly instead of every transition on the page
          // animating at once, which looks like a fault rather than a setting.
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
