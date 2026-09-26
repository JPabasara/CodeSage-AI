import { describe, expect, test } from "vitest"

import {
  GENERAL_LINES,
  headlineFor,
  isSlow,
  pickLine,
  poolFor,
  SLOW_LINES,
  SLOW_SCORE_LINES,
  STAGE_LINES,
  typicalLabel,
} from "./scan-messages"

describe("headlines", () => {
  test("are plain and fixed per stage", () => {
    expect(headlineFor("cloning")).toBe("Cloning repository")
    expect(headlineFor("finding_debt")).toBe("Finding debt")
    expect(headlineFor("predicting_risk")).toBe("Scoring risk")
    expect(headlineFor("finishing")).toBe("Almost there")
    expect(headlineFor("calculating")).toBe("Calculating your health score")
  })

  test("reading says how many Java files, with separators", () => {
    expect(headlineFor("reading_code", { total: 1240 })).toBe(
      "Reading 1,240 Java files",
    )
    expect(headlineFor("reading_code", { total: 1 })).toBe(
      "Reading 1 Java file",
    )
    expect(headlineFor("reading_code")).toBe("Reading your code")
  })
})

describe("pools", () => {
  test("a stage mixes its own lines with general ones", () => {
    const pool = poolFor("reading_code", false)
    for (const line of STAGE_LINES.reading_code) expect(pool).toContain(line)
    for (const line of GENERAL_LINES) expect(pool).toContain(line)
  })

  test("a slow scan says so, whatever the stage", () => {
    expect(poolFor("cloning", true)).toEqual(SLOW_LINES)
    expect(poolFor("predicting_risk", true)).toEqual(SLOW_LINES)
  })

  test("calculating keeps to its own lines", () => {
    expect(poolFor("calculating", false)).toEqual(STAGE_LINES.calculating)
  })

  test("a slow score has its own 'taking longer' lines", () => {
    expect(poolFor("calculating", true)).toEqual(SLOW_SCORE_LINES)
  })
})

describe("picking a line", () => {
  test("never repeats the line just shown", () => {
    const pool = ["a", "b", "c"]
    let previous: string | undefined
    for (let i = 0; i < 200; i += 1) {
      const next = pickLine(pool, previous)
      expect(next).not.toBe(previous)
      previous = next
    }
  })

  test("is random: every line in the pool turns up", () => {
    const pool = poolFor("cloning", false)
    const seen = new Set<string>()
    let previous: string | undefined
    for (let i = 0; i < 500; i += 1) {
      previous = pickLine(pool, previous)
      seen.add(previous)
    }
    expect(seen.size).toBe(pool.length)
  })

  test("follows the injected random source", () => {
    expect(pickLine(["a", "b", "c"], undefined, () => 0)).toBe("a")
    expect(pickLine(["a", "b", "c"], "a", () => 0)).toBe("b")
  })
})

describe("slow", () => {
  test("means well past this repository's usual time", () => {
    expect(isSlow(100_000, 120)).toBe(false)
    expect(isSlow(200_000, 120)).toBe(false) // 1.5× + 20s grace = 200s
    expect(isSlow(201_000, 120)).toBe(true)
  })

  test("with no history, three minutes", () => {
    expect(isSlow(179_000, null)).toBe(false)
    expect(isSlow(181_000, null)).toBe(true)
  })

  test("the usual time reads like a person would say it", () => {
    expect(typicalLabel(130)).toBe("Usually about 2 min")
    expect(typicalLabel(40)).toBe("Usually under a minute")
    expect(typicalLabel(null)).toBeUndefined()
  })
})
