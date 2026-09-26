// The scan bar's arithmetic (13H.4), kept pure so it can be tested without a
// clock or a DOM.
//
// The worker reports a stage and the percentage where that stage starts. Each
// stage owns a band of the bar. Inside its band the bar creeps forward on its
// own, slowing as it nears the band's end, and it never enters the next band
// until the server says the next stage has begun. A real number (a new stage,
// or files read) is glided to rather than jumped to, and the bar never moves
// backwards.
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

/** How long a creep takes to cover ~63% of what is left in its band. */
const CREEP_TIME_MS = 12_000

/** How long a glide takes to cover ~63% of the distance to its target. */
const GLIDE_TIME_MS = 350

/**
 * One bar for the whole wait: the scan fills it up to here, and calculating
 * the health score fills the rest. The server's percentages are the scan's
 * own (0–100), so they are scaled into this share with {@link toBar}.
 */
export const SCAN_SHARE = 90

/** How long the score's creep takes to cover ~63% of its section. */
const SCORE_CREEP_MS = 20_000

/** A scan percentage (0–100) as a position on the whole bar. */
export function toBar(scanPercent: number) {
  return (scanPercent * SCAN_SHARE) / 100
}

/**
 * Where the bar heads `msScoring` after the score calculation began. The
 * server gives no percentage for it, so it creeps through the last section,
 * slowing down, and reaches 100 only when the report actually arrives.
 */
export function scoringTarget(msScoring: number) {
  const ceiling = 100 - BAND_HEADROOM
  const eased = 1 - Math.exp(-Math.max(0, msScoring) / SCORE_CREEP_MS)
  return SCAN_SHARE + (ceiling - SCAN_SHARE) * eased
}

/**
 * The stage the scan is in. The server's word when it gives one; otherwise
 * inferred from the percentage, so an older API still gets labelled bands.
 */
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
  // Files read move the reading band for real.
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

/**
 * Where the bar should be heading `msInStage` after the stage began: the
 * reported value plus a creep that slows toward the band's end and never
 * reaches it.
 */
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

/**
 * One animation step: glide from `shown` toward `target` over `dtMs`. Under
 * reduced motion there is no glide — the bar steps straight to what the
 * server reported and does not creep.
 *
 * Never returns less than `shown`: the bar only moves forward.
 */
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
