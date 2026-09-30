import Link from "next/link"
import { analysisHelpArticles } from "@/lib/help-analysis"
export const metadata = { title: "Privacy notice | CodeSage" }
export default function PrivacyPage() {
  const notice = analysisHelpArticles.find(
    (article) => article.slug === "privacy-notice",
  )!
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/login" className="text-sm text-primary hover:underline">
        Back to sign in
      </Link>
      <h1 className="mt-8 text-3xl font-semibold">{notice.title}</h1>
      <p className="mt-4 leading-7 text-muted-foreground">{notice.intro}</p>
      <div className="mt-10 space-y-8">
        {notice.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-xl font-semibold">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p
                key={paragraph}
                className="mt-3 leading-7 text-muted-foreground"
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  )
}
