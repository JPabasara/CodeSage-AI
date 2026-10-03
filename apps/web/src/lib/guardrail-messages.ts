// One plain sentence for every way a repository can be refused or a scan can end early (13H.1).

import { ApiRequestError } from "@/lib/api/client"
import type { ErrorCode, ScanErrorCode, ScanStatus } from "@/lib/types"

export const NO_JAVA_MESSAGE =
  "We couldn't find any Java in this repository. CodeSage reads Java for now; more languages are coming soon."

export const INVALID_REPOSITORY_URL_MESSAGE =
  "Please enter a valid GitHub repository link, for example https://github.com/owner/repository."

/** A complete GitHub owner/repository URL, before the API is asked to connect it. */
export function isGitHubRepositoryUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com"
    ) {
      return false
    }
    if (url.username || url.password || url.search || url.hash) return false
    const segments = url.pathname
      .replace(/\.git\/?$/, "")
      .split("/")
      .filter(Boolean)
    return (
      segments.length === 2 && segments.every((segment) => segment.length > 0)
    )
  } catch {
    return false
  }
}

const CONNECT_MESSAGE: Partial<Record<ErrorCode, string>> = {
  INVALID_REPOSITORY_URL: INVALID_REPOSITORY_URL_MESSAGE,
  VALIDATION_FAILED: INVALID_REPOSITORY_URL_MESSAGE,
  REPOSITORY_NOT_PUBLIC:
    "Private repositories cannot be connected yet. Please use a public GitHub repository.",
  REPOSITORY_UNREACHABLE:
    "That repository could not be reached. Check the URL and try again.",
  ALREADY_CONNECTED: "That repository is already connected.",
  REPOSITORY_TOO_LARGE:
    "This repository is larger than CodeSage can analyse today.",
  REPOSITORY_HAS_NO_JAVA: NO_JAVA_MESSAGE,
}

function spoken(items: string[]) {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

export function connectFailureMessage(err: unknown): string {
  if (err instanceof ApiRequestError && err.code) {
    if (err.code === "REPOSITORY_HAS_NO_JAVA") {
      // Naming what GitHub did find is what makes the refusal read as accurate rather than as a guess.
      const found = err.languages ?? []
      return found.length > 0
        ? `${NO_JAVA_MESSAGE} GitHub lists ${spoken(found.slice(0, 3))}.`
        : `${NO_JAVA_MESSAGE} GitHub lists no code in it.`
    }
    if (err.code === "REPOSITORY_TOO_LARGE" && /\d/.test(err.detail)) {
      return err.detail
    }
    const message = CONNECT_MESSAGE[err.code]
    if (message) return message
  }
  return err instanceof Error
    ? err.message
    : "Couldn't connect that repository."
}

const SCAN_FAILURE: Record<ScanErrorCode, string> = {
  NO_JAVA_FILES:
    "No Java files on this branch. CodeSage reads Java for now; more languages are coming soon.",
  REPOSITORY_TOO_LARGE:
    "This branch is larger than CodeSage can analyse today.",
  SCAN_TIMED_OUT:
    "The scan took too long and was stopped. Very large repositories may not finish in time.",
}

/** Why a scan ended in `error`, for the failed toast. */
export function scanFailureMessage(status: ScanStatus): string {
  const code = status.error_code
  if (code === "REPOSITORY_TOO_LARGE" || code === "SCAN_TIMED_OUT") {
    return status.error || SCAN_FAILURE[code]
  }
  if (code && code in SCAN_FAILURE) return SCAN_FAILURE[code]
  return status.error || "The scan could not be completed."
}
