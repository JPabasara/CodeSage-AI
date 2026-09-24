import type { Metadata } from "next"

// The page is a Client Component and cannot export metadata itself.
export const metadata: Metadata = { title: "Accept invitation" }

export default function AcceptInvitationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
