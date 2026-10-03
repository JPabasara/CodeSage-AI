// The scan bar's arithmetic (13H.4), kept pure so it can be tested without a clock or a DOM.
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

/** How close to its band's end the creep may get: it must stay visibly short. */
const BAND_HEADROOM = 1

const CREEP_TIME_MS = 12_000

const GLIDE_TIME_MS = 350

export const SCAN_SHARE = 90

/** How long the score's creep takes to cover ~63% of its section. */
const SCORE_CREEP_MS = 20_000

export function toBar(scanPercent: number) {
  return (scanPercent * SCAN_SHARE) / 100
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

/** The highest value the server has actually vouched for. */
export function reportedProgress(
  status: Pick<ScanStatus, "stage" | "progress" | "files_done" | "files_total">,
) {
  const stage = stageOf(status)
  const [start, end] = STAGE_BANDS[stage]
  let value = Math.max(start, status.progress)
  if (
    stage === "reading_code" &&
    status.files_total &&
    status.files_done !== null &&
    status.files_done !== undefined
  ) {
    const share = Math.min(1, status.files_done / status.files_total)
    value = Math.max(value, start + (end - start) * share)
  }
  return Math.min(value, 100)
}

export function creepTarget(
  status: Pick<ScanStatus, "stage" | "progress" | "files_done" | "files_total">,
  msInStage: number,
) {
  const stage = stageOf(status)
  const ceiling = STAGE_BANDS[stage][1] - BAND_HEADROOM
  const floor = reportedProgress(status)
  if (floor >= ceiling) return floor
  const eased = 1 - Math.exp(-Math.max(0, msInStage) / CREEP_TIME_MS)
  return floor + (ceiling - floor) * eased
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
