import Link from "next/link"
import { ChevronLeft, ChevronRight, Info } from "lucide-react"
import { notFound } from "next/navigation"
import {
  findHelpArticle as articleBySlug,
  allHelpArticles as helpArticles,
  helpTopics,
  findHelpTopic,
  helpTrail,
} from "@/lib/help-navigation"
import { HelpTopicList } from "@/components/support/help-topic-list"

export function generateStaticParams() {
  return [...helpArticles, ...helpTopics].map(({ slug }) => ({ slug }))
}

export default async function HelpArticlePage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params
  const article = articleBySlug(slug)
  const topic = findHelpTopic(slug)
  if (topic)
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <nav
          aria-label="Breadcrumb"
          className="mb-6 flex flex-wrap gap-2 text-sm text-muted-foreground"
        >
          <Link href="/help" className="hover:underline">
            Help Center
          </Link>
          {helpTrail(topic.parent).map((ancestor) => (
            <span key={ancestor.slug}>
              {" "}
              /{" "}
              <Link href={`/help/${ancestor.slug}`} className="hover:underline">
                {ancestor.title}
              </Link>
            </span>
          ))}
          <span aria-current="page"> / {topic.title}</span>
        </nav>
        <h1 className="text-3xl font-semibold tracking-tight">{topic.title}</h1>
        <p className="mt-3 mb-7 text-muted-foreground">{topic.description}</p>
        <HelpTopicList parent={topic.slug} />
      </div>
    )
  if (!article) notFound()
  const related = article.related
    .map(articleBySlug)
    .filter((item) => item !== undefined)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <nav
        aria-label="Breadcrumb"
        className="mb-8 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link href="/help" className="hover:text-foreground">
          Help Center
        </Link>
        {helpTrail(article.parent).map((ancestor) => (
          <span key={ancestor.slug} className="inline-flex items-center gap-2">
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <Link href={`/help/${ancestor.slug}`} className="hover:underline">
              {ancestor.title}
            </Link>
          </span>
        ))}
        <span aria-current="page" className="sr-only">
          {article.title}
        </span>
      </nav>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,44rem)_16rem] lg:justify-between">
        <article>
          <header className="border-b pb-7">
            <p className="text-sm font-medium text-primary">
              {helpTrail(article.parent).at(-1)?.title ?? article.category}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {article.title}
            </h1>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              {article.intro}
            </p>
          </header>
          <div className="space-y-10 py-8">
            {article.sections.map((section) => (
              <section
                key={section.heading}
                id={section.heading.toLowerCase().replaceAll(" ", "-")}
                className="scroll-mt-20"
              >
                <h2 className="text-xl font-semibold tracking-tight">
                  {section.heading}
                </h2>
                <div className="mt-3 space-y-3">
                  {section.paragraphs.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="text-[15px] leading-7 text-muted-foreground"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
                {section.steps ? (
                  <ol className="mt-5 space-y-4">
                    {section.steps.map((step, index) => (
                      <li
                        key={step}
                        className="flex gap-4 text-[15px] leading-7"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {index + 1}
                        </span>
                        <span className="pt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {section.note ? (
                  <aside className="mt-5 flex gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
                    <Info
                      className="mt-0.5 size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <p>
                      <strong>Important:</strong> {section.note}
                    </p>
                  </aside>
                ) : null}
              </section>
            ))}
          </div>
          <footer className="border-t pt-6">
            <Link
              href="/help"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <ChevronLeft className="size-4" />
              Back to Help Center
            </Link>
          </footer>
        </article>
        <aside className="space-y-8 lg:sticky lg:top-6 lg:self-start">
          <section>
            <h2 className="text-sm font-semibold">In this article</h2>
            <nav className="mt-3 border-l">
              {article.sections.map((section) => (
                <a
                  key={section.heading}
                  href={`#${section.heading.toLowerCase().replaceAll(" ", "-")}`}
                  className="block border-l border-transparent px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
                >
                  {section.heading}
                </a>
              ))}
            </nav>
          </section>
          <section>
            <h2 className="text-sm font-semibold">Related articles</h2>
            <div className="mt-3 space-y-2">
              {related.map((item) => (
                <Link
                  key={item.slug}
                  href={`/help/${item.slug}`}
                  className="group flex items-start justify-between gap-2 rounded-md border bg-card p-3 text-sm hover:border-primary/40"
                >
                  <span>{item.title}</span>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
