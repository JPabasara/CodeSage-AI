import { beforeEach, expect, test } from "vitest"

import {
  consumeSignedOut,
  markSignedOut,
  resetSignedOutNotice,
  signInErrorMessage,
} from "./sign-in"

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
