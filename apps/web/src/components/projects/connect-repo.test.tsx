import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

import { ConnectRepo } from "@/components/projects/connect-repo"

test("submits a public repository URL", async () => {
  const onConnect = vi.fn()
  render(<ConnectRepo onConnect={onConnect} />)

  await userEvent.type(
    screen.getByLabelText(/repository url/i),
    "https://github.com/acme/x",
  )
  await userEvent.click(screen.getByRole("button", { name: /connect/i }))

  expect(onConnect).toHaveBeenCalledWith("https://github.com/acme/x")
})

test("offers no private-repository option", () => {
  render(<ConnectRepo />)

  // Connecting a private repository is v2 (SRS SEC-04/SEC-06). The SRS specifies
  // this panel as a URL box and a Connect button - nothing else. Advertising a
  // GitHub App here would promise a feature two releases away.
  expect(screen.queryByText(/private/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/github app/i)).not.toBeInTheDocument()
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
})

test("will not submit an empty or whitespace-only URL", async () => {
  const onConnect = vi.fn()
  render(<ConnectRepo onConnect={onConnect} />)

  const button = screen.getByRole("button", { name: /connect/i })
  expect(button).toBeDisabled()

  await userEvent.type(screen.getByLabelText(/repository url/i), "   ")
  expect(button).toBeDisabled()
  expect(onConnect).not.toHaveBeenCalled()
})

test("locks the form while a connect is in flight", async () => {
  const onConnect = vi.fn()
  render(<ConnectRepo onConnect={onConnect} busy />)

  expect(screen.getByLabelText(/repository url/i)).toBeDisabled()
  const button = screen.getByRole("button", { name: /connecting/i })
  expect(button).toBeDisabled()

  // Double-submitting would connect the same repository twice.
  await userEvent.click(button)
  expect(onConnect).not.toHaveBeenCalled()
})
