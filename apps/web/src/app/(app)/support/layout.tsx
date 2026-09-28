import type { Metadata } from "next"

export const metadata: Metadata = { title: "New User Trial" }

export default function SupportLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
