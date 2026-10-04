import Link from "next/link"
import { ChevronRight, BookOpen, FolderOpen } from "lucide-react"
import { allHelpArticles, helpTopics } from "@/lib/help-navigation"

export function HelpTopicList({ parent }: { parent?: string }) {
  const topics = helpTopics.filter((topic) => topic.parent === parent)
  const articles = parent
    ? allHelpArticles.filter((article) => article.parent === parent)
    : []
  return (
    <div className="divide-y overflow-hidden rounded-md border bg-card">
      {topics.map((topic) => (
        <div key={topic.slug} className="flex gap-3 px-4.5 py-4">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-primary"
          >
            <FolderOpen className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              href={`/help/${topic.slug}`}
              className="group inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-foreground-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {topic.title}
              <ChevronRight
                className="size-4 text-muted-foreground group-hover:text-foreground"
                aria-hidden="true"
              />
            </Link>
            <p className="text-xs text-muted-foreground">{topic.description}</p>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {helpTopics
                .filter((child) => child.parent === topic.slug)
                .map((child) => (
                  <li key={child.slug}>
                    <Link
                      href={`/help/${child.slug}`}
                      className="rounded-sm text-[0.84375rem] font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {child.title}
                    </Link>
                  </li>
                ))}
              {allHelpArticles
                .filter((article) => article.parent === topic.slug)
                .map((article) => (
                  <li key={article.slug}>
                    <Link
                      href={`/help/${article.slug}`}
                      className="rounded-sm text-[0.84375rem] text-foreground underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {article.title}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      ))}
      {articles.map((article) => (
        <Link
          key={article.slug}
          href={`/help/${article.slug}`}
          className="group flex items-start gap-3 px-4.5 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
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
              {article.description}
            </span>
          </span>
          <ChevronRight
            className="mt-2 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
            aria-hidden="true"
          />
        </Link>
      ))}
    </div>
  )
}
