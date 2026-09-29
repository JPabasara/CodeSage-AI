import Image from "next/image"
import Link from "next/link"
import { BookOpen } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function ProductGuidePage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Image
            src="/codesage-refactor-branch-logo.svg"
            alt="CodeSage AI"
            width={150}
            height={40}
            priority
            className="h-10 w-auto"
          />
          <Link
            href="/login"
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Open CodeSage
          </Link>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6"
      >
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <BookOpen className="size-4" aria-hidden="true" /> Product guide
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Understand CodeSage AI
          </h1>
          <p className="max-w-3xl leading-7 text-muted-foreground">
            Learn what each area does, how results are ranked, and what the
            selected thresholds mean. This guide is public and does not require
            an account.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          <GuideCard
            title="Start with a workspace"
            body="A workspace holds your projects, scoring profiles, and team. Your role decides which changes you can make."
          />
          <GuideCard
            title="Connect Java repositories"
            body="This release accepts public GitHub repositories containing Java. Choose any available branch before scanning."
          />
          <GuideCard
            title="Read the health score"
            body="A higher score means better maintainability under the active profile. Severity describes impact; priority decides what appears first."
          />
          <GuideCard
            title="Use findings carefully"
            body="Critical and high findings deserve attention first. Marking a finding done hides it from the open list, but does not improve the health score."
          />
          <GuideCard
            title="Tune profiles"
            body="A workspace can keep five custom profiles. Set a workspace default or apply an override to one project. Saved scans are re-scored without another scan."
          />
          <GuideCard
            title="Review scan history"
            body="History keeps completed snapshots for each project and branch. Open one to review its result under the profile currently in force."
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Severity guide</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Severity
              label="Critical"
              text="Review now; may expose serious risk."
            />
            <Severity label="High" text="Plan an early fix." />
            <Severity
              label="Medium"
              text="Improve during normal refactoring."
            />
            <Severity label="Low" text="Useful cleanup with lower urgency." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Score and profile ranges
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <ScoreBand grade="A" range="85–100" />
              <ScoreBand grade="B" range="70–84.9" />
              <ScoreBand grade="C" range="55–69.9" />
              <ScoreBand grade="D" range="40–54.9" />
              <ScoreBand grade="E" range="0–39.9" />
            </div>
            <p className="leading-6 text-muted-foreground">
              Category weights stay between 0.1 and 3.0. Source confidence stays
              between 0 and 1 so results remain comparable.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

function GuideCard({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-6 text-muted-foreground">
        {body}
      </CardContent>
    </Card>
  )
}

function Severity({ label, text }: Readonly<{ label: string; text: string }>) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="font-medium">{label}</p>
      <p className="mt-1 text-muted-foreground">{text}</p>
    </div>
  )
}

function ScoreBand({
  grade,
  range,
}: Readonly<{ grade: string; range: string }>) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-center">
      <p className="text-base font-semibold">Grade {grade}</p>
      <p className="mt-1 text-muted-foreground">{range}</p>
    </div>
  )
}
