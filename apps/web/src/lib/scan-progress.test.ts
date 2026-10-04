import { describe, expect, test } from "vitest"

import {
  countLabel,
  creepTarget,
  creepTimeMs,
  labelFor,
  nextShown,
  reportedProgress,
  SCAN_SHARE,
  scoringTarget,
  STEPS,
  stepInfo,
  stepOf,
  toBar,
} from "@/lib/scan-progress"
import type { ScanStatus } from "@/lib/types"

const running = (patch: Partial<ScanStatus>): ScanStatus => ({
  scan_id: "s1",
  phase: "running",
  progress: 0,
  ...patch,
})

describe("steps", () => {
  test("seven steps cover the worker's milestones in order, with no gaps", () => {
    expect(STEPS.map((step) => step.id)).toEqual([
      "clone",
      "measure",
      "history",
      "comments",
      "debt",
      "risk",
      "score",
    ])
    for (let i = 1; i < STEPS.length; i += 1) {
      expect(STEPS[i]!.band[0]).toBe(STEPS[i - 1]!.band[1])
    }
    expect(STEPS[0]!.band[0]).toBe(5)
    expect(STEPS.at(-1)!.band[1]).toBe(100)
  })

  test("the worker's step is used when it sends one", () => {
    const base = { stage: "reading_code" as const, progress: 25 }
    expect(stepOf(running({ ...base, step: "measuring_code" }))).toBe("measure")
    expect(stepOf(running({ ...base, step: "reading_history" }))).toBe(
      "history",
    )
    expect(stepOf(running({ ...base, step: "reading_comments" }))).toBe(
      "comments",
    )
  })

  test("an older worker without step is placed by stage and percentage", () => {
    expect(stepOf(running({ stage: "reading_code", progress: 25 }))).toBe(
      "measure",
    )
    expect(stepOf(running({ stage: "reading_code", progress: 37 }))).toBe(
      "history",
    )
    expect(stepOf(running({ stage: "reading_code", progress: 52 }))).toBe(
      "comments",
    )
    // No stage at all: the percentage alone.
    expect(stepOf(running({ progress: 10 }))).toBe("clone")
    expect(stepOf(running({ progress: 64 }))).toBe("debt")
    expect(stepOf(running({ progress: 90 }))).toBe("score")
  })
})

describe("the creep", () => {
  test("never passes a step's band before the server says so, however long it waits", () => {
    for (const step of STEPS) {
      const status = running({ progress: step.band[0] })
      // Only the steps the worker reaches by percentage alone.
      if (stepOf(status) !== step.id) continue
      expect(creepTarget(status, 60 * 60_000)).toBeLessThan(step.band[1])
    }
  })

  test("moves forward within the band and slows as it goes", () => {
    const status = running({ stage: "cloning", progress: 5 })
    const a = creepTarget(status, 5_000)
    const b = creepTarget(status, 10_000)
    const c = creepTarget(status, 15_000)
    expect(b).toBeGreaterThan(a)
    expect(c - b).toBeLessThan(b - a)
  })

  test("its speed scales with the repository's typical scan time", () => {
    expect(creepTimeMs("clone", 600)).toBeGreaterThan(creepTimeMs("clone", 60))
    // Clamped either way: never frantic, never frozen.
    expect(creepTimeMs("comments", 5)).toBe(6_000)
    expect(creepTimeMs("clone", 100_000)).toBe(90_000)
    const quick = running({
      stage: "cloning",
      progress: 5,
      typical_seconds: 30,
    })
    const slow = running({
      stage: "cloning",
      progress: 5,
      typical_seconds: 900,
    })
    expect(creepTarget(quick, 10_000)).toBeGreaterThan(
      creepTarget(slow, 10_000),
    )
  })
})

describe("counts move the bar for real", () => {
  test("commits read move the history band", () => {
    const status = running({
      stage: "reading_code",
      step: "reading_history",
      progress: 37,
      commits_done: 600,
      commits_total: 1200,
    })
    expect(reportedProgress(status)).toBeCloseTo(44.5)
  })

  test("files read move the comments band", () => {
    const status = running({
      stage: "reading_code",
      step: "reading_comments",
      progress: 52,
      files_done: 100,
      files_total: 400,
    })
    expect(reportedProgress(status)).toBe(54)
  })

  test("a count that overtakes its total stays inside the band", () => {
    const status = running({
      stage: "reading_code",
      step: "reading_history",
      progress: 37,
      commits_done: 1300,
      commits_total: 1200,
    })
    expect(reportedProgress(status)).toBe(52)
  })

  test("a count outside its own step is ignored", () => {
    const status = running({
      stage: "reading_code",
      step: "measuring_code",
      progress: 25,
      files_done: 300,
      files_total: 400,
    })
    expect(reportedProgress(status)).toBe(25)
  })
})

describe("the words agree with the bar", () => {
  test("the label is always the title of the step the bar is in", () => {
    for (let progress = 5; progress < 100; progress += 1) {
      const status = running({ progress })
      const step = stepOf(status)
      const [from, to] = stepInfo(step).band
      const bar = reportedProgress(status)
      expect(bar).toBeGreaterThanOrEqual(from)
      expect(bar).toBeLessThanOrEqual(to)
      expect(labelFor(step, status)).toBe(stepInfo(step).title)
    }
  })

  test("a count shows only in its own step, and never as 0 of N", () => {
    const history = running({
      stage: "reading_code",
      step: "reading_history",
      progress: 37,
      commits_done: 0,
      commits_total: 1212,
    })
    expect(countLabel("history", history)).toBe("Starting…")
    expect(labelFor("history", history)).toBe("Reading git history")

    const counted = { ...history, commits_done: 340 }
    expect(labelFor("history", counted)).toBe(
      "Reading git history · 340 of 1,212 commits",
    )
    expect(countLabel("comments", counted)).toBeUndefined()

    const comments = running({
      stage: "reading_code",
      step: "reading_comments",
      progress: 52,
      files_done: 214,
      files_total: 329,
    })
    expect(labelFor("comments", comments)).toBe(
      "Reading comments · 214 of 329 files",
    )
  })

  test("no total (the count failed) means no count at all", () => {
    const status = running({
      stage: "reading_code",
      step: "reading_history",
      progress: 37,
      commits_done: null,
      commits_total: null,
    })
    expect(countLabel("history", status)).toBeUndefined()
  })
})

describe("the glide", () => {
  test("eases toward a real value instead of jumping to it", () => {
    const next = nextShown(10, 50, 100, false, 50)
    expect(next).toBeGreaterThan(10)
    expect(next).toBeLessThan(50)
  })

  test("reaches the value over time", () => {
    let shown = 10
    for (let i = 0; i < 40; i += 1) shown = nextShown(shown, 50, 100, false, 50)
    expect(shown).toBeCloseTo(50, 0)
  })

  test("never moves backwards", () => {
    expect(nextShown(60, 40, 100, false, 40)).toBe(60)
    expect(nextShown(60, 40, 100, true, 40)).toBe(60)
  })

  test("under reduced motion it steps straight to the reported value", () => {
    expect(nextShown(10, 30, 100, true, 25)).toBe(25)
  })
})

describe("one bar for the scan and its score", () => {
  test("the scan's own steps fill the bar 1:1, its last stretch ends at SCAN_SHARE", () => {
    expect(toBar(37)).toBe(37)
    expect(toBar(85)).toBe(85)
    expect(toBar(100)).toBe(SCAN_SHARE)
    expect(toBar(92.5)).toBeGreaterThan(85)
    expect(toBar(92.5)).toBeLessThan(SCAN_SHARE)
  })

  test("the score creeps from SCAN_SHARE and never reaches 100 on its own", () => {
    expect(scoringTarget(0)).toBe(SCAN_SHARE)
    expect(scoringTarget(10 * 60_000)).toBeLessThan(100)
    expect(scoringTarget(30_000)).toBeGreaterThan(SCAN_SHARE)
  })
})
