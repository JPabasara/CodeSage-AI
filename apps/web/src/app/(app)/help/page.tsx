"use client"

import { useState } from "react"
import Link from "next/link"
import {
  BookOpen,
  ChevronRight,
  CircleHelp,
  Play,
  Search,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { searchHelp, helpTrail } from "@/lib/help-navigation"
import { HelpTopicList } from "@/components/support/help-topic-list"

export default function HelpCenterPage() {
  const [query, setQuery] = useState("")
  const term = query.trim().toLowerCase()
  const results = searchHelp(term)
  return (
    <div className="pb-14">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-5xl px-4 py-12 text-center sm:px-6 sm:py-16">
          <span className="mx-auto grid size-11 place-items-center rounded-xl border bg-muted/40 text-primary">
            <CircleHelp className="size-5" />
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            How can we help?
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Browse step-by-step guides for scanning repositories, understanding
            results, and managing your CodeSage workspace.
          </p>
          <Link
            href="/support"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Play className="size-3.5" aria-hidden="true" />
            Prefer a walkthrough? Take the New User Trial
          </Link>
          <div className="relative mx-auto mt-6 max-w-2xl text-left">
            <Search
              className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search the Help Center"
              placeholder="Describe what you need help with"
              className="h-12 rounded-full bg-background pr-12 pl-11 text-base shadow-sm"
            />
            {query ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full"
                aria-label="Clear search"
              >
                <X />
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-9 sm:px-6">
        {term ? (
          <section aria-labelledby="results-heading">
            <div className="mb-5 flex items-baseline justify-between gap-4">
              <h2 id="results-heading" className="text-xl font-semibold">
                Search results
              </h2>
              <span className="text-sm text-muted-foreground">
                {results.length} found
              </span>
            </div>
            {results.length ? (
              <div className="divide-y rounded-xl border bg-card">
                {results.map((article) => (
                  <Link
                    key={article.slug}
                    href={`/help/${article.slug}`}
                    className="group flex items-start gap-4 p-5 hover:bg-muted/30"
                  >
                    <BookOpen className="mt-0.5 size-5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium group-hover:text-primary">
                        {article.title}
                      </span>
                      <span className="mt-1 block text-xs text-primary">
                        {helpTrail(article.parent)
                          .map((topic) => topic.title)
                          .join(" › ")}
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                        {article.description}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-10 text-center">
                <h2 className="font-semibold">No articles found</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try fewer words or a feature such as scans, findings, or
                  profiles.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setQuery("")}
                >
                  Browse all topics
                </Button>
              </div>
            )}
          </section>
        ) : (
          <>
            <section aria-labelledby="topics-heading">
              <h2 id="topics-heading" className="text-xl font-semibold">
                Browse help topics
              </h2>
              <div className="mt-5">
                <HelpTopicList />
              </div>
            </section>
            <section
              className="mt-10 rounded-xl border bg-muted/20 p-6"
              aria-labelledby="popular-heading"
            >
              <h2 id="popular-heading" className="text-lg font-semibold">
                Frequently asked questions
              </h2>
              <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
                {[
                  [
                    "Why did my score change without a new scan?",
                    "understand-health-score",
                  ],
                  ["Why is my scan still queued?", "troubleshoot"],
                  ["What does Mark as done do?", "review-findings"],
                  [
                    "Why can’t I edit or delete a profile?",
                    "use-scoring-profiles",
                  ],
                  ["Which languages are supported?", "get-started"],
                  ["Why does stopping take time?", "run-and-stop-scans"],
                ].map(([label, slug]) => (
                  <Link
                    key={label}
                    href={`/help/${slug}`}
                    className="flex items-center justify-between gap-2 border-b py-3 text-sm hover:text-primary"
                  >
                    <span>{label}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
