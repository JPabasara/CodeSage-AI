import { expect, test } from "vitest"

import { gradeColor, healthColor, severityColor, shortSha } from "@/lib/utils"

test("healthColor maps a score to bad / mid / good", () => {
  expect(healthColor(20)).toContain("health-bad")
  expect(healthColor(55)).toContain("health-mid")
  expect(healthColor(90)).toContain("health-good")
})

test("gradeColor maps grades to colours", () => {
  expect(gradeColor("A")).toContain("health-good")
  expect(gradeColor("C")).toContain("health-mid")
  expect(gradeColor("D")).toContain("severity-high")
  expect(gradeColor("E")).toContain("severity-critical")
})

test("severityColor uses the matching severity token", () => {
  expect(severityColor("critical")).toBe("hsl(var(--severity-critical))")
  expect(severityColor("low")).toBe("hsl(var(--severity-low))")
})

test("shortSha keeps the first 7 characters", () => {
  expect(shortSha("a1b2c3d4e5f6")).toBe("a1b2c3d")
})
