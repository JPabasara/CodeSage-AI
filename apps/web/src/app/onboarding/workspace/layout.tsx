import type { Metadata } from "next"

// The page is a Client Component and so cannot export metadata; a layout beside
// it can, and renders its children untouched.
export const metadata: Metadata = { title: "Create your workspace" }

export default function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
