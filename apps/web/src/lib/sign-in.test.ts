import { beforeEach, expect, test } from "vitest"

import {
  consumeSignedOut,
  markSignedOut,
  resetSignedOutNotice,
  signInErrorMessage,
  signInHref,
} from "./sign-in"

test("the plain sign-in link carries no return_to", () => {
  const url = new URL(signInHref())
  expect(url.pathname).toBe("/api/auth/login")
  expect(url.search).toBe("")
})

test("return_to is encoded as one query value, query and all", () => {
  const url = new URL(signInHref("/invitations/accept?token=a&b=c d"))
  // One parameter, not three: the inner `&` and `?` must not split it.
  expect([...url.searchParams.keys()]).toEqual(["return_to"])
  expect(url.searchParams.get("return_to")).toBe(
    "/invitations/accept?token=a&b=c d",
  )
})

beforeEach(() => {
  sessionStorage.clear()
  resetSignedOutNotice()
})

test.each([
  ["expired", /took too long/],
  ["invalid", /wasn't valid/],
  ["failed", /couldn't confirm/],
  ["session", /session ended/],
])("the %s code has its own message", (code, message) => {
  expect(signInErrorMessage(code)).toMatch(message)
})

test("an unknown code gets the generic line, never the raw value", () => {
  const message = signInErrorMessage("<img src=x onerror=alert(1)>")
  expect(message).toMatch(/something went wrong/i)
  expect(message).not.toContain("<img")
  // Not fooled by names every object has.
  expect(signInErrorMessage("constructor")).toMatch(/something went wrong/i)
})

test("no code means no message", () => {
  expect(signInErrorMessage(undefined)).toBeUndefined()
  expect(signInErrorMessage("")).toBeUndefined()
})

test("a repeated parameter uses its first value", () => {
  expect(signInErrorMessage(["expired", "failed"])).toMatch(/took too long/)
})

test("the signed-out note shows once, and survives re-renders", () => {
  markSignedOut()
  expect(consumeSignedOut()).toBe(true)
  expect(consumeSignedOut()).toBe(true) // same page, same answer
  expect(sessionStorage.getItem("codesage.signedOut")).toBeNull()

  resetSignedOutNotice() // a fresh page load
  expect(consumeSignedOut()).toBe(false)
})
