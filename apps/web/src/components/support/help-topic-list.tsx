import Link from "next/link"
import { ChevronRight, BookOpen, FolderOpen } from "lucide-react"
import { allHelpArticles, helpTopics } from "@/lib/help-navigation"

export function HelpTopicList({ parent }: { parent?: string }) {
  const topics = helpTopics.filter((topic) => topic.parent === parent)
  const articles = parent
    ? allHelpArticles.filter((article) => article.parent === parent)
    : []
  return (
    <div className="divide-y overflow-hidden rounded-lg border bg-card">
      {topics.map((topic) => (
        <div key={topic.slug} className="p-5">
          <Link
            href={`/help/${topic.slug}`}
            className="flex items-center gap-3 font-medium hover:text-primary"
          >
            <FolderOpen
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span className="flex-1">{topic.title}</span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <p className="mt-1 pl-7 text-sm text-muted-foreground">
            {topic.description}
          </p>
          <ul className="mt-3 space-y-2 border-l pl-4 ml-7">
            {helpTopics
              .filter((child) => child.parent === topic.slug)
              .map((child) => (
                <li key={child.slug}>
                  <Link
                    href={`/help/${child.slug}`}
                    className="text-sm font-medium text-primary hover:underline"
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
                    className="text-sm text-muted-foreground hover:text-primary hover:underline"
                  >
                    {article.title}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
      {articles.map((article) => (
        <Link
          key={article.slug}
          href={`/help/${article.slug}`}
          className="flex items-start gap-3 p-5 hover:bg-muted/30"
        >
          <BookOpen
            className="mt-1 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span className="flex-1">
            <span className="block font-medium">{article.title}</span>
            <span className="mt-1 block text-sm leading-6 text-muted-foreground">
              {article.description}
            </span>
          </span>
          <ChevronRight className="mt-1 size-4 shrink-0" aria-hidden="true" />
        </Link>
      ))}
    </div>
  )
}
