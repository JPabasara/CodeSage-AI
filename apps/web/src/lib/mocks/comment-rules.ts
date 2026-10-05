import type { CommentPattern, CommentRule } from "@/lib/types"

/** Demo equivalent for common keyword/regex patterns; production tests use the API's scan engine. */
export function compileMockCommentPattern(spec: CommentPattern): RegExp {
  if (
    !["keyword", "regex"].includes(spec.match_type) ||
    typeof spec.pattern !== "string" ||
    !spec.pattern.trim() ||
    spec.pattern.length > 500
  )
    throw new Error("Enter a valid comment pattern.")
  const pattern =
    spec.match_type === "regex"
      ? spec.pattern
      : `(?<!\\w)${spec.pattern.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`
  return new RegExp(pattern, spec.case_sensitive ? "u" : "iu")
}

export function matchingMockCommentRule(
  text: string,
  rules: CommentRule[],
): CommentRule | undefined {
  return rules.find(
    (rule) => rule.enabled && compileMockCommentPattern(rule).test(text),
  )
}
