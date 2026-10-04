"use client"

import Link from "next/link"
import {
  ArrowRight,
  ChevronRight,
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
import { PAGE_CONTAINER } from "@/components/layout/page-container"

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
    <div className={PAGE_CONTAINER}>
      <PageHeader
        title="New User Trial"
        description="Replay the complete guided tour, or learn only the part you need."
      />

      <section
        aria-labelledby="full-tour"
        className="flex flex-col gap-4 rounded-md border bg-card px-4.5 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="max-w-2xl">
          <h2
            id="full-tour"
            className="text-base font-semibold text-foreground-strong"
          >
            Take the complete tour
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Start with your workspace and connecting a project. Once a project
            is connected, the tour also covers scanning, results, profiles, and
            history.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => startTour("full")}>
          <Play /> Start full trial
        </Button>
      </section>

      <section
        aria-labelledby="choose-lesson"
        className="rounded-md border bg-card"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 px-4.5 pt-4 pb-3">
          <div>
            <h2
              id="choose-lesson"
              className="text-base font-semibold text-foreground-strong"
            >
              Learn one section
            </h2>
            <p className="text-xs text-muted-foreground">
              Choose only what you need. Each lesson uses a few short steps.
            </p>
          </div>
          <Link
            href="/help"
            className="inline-flex items-center gap-1 rounded-sm text-[0.84375rem] font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Browse the Help Center
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <ul className="divide-y border-t">
          {TOUR_SECTIONS.map((section) => {
            const Icon = SECTION_ICONS[section]
            return (
              <li key={section}>
                <button
                  type="button"
                  aria-label={`Learn ${TOUR_SECTION_LABELS[section]}`}
                  onClick={() => startTour(section)}
                  className="group flex w-full items-center gap-3 px-4.5 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-primary"
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground-strong">
                      {TOUR_SECTION_LABELS[section]}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Start this lesson
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
