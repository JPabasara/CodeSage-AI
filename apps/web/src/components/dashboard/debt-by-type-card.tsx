import { categoryColor } from "@/components/dashboard/finding-tag"
import type { CategoryBreakdownItem } from "@/lib/types"

function sentenceCase(value: string) {
  const spaced = value.replace(/-/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** How the findings split across debt types: one labelled bar each, largest first. */
export function DebtByTypeCard({
  breakdown,
}: Readonly<{ breakdown: CategoryBreakdownItem[] }>) {
  const rows = [...breakdown]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
  const total = rows.reduce((sum, item) => sum + item.count, 0)
  const largest = rows[0]?.count ?? 0

  return (
    <section className="flex h-full min-w-0 flex-col rounded-md border bg-card">
      <header className="px-4.5 pt-4">
        <h2 className="text-base font-semibold text-foreground-strong">
          Debt by type
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {total} {total === 1 ? "finding" : "findings"}
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="m-4.5 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          No findings in this snapshot.
        </p>
      ) : (
        <ul className="flex flex-col gap-3.5 px-4.5 pt-3 pb-4.5">
          {rows.map((item) => {
            const share = total ? Math.round((item.count / total) * 100) : 0
            return (
              <li key={item.category} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-[3px]"
                      style={{ backgroundColor: categoryColor(item.category) }}
                    />
                    <span className="truncate">
                      {sentenceCase(item.category)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    <span className="font-semibold text-foreground-strong">
                      {item.count}
                    </span>{" "}
                    · {share}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${largest ? (item.count / largest) * 100 : 0}%`,
                      backgroundColor: categoryColor(item.category),
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
