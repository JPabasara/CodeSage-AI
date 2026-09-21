import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  ChartColumnIncreasing,
  Flame,
  Gauge,
  GitBranch,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react"

import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Technical Debt Analytics",
  description:
    "CodeSage AI ranks technical debt by bug risk, churn, severity, and team scoring priorities.",
}

const priorities = [
  {
    label: "Refactor-First",
    value: "92",
    detail: "SATD comments, rule evidence, and file risk converge here.",
  },
  {
    label: "Repository heat",
    value: "18 files",
    detail: "High-churn modules with repeated findings move to the top.",
  },
  {
    label: "Health trend",
    value: "B+",
    detail: "Release pressure stays visible next to quality movement.",
  },
]

const findings = [
  {
    file: "billing/InvoiceService.ts",
    debt: "Security finding",
    score: 94,
    color: "bg-category-security",
  },
  {
    file: "checkout/payment_flow.py",
    debt: "Code-design debt",
    score: 87,
    color: "bg-category-code-design",
  },
  {
    file: "tests/refund.spec.ts",
    debt: "Test debt",
    score: 76,
    color: "bg-category-test",
  },
]

const heatMap = [
  "bg-red-400",
  "bg-amber-300",
  "bg-emerald-300",
  "bg-emerald-400",
  "bg-sky-300",
  "bg-amber-400",
  "bg-rose-300",
  "bg-emerald-300",
  "bg-sky-400",
  "bg-amber-300",
  "bg-emerald-400",
  "bg-red-300",
]

function DashboardPreview() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-3 top-28 bottom-4 -z-10 opacity-70 md:inset-x-auto md:right-4 md:left-[34%] md:top-24 md:bottom-6 lg:left-[40%]"
    >
      <div className="grid h-full min-h-[30rem] grid-cols-12 grid-rows-6 gap-3 rounded-lg border border-white/10 bg-zinc-950/90 p-3 shadow-2xl shadow-emerald-950/30">
        <div className="col-span-12 flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-red-400" />
            <div className="size-2 rounded-full bg-amber-300" />
            <div className="size-2 rounded-full bg-emerald-300" />
          </div>
          <div className="h-2 w-40 rounded-full bg-white/10" />
        </div>

        <div className="col-span-5 row-span-2 rounded-md border border-white/10 bg-white/[0.05] p-4">
          <div className="mb-6 flex items-center justify-between">
            <span className="h-2 w-24 rounded-full bg-white/20" />
            <span className="rounded-full bg-emerald-300/15 px-2 py-1 text-[0.625rem] font-semibold text-emerald-200">
              Health 81
            </span>
          </div>
          <div className="flex items-end gap-2">
            {[48, 68, 54, 76, 62, 84].map((height, index) => (
              <div
                key={height + index}
                className="w-full rounded-t-sm bg-emerald-300/80"
                style={{ height }}
              />
            ))}
          </div>
        </div>

        <div className="col-span-7 row-span-3 rounded-md border border-white/10 bg-white/[0.05] p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="h-2 w-28 rounded-full bg-white/20" />
            <span className="h-2 w-14 rounded-full bg-emerald-300/50" />
          </div>
          <div className="space-y-3">
            {findings.map((finding) => (
              <div
                key={finding.file}
                className="grid grid-cols-[0.5rem_1fr_auto] items-center gap-3 rounded-md bg-black/20 p-3"
              >
                <span className={`h-9 rounded-full ${finding.color}`} />
                <div className="min-w-0">
                  <div className="h-2 w-4/5 rounded-full bg-white/35" />
                  <div className="mt-2 h-2 w-1/2 rounded-full bg-white/15" />
                </div>
                <span className="text-xs font-semibold text-white">
                  {finding.score}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-5 row-span-3 rounded-md border border-white/10 bg-white/[0.05] p-4">
          <div className="mb-4 h-2 w-32 rounded-full bg-white/20" />
          <div className="grid grid-cols-4 gap-2">
            {heatMap.map((color, index) => (
              <div
                key={`${color}-${index}`}
                className={`aspect-square rounded-sm ${color} opacity-85`}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 text-[0.625rem] text-white/45">
            <span className="size-2 rounded-full bg-red-400" />
            <span>Risk</span>
            <span className="size-2 rounded-full bg-emerald-300" />
            <span>Healthy</span>
          </div>
        </div>

        <div className="col-span-7 row-span-2 rounded-md border border-white/10 bg-white/[0.05] p-4">
          <div className="mb-4 h-2 w-36 rounded-full bg-white/20" />
          <div className="grid grid-cols-5 gap-2">
            {["Code", "Security", "Test", "Docs", "Req"].map((label, index) => (
              <div key={label} className="space-y-2">
                <div
                  className="rounded-sm bg-white/20"
                  style={{ height: 24 + index * 12 }}
                />
                <div className="h-1.5 rounded-full bg-white/15" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen overflow-hidden bg-background text-foreground outline-none">
      <section className="relative isolate min-h-[88svh] overflow-hidden border-b bg-zinc-950 px-5 py-5 text-white sm:px-8 lg:px-10">
        <DashboardPreview />

        <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <Image
              src="/codesage-refactor-branch-mark.svg"
              alt=""
              width={36}
              height={36}
              priority
              className="size-9 shrink-0"
            />
            <span className="truncate text-sm font-semibold tracking-wide">
              CodeSage AI
            </span>
          </Link>
          <Button
            asChild
            variant="secondary"
            className="h-9 bg-white text-zinc-950 hover:bg-emerald-100"
          >
            <Link href="/login">
              Sign in
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </header>

        <div className="relative z-10 mx-auto flex min-h-[calc(88svh-4.5rem)] max-w-7xl items-center py-12">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-100">
              <ScanSearch className="size-3.5" />
              Technical debt analytics for small agile teams
            </div>
            <h1 className="max-w-2xl text-5xl font-semibold leading-none tracking-normal text-white sm:text-6xl lg:text-7xl">
              CodeSage AI
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-200 sm:text-lg">
              Rank the debt that is most likely to create future bugs, then aim
              limited refactoring time at the files, findings, and categories
              that matter before the next release.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="h-11 rounded-md bg-emerald-300 px-5 text-sm text-zinc-950 hover:bg-emerald-200"
              >
                <Link href="/login">
                  Start with GitHub sign-in
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-11 rounded-md border-white/20 bg-white/5 px-5 text-sm text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="#priority-model">Explore prioritization</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section
        id="priority-model"
        className="border-b bg-background px-5 py-12 sm:px-8 lg:px-10"
      >
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <Gauge className="size-3.5 text-primary" />
              Evidence-weighted priority
            </div>
            <h2 className="text-3xl font-semibold tracking-normal">
              Move from noisy static-analysis backlogs to ranked engineering
              decisions.
            </h2>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              CodeSage combines deterministic rule severity, SATD confidence,
              recent churn, debt category weights, and predicted file risk into
              a single priority score your team can explain.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {priorities.map((item) => (
              <article
                key={item.label}
                className="rounded-lg border bg-card p-4 shadow-sm"
              >
                <div className="text-sm font-medium text-muted-foreground">
                  {item.label}
                </div>
                <div className="mt-3 text-3xl font-semibold">{item.value}</div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {item.detail}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-12 sm:px-8 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-4">
          {[
            {
              icon: GitBranch,
              label: "Repository history",
              copy: "Process metrics reveal churn, author count, file age, and recency.",
            },
            {
              icon: ShieldCheck,
              label: "Rules and security",
              copy: "Deterministic findings stay visible with source confidence intact.",
            },
            {
              icon: Flame,
              label: "Bug-prone files",
              copy: "ML risk influences priority without creating synthetic findings.",
            },
            {
              icon: SlidersHorizontal,
              label: "Scoring profiles",
              copy: "Teams rebalance evidence and category weights without rescanning.",
            },
          ].map((item) => {
            const Icon = item.icon
            return (
              <article
                key={item.label}
                className="rounded-lg border bg-card p-4 shadow-sm"
              >
                <Icon className="size-4 text-primary" />
                <h3 className="mt-4 text-sm font-semibold">{item.label}</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {item.copy}
                </p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="border-t bg-muted/40 px-5 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ChartColumnIncreasing className="size-4 text-primary" />
              Ready for the Refactor-First list
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect a repository, scan a revision, and start with the debt
              most likely to affect delivery.
            </p>
          </div>
          <Button asChild className="h-9 w-fit">
            <Link href="/login">
              Sign in
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
