import { ChevronDown, FileText, Folder } from "lucide-react"

import { cn } from "@/lib/utils"

/*
 * A still life of the dashboard for the sign-in page: the same three tiles —
 * code health, the health trend, the file health map — drawn from made-up
 * numbers. Hover works (a trend point shows its score, a tree row lights up),
 * but nothing is a link or a control and nothing takes focus: it is a picture
 * that responds, not a second way into the app. Pure CSS and SVG, so the page
 * loads no chart library and no script for it.
 */

const TREND = [
  { label: "Jun 20", score: 58 },
  { label: "Jun 30", score: 61 },
  { label: "Jul 8", score: 64 },
  { label: "Jul 15", score: 63 },
  { label: "Jul 23", score: 69 },
  { label: "Aug 2", score: 74 },
  { label: "Aug 14", score: 77 },
  { label: "Aug 29", score: 81 },
]

const TICKS = [50, 60, 70, 80, 90]

// Chart geometry, in SVG units.
const W = 300
const H = 132
const LEFT = 24
const RIGHT = 8
const TOP = 8
const BOTTOM = 20
const x = (i: number) => LEFT + (i * (W - LEFT - RIGHT)) / (TREND.length - 1)
const y = (score: number) =>
  TOP + ((90 - score) * (H - TOP - BOTTOM)) / (90 - 50)

type Health = "good" | "watch" | "hot"

const BAR: Record<Health, string> = {
  good: "bg-emerald-400",
  watch: "bg-amber-400",
  hot: "bg-red-400",
}

const TREE: {
  name: string
  depth: number
  folder?: boolean
  grade: string
  score: number
  health: Health
  findings?: boolean
}[] = [
  {
    name: "src",
    depth: 0,
    folder: true,
    grade: "B",
    score: 81,
    health: "good",
  },
  {
    name: "payments",
    depth: 1,
    folder: true,
    grade: "D",
    score: 48,
    health: "hot",
  },
  {
    name: "PaymentService.java",
    depth: 2,
    grade: "E",
    score: 22,
    health: "hot",
    findings: true,
  },
  {
    name: "StripeClient.java",
    depth: 2,
    grade: "C",
    score: 61,
    health: "watch",
    findings: true,
  },
  {
    name: "orders",
    depth: 1,
    folder: true,
    grade: "B",
    score: 79,
    health: "good",
  },
  {
    name: "OrderController.java",
    depth: 2,
    grade: "C",
    score: 66,
    health: "watch",
    findings: true,
  },
  {
    name: "OrderRepository.java",
    depth: 2,
    grade: "A",
    score: 93,
    health: "good",
  },
  {
    name: "util",
    depth: 1,
    folder: true,
    grade: "A",
    score: 97,
    health: "good",
  },
  { name: "Formatters.java", depth: 2, grade: "A", score: 100, health: "good" },
  {
    name: "test",
    depth: 1,
    folder: true,
    grade: "C",
    score: 64,
    health: "watch",
  },
  {
    name: "PaymentServiceTest.java",
    depth: 2,
    grade: "C",
    score: 58,
    health: "watch",
    findings: true,
  },
]

const CATEGORIES = [
  { name: "Code design", share: 38, color: "bg-sky-400" },
  { name: "Security", share: 22, color: "bg-orange-400" },
  { name: "Test", share: 18, color: "bg-emerald-400" },
  { name: "Documentation", share: 14, color: "bg-amber-300" },
  { name: "Requirement", share: 8, color: "bg-pink-400" },
]

function Tile({
  title,
  caption,
  className,
  children,
}: Readonly<{
  title: string
  caption: string
  className?: string
  children: React.ReactNode
}>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 bg-white/[0.04] p-4",
        className,
      )}
    >
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mb-3 text-xs text-zinc-400">{caption}</p>
      {children}
    </div>
  )
}

export function LoginPreview() {
  const line = TREND.map((point, i) => `${x(i)},${y(point.score)}`).join(" ")

  return (
    <div
      aria-hidden="true"
      data-testid="login-preview"
      className="grid cursor-default grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-3 select-none"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <Tile title="Code health" caption="4 red issues">
          <div className="flex items-baseline gap-3 tabular-nums">
            <span className="text-3xl font-semibold text-emerald-400">B</span>
            <span className="text-xl text-white">
              81<span className="text-zinc-500">/100</span>
            </span>
            <span className="text-xs text-zinc-400">+4 since last scan</span>
          </div>
          {/* The category split, one bar; hovering a segment names it. */}
          <div className="mt-4 flex h-2 overflow-hidden rounded-sm">
            {CATEGORIES.map((category) => (
              <span
                key={category.name}
                title={`${category.name} · ${category.share}%`}
                className={cn(
                  "h-full transition-opacity hover:opacity-70",
                  category.color,
                )}
                style={{ width: `${category.share}%` }}
              />
            ))}
          </div>
        </Tile>

        <Tile title="Health trend" caption="Score after each scan">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full overflow-visible"
          >
            {TICKS.map((tick) => (
              <g key={tick}>
                <line
                  x1={LEFT}
                  x2={W - RIGHT}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-white/10"
                />
                <text
                  x={LEFT - 6}
                  y={y(tick) + 3}
                  textAnchor="end"
                  className="fill-zinc-500 text-[9px] tabular-nums"
                >
                  {tick}
                </text>
              </g>
            ))}
            <polyline
              points={line}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="stroke-emerald-400"
            />
            {TREND.map((point, i) => (
              <g key={point.label} className="group" data-trend-point>
                {/* A wide, invisible target so the hover is easy to hit. */}
                <rect
                  x={x(i) - 12}
                  y={TOP}
                  width={24}
                  height={H - TOP - BOTTOM}
                  className="fill-transparent"
                />
                <circle
                  cx={x(i)}
                  cy={y(point.score)}
                  r={3}
                  className="fill-emerald-400 transition-all group-hover:[r:5px]"
                />
                <g className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  <rect
                    x={Math.min(Math.max(x(i) - 34, 0), W - 68)}
                    y={y(point.score) - 30}
                    width={68}
                    height={20}
                    rx={4}
                    className="fill-zinc-800 stroke-white/15"
                  />
                  <text
                    x={Math.min(Math.max(x(i), 34), W - 34)}
                    y={y(point.score) - 16}
                    textAnchor="middle"
                    className="fill-white text-[10px] tabular-nums"
                  >
                    {point.label} · {point.score}
                  </text>
                </g>
                {i % 2 === 0 || i === TREND.length - 1 ? (
                  <text
                    x={x(i)}
                    y={H - 4}
                    textAnchor="middle"
                    className="fill-zinc-500 text-[9px]"
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
        </Tile>
      </div>

      <Tile
        title="File health map"
        caption="Scores per file, folded up through folders"
        className="min-w-0"
      >
        <ul className="-mx-2 space-y-px">
          {TREE.map((node) => {
            const Icon = node.folder ? Folder : FileText
            return (
              <li
                key={node.name}
                data-tree-row
                className="group relative flex items-center gap-2 rounded-sm py-1 pr-2 text-xs text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white"
                style={{ paddingLeft: `${0.75 + node.depth * 0.9}rem` }}
              >
                <span
                  className={cn(
                    "absolute inset-y-0.5 left-0 w-1 rounded-sm transition-all group-hover:w-1.5",
                    BAR[node.health],
                  )}
                />
                {node.folder ? (
                  <ChevronDown className="size-3 shrink-0 text-zinc-500" />
                ) : (
                  <span className="size-3 shrink-0" />
                )}
                <Icon className="size-3.5 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                {node.findings ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-zinc-500" />
                ) : null}
                <span className="w-12 shrink-0 text-right tabular-nums">
                  <span className="font-semibold">{node.grade}</span>{" "}
                  <span className="text-zinc-400">{node.score}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </Tile>
    </div>
  )
}
