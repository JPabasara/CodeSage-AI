// The scan bar's arithmetic, kept pure so it can be tested without a clock or a DOM.
// One model drives the label, the count, the bar and the stepper, so they always agree.
import type { ScanStage, ScanStatus } from "@/lib/types"

export const STAGE_ORDER: readonly ScanStage[] = [
  "cloning",
  "reading_code",
  "finding_debt",
  "predicting_risk",
  "scoring",
  "finishing",
]

/** [start, end) of each stage's band, in percent. Matches the worker. */
export const STAGE_BANDS: Record<ScanStage, readonly [number, number]> = {
  cloning: [5, 25],
  reading_code: [25, 60],
  finding_debt: [60, 70],
  predicting_risk: [70, 85],
  scoring: [85, 97],
  finishing: [97, 100],
}

export type StepId =
  "clone" | "measure" | "history" | "comments" | "debt" | "risk" | "score"

export interface ScanStepInfo {
  id: StepId
  /** Short, for the stepper. */
  label: string
  /** What the card says while this step runs. */
  title: string
  /** [from, to) on the worker's percentage. */
  band: readonly [number, number]
}

/** The seven steps a person sees, on the worker's own milestones. */
export const STEPS: readonly ScanStepInfo[] = [
  {
    id: "clone",
    label: "Clone",
    title: "Cloning the repository",
    band: [5, 25],
  },
  {
    id: "measure",
    label: "Measure code",
    title: "Measuring code",
    band: [25, 37],
  },
  {
    id: "history",
    label: "Git history",
    title: "Reading git history",
    band: [37, 52],
  },
  {
    id: "comments",
    label: "Comments",
    title: "Reading comments",
    band: [52, 60],
  },
  { id: "debt", label: "Find debt", title: "Finding debt", band: [60, 70] },
  {
    id: "risk",
    label: "Predict risk",
    title: "Predicting risk",
    band: [70, 85],
  },
  // Scoring, finishing and the score worker's wait are one step to a person.
  { id: "score", label: "Score", title: "Saving and scoring", band: [85, 100] },
]

const STEP_BY_ID = Object.fromEntries(
  STEPS.map((step) => [step.id, step]),
) as Record<StepId, ScanStepInfo>

export function stepInfo(id: StepId) {
  return STEP_BY_ID[id]
}

/** 0-based position of a step in STEPS. */
export function stepIndex(id: StepId) {
  return STEPS.findIndex((step) => step.id === id)
}

/** How close to its band's end the creep may get: it must stay visibly short. */
const BAND_HEADROOM = 1

/** Without a typical time from the server, assume a two-minute scan. */
const DEFAULT_TYPICAL_SECONDS = 120
const MIN_CREEP_MS = 6_000
const MAX_CREEP_MS = 90_000

const GLIDE_TIME_MS = 350

/**
 * The scan's own steps fill the bar 1:1 up to 85, so a step's band is the same
 * on the worker and on the bar. The worker's last stretch (85–100) takes the bar
 * to SCAN_SHARE; the score worker's wait creeps on from there.
 */
const SCORE_START = 85
export const SCAN_SHARE = 92

/** How long the score's creep takes to cover ~63% of its section. */
const SCORE_CREEP_MS = 20_000

export function toBar(scanPercent: number) {
  if (scanPercent <= SCORE_START) return scanPercent
  const share = (Math.min(100, scanPercent) - SCORE_START) / (100 - SCORE_START)
  return SCORE_START + (SCAN_SHARE - SCORE_START) * share
}

// Where the bar heads `msScoring` after the score calculation began.
export function scoringTarget(msScoring: number) {
  const ceiling = 100 - BAND_HEADROOM
  const eased = 1 - Math.exp(-Math.max(0, msScoring) / SCORE_CREEP_MS)
  return SCAN_SHARE + (ceiling - SCAN_SHARE) * eased
}

export function stageOf(status: Pick<ScanStatus, "stage" | "progress">) {
  if (status.stage) return status.stage
  let found: ScanStage = "cloning"
  for (const stage of STAGE_ORDER) {
    if (status.progress >= STAGE_BANDS[stage][0]) found = stage
  }
  return found
}

type StepStatus = Pick<
  ScanStatus,
  | "stage"
  | "step"
  | "progress"
  | "files_done"
  | "files_total"
  | "commits_done"
  | "commits_total"
>

/**
 * Which of the seven steps a scan is in. The worker's `step` when it sends one;
 * otherwise the stage and the percentage (an older worker still reports 37 and
 * 52 inside reading_code), so the stepper never waits on a newer API.
 */
export function stepOf(status: StepStatus): StepId {
  switch (stageOf(status)) {
    case "cloning":
      return "clone"
    case "reading_code":
      if (status.step === "measuring_code") return "measure"
      if (status.step === "reading_history") return "history"
      if (status.step === "reading_comments") return "comments"
      if (status.progress >= 52) return "comments"
      return status.progress >= 37 ? "history" : "measure"
    case "finding_debt":
      return "debt"
    case "predicting_risk":
      return "risk"
    default:
      return "score"
  }
}

/** done / total of the step's own counter, or undefined when it has none yet. */
function stepShare(step: StepId, status: StepStatus) {
  const [done, total] =
    step === "history"
      ? [status.commits_done, status.commits_total]
      : step === "comments"
        ? [status.files_done, status.files_total]
        : [undefined, undefined]
  if (!total || done === null || done === undefined) return undefined
  // The commit total is counted apart from the walk, so it can be overtaken.
  return Math.min(1, Math.max(0, done / total))
}

/** The highest value the server has actually vouched for. */
export function reportedProgress(status: StepStatus) {
  const [from, to] = stepInfo(stepOf(status)).band
  let value = Math.max(from, status.progress)
  const share = stepShare(stepOf(status), status)
  if (share !== undefined) value = Math.max(value, from + (to - from) * share)
  return Math.min(value, 100)
}

/**
 * The creep's time constant: a step that usually takes longer creeps slower,
 * so a long history read doesn't park at its band's end for a minute.
 */
export function creepTimeMs(step: StepId, typicalSeconds?: number | null) {
  const [from, to] = stepInfo(step).band
  const typical =
    typicalSeconds && typicalSeconds > 0
      ? typicalSeconds
      : DEFAULT_TYPICAL_SECONDS
  const share = (to - from) / 100
  return Math.min(
    MAX_CREEP_MS,
    Math.max(MIN_CREEP_MS, (typical * 1000 * share) / 3),
  )
}

/** Where the bar heads after `msInStep` in the current step; never into the next. */
export function creepTarget(
  status: StepStatus & Pick<ScanStatus, "typical_seconds">,
  msInStep: number,
) {
  const step = stepOf(status)
  const ceiling = stepInfo(step).band[1] - BAND_HEADROOM
  const floor = reportedProgress(status)
  if (floor >= ceiling) return floor
  const eased =
    1 -
    Math.exp(-Math.max(0, msInStep) / creepTimeMs(step, status.typical_seconds))
  return floor + (ceiling - floor) * eased
}

const numbers = new Intl.NumberFormat("en-US")

/**
 * "340 of 1,212 commits" or "214 of 329 files": only in the step that owns the
 * count, and only once something is counted. "Starting…" before that; never "0 of N".
 */
export function countLabel(step: StepId, status: StepStatus) {
  const [done, total, unit] =
    step === "history"
      ? [status.commits_done, status.commits_total, "commits"]
      : step === "comments"
        ? [status.files_done, status.files_total, "files"]
        : [undefined, undefined, ""]
  if (!total) return undefined
  if (!done || done <= 0) return "Starting…"
  return `${numbers.format(Math.min(done, total))} of ${numbers.format(total)} ${unit}`
}

/** The card's title for a step, with its count when it has one. */
export function labelFor(step: StepId, status: StepStatus) {
  const title = stepInfo(step).title
  const count = countLabel(step, status)
  return count && count !== "Starting…" ? `${title} · ${count}` : title
}

// One animation step: glide from `shown` toward `target` over `dtMs`.
export function nextShown(
  shown: number,
  target: number,
  dtMs: number,
  reducedMotion: boolean,
  reported: number,
) {
  if (reducedMotion) return Math.max(shown, reported)
  if (target <= shown) return shown
  const step =
    (target - shown) * (1 - Math.exp(-Math.max(0, dtMs) / GLIDE_TIME_MS))
  return Math.min(target, shown + step)
}
