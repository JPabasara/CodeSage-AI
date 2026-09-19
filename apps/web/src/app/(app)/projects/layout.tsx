import type { Metadata } from "next"

// The page itself is a Client Component and so cannot export metadata. A layout
// alongside it can, and costs nothing — it renders its children untouched.
export const metadata: Metadata = { title: "Projects" }

export default function ProjectsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
