import { describe, expect, test } from "vitest"

import {
  creepTarget,
  nextShown,
  reportedProgress,
  SCAN_SHARE,
  scoringTarget,
  STAGE_BANDS,
  STAGE_ORDER,
  stageOf,
  toBar,
} from "./scan-progress"

describe("bands", () => {
  test("cover the bar in order, with no gaps", () => {
    let end = STAGE_BANDS[STAGE_ORDER[0]!][0]
    for (const stage of STAGE_ORDER) {
      expect(STAGE_BANDS[stage][0]).toBe(end)
      end = STAGE_BANDS[stage][1]
    }
    expect(end).toBe(100)
  })

  test("an older API with no stage is placed by its percentage", () => {
    expect(stageOf({ progress: 5 })).toBe("cloning")
    expect(stageOf({ progress: 40 })).toBe("reading_code")
    expect(stageOf({ progress: 80 })).toBe("predicting_risk")
    expect(stageOf({ progress: 0 })).toBe("cloning")
  })
})

describe("the creep", () => {
  test("never passes a stage early, however long it waits", () => {
    for (const stage of STAGE_ORDER) {
      const [, end] = STAGE_BANDS[stage]
      const status = { stage, progress: STAGE_BANDS[stage][0] }
      expect(creepTarget(status, 60 * 60_000)).toBeLessThan(end)
    }
  })

  test("moves forward within the band and slows as it goes", () => {
    const status = { stage: "cloning" as const, progress: 5 }
    const a = creepTarget(status, 2_000)
    const b = creepTarget(status, 4_000)
    const c = creepTarget(status, 6_000)
    expect(a).toBeGreaterThan(5)
    expect(b).toBeGreaterThan(a)
    expect(c - b).toBeLessThan(b - a)
  })

  test("files read move the reading band for real", () => {
    const half = reportedProgress({
      stage: "reading_code",
      progress: 25,
      files_done: 620,
      files_total: 1240,
    })
    expect(half).toBeCloseTo(42.5)
  })
})

describe("the glide", () => {
  test("eases toward a real value instead of jumping to it", () => {
    const after = nextShown(25, 60, 100, false, 60)
    expect(after).toBeGreaterThan(25)
    expect(after).toBeLessThan(60)
  })

  test("reaches the value over time", () => {
    let shown = 25
    for (let i = 0; i < 100; i += 1)
      shown = nextShown(shown, 60, 100, false, 60)
    expect(shown).toBeCloseTo(60, 1)
  })

  test("never moves backwards", () => {
    expect(nextShown(50, 30, 100, false, 30)).toBe(50)
    expect(nextShown(50, 30, 100, true, 30)).toBe(50)
  })

  test("under reduced motion it steps straight to the reported value", () => {
    expect(nextShown(5, 20, 100, true, 25)).toBe(25)
  })
})

describe("one bar for the scan and its score", () => {
  test("the scan fills the first 90%, the score the rest", () => {
    expect(SCAN_SHARE).toBe(90)
    expect(toBar(100)).toBe(90)
    expect(toBar(50)).toBe(45)
  })

  test("the score creeps from 90 and never reaches 100 on its own", () => {
    expect(scoringTarget(0)).toBe(90)
    const a = scoringTarget(10_000)
    const b = scoringTarget(40_000)
    expect(a).toBeGreaterThan(90)
    expect(b).toBeGreaterThan(a)
    expect(scoringTarget(60 * 60_000)).toBeLessThan(100)
  })
})
