import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import ProfilesPage from "./page"
import * as client from "@/lib/api/client"

/** Wait for the seed-from-active load to finish. */
async function ready() {
  expect(await screen.findByText("Category weights")).toBeInTheDocument()
}

test("shows six numbers: five category weights plus the trust slider", async () => {
  render(<ProfilesPage />)
  await ready()

  for (const key of [
    "security",
    "code_design",
    "requirement",
    "documentation",
    "test",
  ]) {
    expect(screen.getByTestId(`value-${key}`)).toBeInTheDocument()
  }
  expect(screen.getByTestId("value-trust_s")).toBeInTheDocument()

  // Six sliders, no more and no fewer.
  expect(screen.getAllByRole("slider")).toHaveLength(6)
})

test("opens showing the profile that is really applied, not a guess", async () => {
  render(<ProfilesPage />)
  await ready()

  // mockProfiles marks Balanced active: all weights 1.0, trust 0.5.
  expect(screen.getByTestId("value-security")).toHaveTextContent("1.0")
  expect(screen.getByTestId("value-trust_s")).toHaveTextContent("0.50")
})

test("picking a preset seeds the sliders without saving anything", async () => {
  const put = vi.spyOn(client, "applyProfile")
  render(<ProfilesPage />)
  await ready()

  await userEvent.click(screen.getByRole("button", { name: "Security-first" }))

  // Security-first is 3.0 on security (presets.yaml).
  await waitFor(() =>
    expect(screen.getByTestId("value-security")).toHaveTextContent("3.0"),
  )
  // Nothing is sent while the user is choosing — only Apply writes.
  expect(put).not.toHaveBeenCalled()
  put.mockRestore()
})

test("Apply sends the complete profile — six numbers, never a delta", async () => {
  const put = vi.spyOn(client, "applyProfile")
  render(<ProfilesPage />)
  await ready()

  await userEvent.click(screen.getByRole("button", { name: "Security-first" }))
  await userEvent.click(screen.getByRole("button", { name: "Apply" }))

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  const body = put.mock.calls[0][0]
  expect(Object.keys(body.weights).sort()).toEqual([
    "code_design",
    "documentation",
    "requirement",
    "security",
    "test",
  ])
  expect(typeof body.trust_s).toBe("number")
  put.mockRestore()
})

test("adopts the clamped values the server returns, not what it sent", async () => {
  // The server clamps rather than rejecting: 9.0 comes back as 3.0 with a 200.
  const put = vi
    .spyOn(client, "applyProfile")
    .mockResolvedValue({
      id: "custom",
      name: "Custom",
      weights: {
        security: 3.0, // clamped down from an out-of-range request
        code_design: 1.0,
        requirement: 1.0,
        documentation: 1.0,
        test: 1.0,
      },
      trust_s: 1,
      is_preset: false,
      is_active: true,
    })

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(screen.getByRole("button", { name: "Apply" }))

  await waitFor(() =>
    expect(screen.getByTestId("value-security")).toHaveTextContent("3.0"),
  )
  expect(screen.getByTestId("value-trust_s")).toHaveTextContent("1.00")
  put.mockRestore()
})

test("the three presets are offered", async () => {
  render(<ProfilesPage />)
  await ready()

  const presets = screen.getByText("Start from a preset").parentElement!
  for (const name of ["Balanced", "Security-first", "Delivery-speed"]) {
    expect(within(presets).getByRole("button", { name })).toBeInTheDocument()
  }
})
