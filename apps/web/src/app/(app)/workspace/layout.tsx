import type { Metadata } from "next"

export const metadata: Metadata = { title: "Workspace" }

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
