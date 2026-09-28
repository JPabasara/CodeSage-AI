"use client"

import {
  CircleHelp,
  FolderGit2,
  History,
  LayoutDashboard,
  Play,
  SlidersHorizontal,
} from "lucide-react"

import { PageHeader } from "@/components/layout/page-header"
import {
  TOUR_SECTIONS,
  TOUR_SECTION_LABELS,
  type TourSection,
  useProductTour,
} from "@/components/tour/product-tour"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const SECTION_ICONS: Record<TourSection, typeof LayoutDashboard> = {
  workspace: CircleHelp,
  projects: FolderGit2,
  dashboard: LayoutDashboard,
  profiles: SlidersHorizontal,
  history: History,
}

export default function SupportPage() {
  const { startTour } = useProductTour()

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="New User Trial"
        description="Replay the complete guided tour, or learn only the part you need."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Take the complete tour</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Follow the same short path shown to a new user: workspace, projects,
            first scan, results, profiles, and history.
          </p>
          <Button onClick={() => startTour("full")}>
            <Play /> Start full trial
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="choose-lesson" className="space-y-3">
        <div>
          <h2 id="choose-lesson" className="text-base font-semibold">
            Learn one section
          </h2>
          <p className="text-sm text-muted-foreground">
            Choose only what you need. Each lesson uses a few short steps.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOUR_SECTIONS.map((section) => {
            const Icon = SECTION_ICONS[section]
            return (
              <Button
                key={section}
                aria-label={`Learn ${TOUR_SECTION_LABELS[section]}`}
                variant="outline"
                className="h-auto justify-start gap-3 p-4 text-left"
                onClick={() => startTour(section)}
              >
                <Icon className="size-5 text-primary" />
                <span>
                  <span className="block font-medium">
                    {TOUR_SECTION_LABELS[section]}
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Start this lesson
                  </span>
                </span>
              </Button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
