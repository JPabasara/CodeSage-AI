// The app-wide memory behind every read hook.

const MAX_ANSWERS = 100

const answers = new Map<string, { data: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

/** The part of a key after the epoch: `3:health:r1:main:latest` → `health:…`. */
const requestedPart = (key: string) => key.slice(key.indexOf(":") + 1)

function sameAnswer(a: unknown, b: unknown) {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function remember(key: string, data: unknown) {
  answers.delete(key) // re-insert, so the map's order is least-recent first
  answers.set(key, { data })
  if (answers.size > MAX_ANSWERS) {
    const oldest = answers.keys().next().value
    if (oldest !== undefined) answers.delete(oldest)
  }
}

/** The last good answer for `key`, wrapped so `undefined` data still counts. */
export function readCached<T>(key: string): { data: T } | undefined {
  return answers.get(key) as { data: T } | undefined
}

export function writeCached(key: string, data: unknown) {
  inflight.delete(key)
  remember(key, data)
}

// Ask once per key. A second caller while the first request is out joins it.
export function fetchShared<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: { fresh?: boolean },
): Promise<T> {
  if (!options?.fresh) {
    const joined = inflight.get(key)
    if (joined) return joined as Promise<T>
  }
  const request: Promise<T> = fetcher().then(
    (data) => {
      if (inflight.get(key) !== request) return data
      inflight.delete(key)
      const previous = answers.get(key)
      const kept =
        previous && sameAnswer(previous.data, data)
          ? (previous.data as T)
          : data
      remember(key, kept)
      return kept
    },
    (error: unknown) => {
      if (inflight.get(key) === request) {
        inflight.delete(key)
        answers.delete(key)
      }
      throw error
    },
  )
  inflight.set(key, request)
  return request
}

// Forget every read whose key (without the epoch) matches.
export function forgetQueries(matches: (key: string) => boolean) {
  for (const key of [...answers.keys()]) {
    if (matches(requestedPart(key))) answers.delete(key)
  }
  for (const key of [...inflight.keys()]) {
    if (matches(requestedPart(key))) inflight.delete(key)
  }
}

/** A scan finished: that branch's report and history, and the list's hint. */
export function forgetScanResults(repoId: string, branch: string) {
  forgetQueries(
    (key) =>
      key === "projects" ||
      key.startsWith(`health:${repoId}:${branch}:`) ||
      key === `scans:${repoId}:${branch}` ||
      key === `scans:${repoId}:default`,
  )
}

// A profile was saved, deleted, made the default, assigned or cleared.
export function forgetScores() {
  forgetQueries(
    (key) =>
      key.startsWith("health:") ||
      key.startsWith("projects") ||
      key === "profiles",
  )
}

/** Drop everything — the workspace changed. */
export function clearQueryCache() {
  answers.clear()
  inflight.clear()
}
