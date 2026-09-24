import type { Metadata } from "next"

import { ProjectRedirect } from "@/components/projects/project-redirect"

export const metadata: Metadata = { title: "Scan history" }

export default function ScanHistoryIndex() {
  return <ProjectRedirect page="history" />
}
