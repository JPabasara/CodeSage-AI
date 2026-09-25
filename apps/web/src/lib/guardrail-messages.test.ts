import { expect, test } from "vitest"

import { ApiRequestError } from "@/lib/api/client"
import {
  connectFailureMessage,
  NO_JAVA_MESSAGE,
  scanFailureMessage,
} from "@/lib/guardrail-messages"
import type { ScanStatus } from "@/lib/types"

const refused = (
  code: ConstructorParameters<typeof ApiRequestError>[1],
  detail = "x",
  languages?: string[],
) => new ApiRequestError(400, code, detail, languages)

// ── connect ─────────────────────────────────────────────────────────────────

test("a Java-less repository names the languages GitHub did find", () => {
  const message = connectFailureMessage(
    refused("REPOSITORY_HAS_NO_JAVA", "x", ["Python", "Shell"]),
  )

  expect(message).toContain(NO_JAVA_MESSAGE)
  expect(message).toMatch(/GitHub lists Python and Shell\.$/)
})

test("the language list is said the way a person would, and stays short", () => {
  const message = connectFailureMessage(
    refused("REPOSITORY_HAS_NO_JAVA", "x", [
      "TypeScript",
      "CSS",
      "HTML",
      "Dockerfile",
    ]),
  )

  // Most code first, three at most: this is a hint, not an inventory.
  expect(message).toMatch(/GitHub lists TypeScript, CSS and HTML\.$/)
  expect(message).not.toContain("Dockerfile")
})

test("an empty repository still gets an accurate sentence", () => {
  expect(
    connectFailureMessage(refused("REPOSITORY_HAS_NO_JAVA", "x", [])),
  ).toMatch(/GitHub lists no code in it\.$/)
  // A body with no `languages` at all reads the same.
  expect(connectFailureMessage(refused("REPOSITORY_HAS_NO_JAVA"))).toMatch(
    /no code in it/,
  )
})

test("too large uses the server's sentence, because it names today's limit", () => {
  const detail =
    "This repository is larger than 300 MB, the most CodeSage can analyse today."
  expect(connectFailureMessage(refused("REPOSITORY_TOO_LARGE", detail))).toBe(
    detail,
  )
})

test("too large without a usable sentence falls back to the code's own", () => {
  expect(connectFailureMessage(refused("REPOSITORY_TOO_LARGE", "x"))).toMatch(
    /larger than CodeSage can analyse today/i,
  )
})

test("every other code is chosen by code, not copied from detail", () => {
  expect(connectFailureMessage(refused("REPOSITORY_NOT_PUBLIC"))).toMatch(
    /only public repositories/i,
  )
  expect(connectFailureMessage(refused("ALREADY_CONNECTED"))).toMatch(
    /already connected/i,
  )
})

test("an unknown failure falls back to its own sentence", () => {
  expect(
    connectFailureMessage(
      new ApiRequestError(503, "UPSTREAM_UNAVAILABLE", "GitHub is down."),
    ),
  ).toBe("GitHub is down.")
  expect(connectFailureMessage("boom")).toBe(
    "Couldn't connect that repository.",
  )
})

// ── scan ────────────────────────────────────────────────────────────────────

const failed = (overrides: Partial<ScanStatus>): ScanStatus => ({
  scan_id: "s",
  phase: "error",
  progress: 0,
  ...overrides,
})

test("a branch with no Java ends in a plain sentence, not a crash message", () => {
  expect(
    scanFailureMessage(failed({ error_code: "NO_JAVA_FILES", error: "x" })),
  ).toMatch(/^No Java files on this branch\./)
})

test("too large and timed out show the stored sentence that names the limit", () => {
  const files =
    "This branch has 7,210 Java files, more than the 5,000 CodeSage can analyse today."
  expect(
    scanFailureMessage(
      failed({ error_code: "REPOSITORY_TOO_LARGE", error: files }),
    ),
  ).toBe(files)

  const timeout =
    "The scan took longer than 15 minutes and was stopped. Very large repositories may not finish in time."
  expect(
    scanFailureMessage(
      failed({ error_code: "SCAN_TIMED_OUT", error: timeout }),
    ),
  ).toBe(timeout)
})

test("each code still has a sentence when the stored one is missing", () => {
  expect(
    scanFailureMessage(failed({ error_code: "REPOSITORY_TOO_LARGE" })),
  ).toMatch(/larger than CodeSage can analyse today/i)
  expect(scanFailureMessage(failed({ error_code: "SCAN_TIMED_OUT" }))).toMatch(
    /took too long/i,
  )
})

test("a failure with no code keeps the server's sentence, as before", () => {
  expect(
    scanFailureMessage(
      failed({ error: "The repository could not be analysed." }),
    ),
  ).toBe("The repository could not be analysed.")
  expect(scanFailureMessage(failed({}))).toBe(
    "The scan could not be completed.",
  )
})
