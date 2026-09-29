import type { Metadata } from "next"

export const metadata: Metadata = { title: "Product Guide" }

export default function ProductGuideLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
