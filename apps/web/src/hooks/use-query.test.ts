import { act, renderHook, waitFor } from "@testing-library/react"
import { expect, test } from "vitest"

import { useQuery } from "./use-query"

// `reload` and `refetch` differ in exactly one way — whether the screen admits
// it is fetching again — and each is a bug in the other's place. A quiet reload
// behind Retry makes the button look dead; a loud one after "project connected"
// blanks a list the user was reading. These four tests pin both halves.
//
// No MSW here on purpose: `useQuery` takes the fetcher as an argument, so the
// hook can be tested without a network at all.

/** A promise this test resolves by hand, so "still in flight" is assertable. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

test("reload refetches quietly: the old data never leaves the screen", async () => {
  let inFlight = deferred<string>()
  const { result } = renderHook(() => useQuery("k", () => inFlight.promise))

  inFlight.resolve("first")
  await waitFor(() => expect(result.current.data).toBe("first"))

  // A second request that has deliberately not answered yet.
  inFlight = deferred<string>()
  act(() => result.current.reload())

  expect(result.current.loading).toBe(false)
  expect(result.current.data).toBe("first")

  inFlight.resolve("second")
  await waitFor(() => expect(result.current.data).toBe("second"))
})

test("refetch refetches loudly: the screen goes back to loading first", async () => {
  let inFlight = deferred<string>()
  const { result } = renderHook(() => useQuery("k", () => inFlight.promise))

  inFlight.resolve("first")
  await waitFor(() => expect(result.current.data).toBe("first"))

  inFlight = deferred<string>()
  act(() => result.current.refetch())

  // The whole point of #110: pressing Retry visibly does something.
  expect(result.current.loading).toBe(true)
  expect(result.current.data).toBeUndefined()

  inFlight.resolve("second")
  await waitFor(() => expect(result.current.data).toBe("second"))
  expect(result.current.loading).toBe(false)
})

test("refetch clears a stale error, so a recovered backend renders data", async () => {
  let broken = true
  const { result } = renderHook(() =>
    useQuery("k", () =>
      broken ? Promise.reject(new Error("boom")) : Promise.resolve("ok"),
    ),
  )

  await waitFor(() => expect(result.current.error).toBeDefined())

  broken = false
  act(() => result.current.refetch())

  expect(result.current.error).toBeUndefined()
  expect(result.current.loading).toBe(true)

  await waitFor(() => expect(result.current.data).toBe("ok"))
  expect(result.current.error).toBeUndefined()
})

test("reload leaves a stale error up until the new answer lands", async () => {
  let inFlight = deferred<string>()
  let broken = true
  const { result } = renderHook(() =>
    useQuery("k", () =>
      broken ? Promise.reject(new Error("boom")) : inFlight.promise,
    ),
  )

  await waitFor(() => expect(result.current.error).toBeDefined())

  broken = false
  inFlight = deferred<string>()
  act(() => result.current.reload())

  // Nothing has changed on screen yet. Right after a write, wrong behind Retry
  // — which is why the two functions exist rather than one.
  expect(result.current.error).toBeDefined()
  expect(result.current.loading).toBe(false)

  inFlight.resolve("ok")
  await waitFor(() => expect(result.current.data).toBe("ok"))
  expect(result.current.error).toBeUndefined()
})

test("a local update cannot be overwritten by an older request", async () => {
  const inFlight = deferred<string[]>()
  const { result } = renderHook(() => useQuery("k", () => inFlight.promise))

  act(() => result.current.update(() => ["after-write"]))
  expect(result.current.data).toEqual(["after-write"])

  inFlight.resolve(["stale-before-write"])
  await act(async () => {
    await inFlight.promise
  })

  expect(result.current.data).toEqual(["after-write"])
})

// ── the workspace gate ──────────────────────────────────────────────────────

test("with no workspace, a workspace-bound read sends nothing and waits", async () => {
  const { noteActiveWorkspace } = await import("./use-workspace-scope")
  noteActiveWorkspace(null)
  let calls = 0
  const { result } = renderHook(() =>
    useQuery("gated", () => {
      calls += 1
      return Promise.resolve("data")
    }),
  )

  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(calls).toBe(0)
  expect(result.current.loading).toBe(true)
  expect(result.current.error).toBeUndefined()

  // The workspace arrives; the read goes out once.
  act(() => noteActiveWorkspace("ws-1"))
  await waitFor(() => expect(result.current.data).toBe("data"))
  expect(calls).toBe(1)
})

test("an account read runs without a workspace", async () => {
  const { noteActiveWorkspace } = await import("./use-workspace-scope")
  noteActiveWorkspace(null)
  const { result } = renderHook(() =>
    useQuery("session", () => Promise.resolve("me"), { scope: "account" }),
  )
  await waitFor(() => expect(result.current.data).toBe("me"))
})

test("WORKSPACE_REQUIRED from the API locks the app instead of erroring it", async () => {
  const { ApiRequestError } = await import("@/lib/api/client")
  const { readActiveWorkspaceId } = await import("./use-workspace-scope")
  renderHook(() =>
    useQuery("projects", () =>
      Promise.reject(
        new ApiRequestError(409, "WORKSPACE_REQUIRED", "Create one."),
      ),
    ),
  )
  await waitFor(() => expect(readActiveWorkspaceId()).toBeNull())
})

test("enabled: false sends nothing and waits; turning it on asks once", async () => {
  const { noteActiveWorkspace } = await import("./use-workspace-scope")
  noteActiveWorkspace("ws-1")
  let calls = 0
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useQuery(
        "held",
        () => {
          calls += 1
          return Promise.resolve("data")
        },
        { enabled },
      ),
    { initialProps: { enabled: false } },
  )

  // The dashboard's case: the branch is not known yet, so there is nothing
  // worth asking — and an empty branch must not be asked about either.
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(calls).toBe(0)
  expect(result.current.loading).toBe(true)
  expect(result.current.error).toBeUndefined()

  rerender({ enabled: true })
  await waitFor(() => expect(result.current.data).toBe("data"))
  expect(calls).toBe(1)
})
