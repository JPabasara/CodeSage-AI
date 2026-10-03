import type { Metadata } from "next"

// The page itself is a Client Component and so cannot export metadata.
export const metadata: Metadata = { title: "Projects" }

export default function ProjectsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
