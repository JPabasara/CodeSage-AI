import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test } from "vitest"

import { LockedAction } from "@/components/locked-action"
import { Button } from "@/components/ui/button"

const REASON = "Viewers can't start scans"

function renderLocked() {
  render(
    <LockedAction reason={REASON}>
      <Button disabled>Scan</Button>
    </LockedAction>,
  )
}

test("the action stays visible but disabled", () => {
  renderLocked()
  expect(screen.getByRole("button", { name: "Scan" })).toBeDisabled()
})

test("keyboard focus reaches the locked action and shows the reason", async () => {
  const user = userEvent.setup()
  renderLocked()

  // A disabled button takes no focus, so the wrapper does.
  await user.tab()
  const wrapper = screen.getByLabelText(REASON)
  expect(wrapper).toHaveFocus()
  expect(await screen.findByRole("tooltip")).toHaveTextContent(REASON)
})

test("hovering the locked action shows the reason too", async () => {
  const user = userEvent.setup()
  renderLocked()

  await user.hover(screen.getByLabelText(REASON))
  expect(await screen.findByRole("tooltip")).toHaveTextContent(REASON)
})
