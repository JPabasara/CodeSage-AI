import type { Metadata } from "next"

// As with Projects and Profiles: a Client Component page cannot export
// metadata, so the title lives in a pass-through layout beside it.
export const metadata: Metadata = { title: "Workspace" }

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
