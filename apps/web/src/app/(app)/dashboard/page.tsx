import type { Metadata } from "next"

import { ProjectRedirect } from "@/components/projects/project-redirect"

export const metadata: Metadata = { title: "Dashboard" }

export default function DashboardIndex() {
  return <ProjectRedirect page="dashboard" />
}
