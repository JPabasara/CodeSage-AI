import { render, screen, waitFor } from "@testing-library/react"
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

  for (const name of ["Balanced", "Security-first", "Delivery-speed"]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument()
  }
})

test("an untouched preset is sent WITH its name", async () => {
  const put = vi.spyOn(client, "applyProfile")
  render(<ProfilesPage />)
  await ready()

  await userEvent.click(screen.getByRole("button", { name: "Security-first" }))
  expect(screen.getByTestId("profile-label")).toHaveTextContent("Security-first")

  await userEvent.click(screen.getByRole("button", { name: "Apply" }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))

  // The numbers are still exactly the preset's, so the name records where they
  // came from.
  expect(put.mock.calls[0][0].name).toBe("Security-first")
  put.mockRestore()
})

test("dragging away from a preset makes it Custom and omits the name", async () => {
  const put = vi.spyOn(client, "applyProfile")
  render(<ProfilesPage />)
  await ready()

  await userEvent.click(screen.getByRole("button", { name: "Security-first" }))
  expect(screen.getByTestId("profile-label")).toHaveTextContent("Security-first")

  // Nudge one weight - the values are no longer Security-first.
  const securitySlider = screen.getByRole("slider", { name: /security weight/i })
  securitySlider.focus()
  await userEvent.keyboard("{ArrowLeft}")

  await waitFor(() =>
    expect(screen.getByTestId("profile-label")).toHaveTextContent("Custom"),
  )

  await userEvent.click(screen.getByRole("button", { name: "Apply" }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))

  // Contract: "omit it for a custom profile". Sending "Security-first" here
  // would mislabel a profile that is not Security-first.
  expect(put.mock.calls[0][0].name).toBeUndefined()
  put.mockRestore()
})

test("the mock stores an edited preset as a custom, non-preset profile", async () => {
  render(<ProfilesPage />)
  await ready()

  const securitySlider = screen.getByRole("slider", { name: /security weight/i })
  securitySlider.focus()
  await userEvent.keyboard("{ArrowRight}")
  await userEvent.click(screen.getByRole("button", { name: "Apply" }))

  // Round-trips through the real MSW handler: name "Custom", is_preset false.
  const saved = await client.getActiveProfile()
  expect(saved.name).toBe("Custom")
  expect(saved.is_preset).toBe(false)
  expect(saved.is_active).toBe(true)
})
