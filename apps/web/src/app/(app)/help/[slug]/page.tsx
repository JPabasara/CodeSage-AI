import Link from "next/link"
import { ChevronLeft, ChevronRight, Info } from "lucide-react"
import { notFound } from "next/navigation"
import {
  findHelpArticle as articleBySlug,
  allHelpArticles as helpArticles,
  helpTopics,
  findHelpTopic,
  helpTrail,
  type HelpTopic,
} from "@/lib/help-navigation"
import { HelpTopicList } from "@/components/support/help-topic-list"
import { PageContainer } from "@/components/layout/page-container"
import { PageHeader } from "@/components/layout/page-header"

export function generateStaticParams() {
  return [...helpArticles, ...helpTopics].map(({ slug }) => ({ slug }))
}

const sectionId = (heading: string) =>
  heading.toLowerCase().replaceAll(" ", "-")

// The small uppercase label the mockups put above a list.
const SECTION_LABEL =
  "text-xs font-semibold tracking-wider text-muted-foreground uppercase"

const CRUMB_LINK =
  "rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"

/** Help Center › topic › topic, then the page itself. */
function Breadcrumb({
  trail,
  current,
}: Readonly<{ trail: HelpTopic[]; current: string }>) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Link href="/help" className={CRUMB_LINK}>
        Help Center
      </Link>
      {trail.map((ancestor) => (
        <span key={ancestor.slug} className="inline-flex items-center gap-1.5">
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <Link href={`/help/${ancestor.slug}`} className={CRUMB_LINK}>
            {ancestor.title}
          </Link>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <span aria-current="page" className="text-foreground">
          {current}
        </span>
      </span>
    </nav>
  )
}

export default async function HelpArticlePage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params
  const article = articleBySlug(slug)
  const topic = findHelpTopic(slug)
  if (topic)
    return (
      <PageContainer>
        <div className="flex flex-col gap-3">
          <Breadcrumb trail={helpTrail(topic.parent)} current={topic.title} />
          <PageHeader title={topic.title} description={topic.description} />
        </div>
        <div className="max-w-4xl">
          <HelpTopicList parent={topic.slug} />
        </div>
      </PageContainer>
    )
  if (!article) notFound()
  const related = article.related
    .map(articleBySlug)
    .filter((item) => item !== undefined)

  return (
    <PageContainer>
      <div className="flex flex-col gap-3">
        <Breadcrumb trail={helpTrail(article.parent)} current={article.title} />
        <PageHeader title={article.title} description={article.intro} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,46rem)_16rem]">
        <article className="rounded-md border bg-card">
          <div className="divide-y">
            {article.sections.map((section) => (
              <section
                key={section.heading}
                id={sectionId(section.heading)}
                aria-labelledby={`${sectionId(section.heading)}-heading`}
                className="scroll-mt-20 px-5 py-5 sm:px-6"
              >
                <h2
                  id={`${sectionId(section.heading)}-heading`}
                  className="text-base font-semibold text-foreground-strong"
                >
                  {section.heading}
                </h2>
                <div className="mt-2 space-y-3">
                  {section.paragraphs.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="text-sm leading-6 text-foreground"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
                {section.steps ? (
                  <ol className="mt-4 space-y-3">
                    {section.steps.map((step, index) => (
                      <li
                        key={step}
                        className="flex gap-3 text-sm leading-6 text-foreground"
                      >
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground-strong tabular-nums">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {section.note ? (
                  <aside className="mt-4 flex gap-3 rounded-md border border-l-[3px] border-l-primary bg-card px-3.5 py-3 text-sm leading-6 text-foreground">
                    <Info
                      className="mt-1 size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <p>
                      <strong className="font-semibold text-foreground-strong">
                        Important:
                      </strong>{" "}
                      {section.note}
                    </p>
                  </aside>
                ) : null}
              </section>
            ))}
          </div>
          <footer className="border-t px-5 py-4 sm:px-6">
            <Link
              href="/help"
              className="inline-flex items-center gap-1 rounded-sm text-[0.84375rem] font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
              Back to Help Center
            </Link>
          </footer>
        </article>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <section
            aria-labelledby="help-contents"
            className="rounded-md border bg-card px-4 py-3.5"
          >
            <h2 id="help-contents" className={SECTION_LABEL}>
              In this article
            </h2>
            <nav aria-labelledby="help-contents" className="mt-2 border-l">
              {article.sections.map((section) => (
                <a
                  key={section.heading}
                  href={`#${sectionId(section.heading)}`}
                  className="-ml-px block border-l border-transparent px-3 py-1 text-[0.84375rem] text-muted-foreground outline-none hover:border-primary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {section.heading}
                </a>
              ))}
            </nav>
          </section>
          {related.length > 0 ? (
            <section
              aria-labelledby="help-related"
              className="rounded-md border bg-card"
            >
              <h2 id="help-related" className={`${SECTION_LABEL} px-4 pt-3.5`}>
                Related articles
              </h2>
              <ul className="mt-1.5 divide-y">
                {related.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={`/help/${item.slug}`}
                      className="group flex items-start justify-between gap-2 px-4 py-2.5 text-[0.84375rem] text-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span>{item.title}</span>
                      <ChevronRight
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </PageContainer>
  )
}
