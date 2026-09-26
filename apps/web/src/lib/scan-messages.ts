// What the scan panel says while it waits (13H.4).
//
// Every stage has a fixed headline — the honest "what is happening" — and a
// pool of friendly lines that rotate beneath it. The pool mixes lines about
// that stage with general ones, and the next line is drawn at random, never the
// one just shown, so the wait does not read like a script on repeat.
//
// A scan that runs well past its usual time switches to the "slow" pool, which
// says so plainly instead of pretending all is normal.
import type { ScanStage } from "@/lib/types"

export type PanelMode = ScanStage | "queued" | "calculating"

const numbers = new Intl.NumberFormat("en-US")

/** The fixed headline for a mode. */
export function headlineFor(
  mode: PanelMode,
  files?: { done?: number | null; total?: number | null },
) {
  switch (mode) {
    case "queued":
      return "Waiting for a free scan slot"
    case "cloning":
      return "Cloning repository"
    case "reading_code":
      return files?.total
        ? `Reading ${numbers.format(files.total)} Java ${files.total === 1 ? "file" : "files"}`
        : "Reading your code"
    case "finding_debt":
      return "Finding debt"
    case "predicting_risk":
      return "Scoring risk"
    case "scoring":
      return "Saving the results"
    case "finishing":
      return "Almost there"
    case "calculating":
      return "Calculating your health score"
  }
}

/** Lines tied to one stage. */
export const STAGE_LINES: Record<PanelMode, readonly string[]> = {
  queued: [
    "Another scan in this workspace is running. Yours starts the moment it ends.",
    "Scans take turns so each one gets the full machine.",
    "You're next in line.",
  ],
  cloning: [
    "Fetching a fresh copy of your branch.",
    "Checking out the exact commit you asked about.",
    "Making sure we scan precisely what's on the branch.",
  ],
  reading_code: [
    "Measuring every class, method and comment.",
    "Counting complexity so you don't have to.",
    "Looking at how each file has changed over time.",
    "Reading the TODOs people left behind.",
  ],
  finding_debt: [
    "Checking every file against the rules.",
    "Spotting long methods and tangled classes.",
    "Listening to what the comments admit.",
  ],
  predicting_risk: [
    "Asking the model which files are likely to break next.",
    "Weighing churn, size and complexity together.",
    "Ranking files by how risky a change would be.",
  ],
  scoring: [
    "Saving a snapshot you can come back to anytime.",
    "Putting every finding in its place.",
  ],
  finishing: ["Wrapping up.", "Just tidying up after ourselves."],
  calculating: [
    "Your scan finished. Scoring it against the active profile.",
    "Turning findings into one number you can track.",
    "Weighing each category the way your profile asks.",
    "This takes a few seconds.",
  ],
}

/** Lines that fit any stage; mixed in so the rotation has variety. */
export const GENERAL_LINES: readonly string[] = [
  "Good code is a team sport. So is fixing it.",
  "The Refactor-First list puts the worst problems at the top.",
  "Every scan is kept, so you can see the trend over time.",
  "Small, steady cleanups beat one big rewrite.",
  "You can leave this page. The scan keeps going.",
  "Profiles change how findings are weighed, not what is found.",
]

/** When a scan has run well past its usual time. */
export const SLOW_LINES: readonly string[] = [
  "Oops, this one is taking longer than usual. Big repositories need a moment.",
  "Still working. Nothing is stuck; there's just a lot to read.",
  "Taking a little longer today. Thanks for your patience.",
  "Hang tight. Large histories take longer to walk through.",
  "Longer than usual, but still going. You can leave and come back.",
]

/** When the score is taking longer than usual to calculate. */
export const SLOW_SCORE_LINES: readonly string[] = [
  "Oops, the score is taking longer than usual. Large repositories take a moment to weigh.",
  "Still calculating. Nothing is stuck; there is just a lot to weigh.",
  "A little slower today. Thanks for waiting.",
  "You can leave this page. The score will be ready when you come back.",
]

/**
 * The pool for what is on screen. Stage lines come first; general ones fill
 * in, except while calculating (seconds long) and when slow (it should say so
 * every time).
 */
export function poolFor(mode: PanelMode, slow: boolean): readonly string[] {
  if (slow) return mode === "calculating" ? SLOW_SCORE_LINES : SLOW_LINES
  if (mode === "calculating" || mode === "finishing") return STAGE_LINES[mode]
  return [...STAGE_LINES[mode], ...GENERAL_LINES]
}

/**
 * Draw the next line at random, never the one just shown (unless the pool has
 * only one). `random` is injectable so a test can pin the draw.
 */
export function pickLine(
  pool: readonly string[],
  previous: string | undefined,
  random: () => number = Math.random,
) {
  const choices =
    pool.length > 1 ? pool.filter((line) => line !== previous) : pool
  return choices[Math.floor(random() * choices.length)] ?? pool[0] ?? ""
}

/** With no history to compare against, this long counts as slow. */
export const SLOW_WITHOUT_HISTORY_MS = 3 * 60_000

/**
 * Whether the scan has run well past its usual time: half again as long as
 * usual plus a little grace, or three minutes when there is no history yet.
 */
export function isSlow(elapsedMs: number, typicalSeconds?: number | null) {
  if (typicalSeconds && typicalSeconds > 0) {
    return elapsedMs > typicalSeconds * 1_500 + 20_000
  }
  return elapsedMs > SLOW_WITHOUT_HISTORY_MS
}

/** "Usually about 2 min", from this repository's recent scans. */
export function typicalLabel(typicalSeconds?: number | null) {
  if (!typicalSeconds || typicalSeconds <= 0) return undefined
  if (typicalSeconds < 60) return "Usually under a minute"
  const minutes = Math.round(typicalSeconds / 60)
  return `Usually about ${minutes} min`
}
