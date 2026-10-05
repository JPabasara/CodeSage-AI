import type { Finding } from "@/lib/types"

const BUILT_IN_SUMMARIES: Record<string, string> = {
  "complex-function":
    "Split this method into smaller functions to reduce complexity.",
  "long-method": "Extract smaller helper methods from this long method.",
  "deep-nesting": "Use early returns to reduce deeply nested code.",
  "large-file": "Split this large file into smaller files by responsibility.",
}

/** Concise built-in messages; source locations and metrics appear in details. */
export function findingSummary(finding: Finding): string {
  if (finding.source === "rule" && finding.rule_id) {
    return BUILT_IN_SUMMARIES[finding.rule_id] ?? finding.reason
  }
  return finding.reason
}
