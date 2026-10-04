"use client"

import { useState } from "react"
import Link from "next/link"
import { BookOpen, ChevronRight, Play, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/empty-state"
import { PageContainer } from "@/components/layout/page-container"
import { PageHeader } from "@/components/layout/page-header"
import { searchHelp, helpTrail } from "@/lib/help-navigation"
import { HelpTopicList } from "@/components/support/help-topic-list"
import { cn } from "@/lib/utils"

const FAQ = [
  ["Why did my score change without a new scan?", "understand-health-score"],
  ["Why is my scan still queued?", "troubleshoot"],
  ["What does Mark as done do?", "review-findings"],
  ["Why can’t I edit or delete a profile?", "use-scoring-profiles"],
  ["Which languages are supported?", "get-started"],
  ["Why does stopping take time?", "run-and-stop-scans"],
] as const

const ROW_LINK =
  "group flex items-start gap-3 px-4.5 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"

export default function HelpCenterPage() {
  const [query, setQuery] = useState("")
  const term = query.trim().toLowerCase()
  const results = searchHelp(term)
  return (
    <PageContainer>
      <PageHeader
        title="Help Center"
        description="Step-by-step guides for scanning repositories, understanding results, and managing your CodeSage workspace."
        aside={
          <Link
            href="/support"
            className="inline-flex items-center gap-1.5 rounded-sm text-[0.84375rem] font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Play className="size-3.5" aria-hidden="true" />
            Prefer a walkthrough? Take the New User Trial
          </Link>
        }
      />

      <div className="flex w-full max-w-4xl flex-col gap-6">
        <div className="relative">
          <Search
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search the Help Center"
            placeholder="Describe what you need help with"
            className="h-10 bg-card pr-10 pl-9 dark:bg-card"
          />
          {query ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X />
            </Button>
          ) : null}
        </div>

        {term ? (
          <section
            aria-labelledby="results-heading"
            className="rounded-md border bg-card"
          >
            <div className="flex items-baseline justify-between gap-4 px-4.5 pt-4 pb-3">
              <h2
                id="results-heading"
                className="text-base font-semibold text-foreground-strong"
              >
                Search results
              </h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {results.length} found
              </span>
            </div>
            {results.length ? (
              <ul className="divide-y border-t">
                {results.map((article) => (
                  <li key={article.slug}>
                    <Link href={`/help/${article.slug}`} className={ROW_LINK}>
                      <span
                        aria-hidden="true"
                        className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-primary"
                      >
                        <BookOpen className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-foreground-strong">
                          {article.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {helpTrail(article.parent)
                            .map((topic) => topic.title)
                            .join(" › ")}
                        </span>
                        <span className="mt-1 block text-[0.84375rem] text-foreground">
                          {article.description}
                        </span>
                      </span>
                      <ChevronRight
                        className="mt-2 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                className="rounded-none border-0 border-t border-solid"
                title="No articles found"
                description="Try fewer words or a feature such as scans, findings, or profiles."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setQuery("")}
                  >
                    Browse all topics
                  </Button>
                }
              />
            )}
          </section>
        ) : (
          <>
            <section aria-labelledby="topics-heading" className="space-y-3">
              <div>
                <h2
                  id="topics-heading"
                  className="text-base font-semibold text-foreground-strong"
                >
                  Browse help topics
                </h2>
                <p className="text-xs text-muted-foreground">
                  Each topic groups the guides for one part of CodeSage.
                </p>
              </div>
              <HelpTopicList />
            </section>
            <section
              aria-labelledby="popular-heading"
              className="rounded-md border bg-card"
            >
              <div className="px-4.5 pt-4 pb-3">
                <h2
                  id="popular-heading"
                  className="text-base font-semibold text-foreground-strong"
                >
                  Frequently asked questions
                </h2>
                <p className="text-xs text-muted-foreground">
                  Short answers to what people ask most.
                </p>
              </div>
              <ul className="divide-y border-t">
                {FAQ.map(([label, slug]) => (
                  <li key={label}>
                    <Link
                      href={`/help/${slug}`}
                      className={cn(
                        ROW_LINK,
                        "items-center py-3 text-sm text-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1">{label}</span>
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </PageContainer>
  )
}
