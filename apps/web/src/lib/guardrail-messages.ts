// One plain sentence for every way a repository can be refused or a scan can
// end early (13H.1). Chosen by `code`, never by parsing `detail`: the server's
// wording may change, the code never does.

import { ApiRequestError } from "@/lib/api/client"
import type { ErrorCode, ScanErrorCode, ScanStatus } from "@/lib/types"

export const NO_JAVA_MESSAGE =
  "We couldn't find any Java in this repository. CodeSage reads Java for now; more languages are coming soon."

// Each code is a different thing for the user to do about it, which is why they
// are separate rather than one 400; a bare "400 Bad Request" leaves someone who
// pasted a repository with no idea what went wrong.
const CONNECT_MESSAGE: Partial<Record<ErrorCode, string>> = {
  INVALID_REPOSITORY_URL: "That does not look like a repository URL.",
  REPOSITORY_NOT_PUBLIC:
    "Only public repositories can be connected in this release.",
  REPOSITORY_UNREACHABLE:
    "That repository could not be reached. Check the URL and try again.",
  ALREADY_CONNECTED: "That repository is already connected.",
  REPOSITORY_TOO_LARGE:
    "This repository is larger than CodeSage can analyse today.",
  REPOSITORY_HAS_NO_JAVA: NO_JAVA_MESSAGE,
}

/** "Python, Shell and HTML" — a list the way a person would say it. */
function spoken(items: string[]) {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

/** Why connecting `url` failed, in one sentence for the form and the toast. */
export function connectFailureMessage(err: unknown): string {
  if (err instanceof ApiRequestError && err.code) {
    if (err.code === "REPOSITORY_HAS_NO_JAVA") {
      // Naming what GitHub did find is what makes the refusal read as accurate
      // rather than as a guess.
      const found = err.languages ?? []
      return found.length > 0
        ? `${NO_JAVA_MESSAGE} GitHub lists ${spoken(found.slice(0, 3))}.`
        : `${NO_JAVA_MESSAGE} GitHub lists no code in it.`
    }
    // The size limit is a setting, so the server's sentence is the one that
    // names today's number. The fixed sentence covers a proxy that lost it.
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
  // The branch size and time limits are settings, so the stored sentence is
  // the one that names the number; the fixed sentence is the fallback.
  if (code === "REPOSITORY_TOO_LARGE" || code === "SCAN_TIMED_OUT") {
    return status.error || SCAN_FAILURE[code]
  }
  if (code && code in SCAN_FAILURE) return SCAN_FAILURE[code]
  return status.error || "The scan could not be completed."
}
