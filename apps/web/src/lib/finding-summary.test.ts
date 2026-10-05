import { expect, test } from "vitest"
import { findingSummary } from "@/lib/finding-summary"
import type { Finding } from "@/lib/types"

const finding = {
  source: "rule",
  rule_id: "complex-function",
  reason:
    "org.joda.time.tz.ZoneInfoCompiler.parseDataFile/2[java.io.BufferedReader,boolean]() has cyclomatic complexity 24, over the limit of 15 - split it into smaller functions.",
} as Finding

test.each([
  [
    "complex-function",
    "Split this method into smaller functions to reduce complexity.",
  ],
  ["long-method", "Extract smaller helper methods from this long method."],
  ["deep-nesting", "Use early returns to reduce deeply nested code."],
  ["large-file", "Split this large file into smaller files by responsibility."],
])(
  "provides a concise summary for %s, including historical findings",
  (rule_id, summary) => {
    expect(findingSummary({ ...finding, rule_id })).toBe(summary)
  },
)

test("preserves PMD and comment messages", () => {
  const reason = "Avoid assignment to line in operand"
  expect(
    findingSummary({ ...finding, rule_id: "pmd:AssignmentInOperand", reason }),
  ).toBe(reason)
  expect(
    findingSummary({
      ...finding,
      source: "satd",
      reason: "TODO: improve parsing",
    }),
  ).toBe("TODO: improve parsing")
})
