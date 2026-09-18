import type { Metadata } from "next"

// As with Projects: a Client Component page cannot export metadata, so the
// title lives in a pass-through layout beside it.
export const metadata: Metadata = { title: "Scoring profiles" }

export default function ProfilesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
