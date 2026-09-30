import Link from "next/link"
export function LearnMore({
  article,
  about,
}: {
  article: string
  about: string
}) {
  return (
    <Link
      href={`/help/${article}`}
      aria-label={`Learn more about ${about}`}
      className="inline-flex rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      Learn more<span className="sr-only"> about {about}</span>
    </Link>
  )
}
