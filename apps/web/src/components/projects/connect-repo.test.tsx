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

  // Connecting a private repository is v2 — it needs a GitHub App installation.
  expect(screen.queryByText(/private/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/github app/i)).not.toBeInTheDocument()
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
})

test("says only Java is analysed, and links to the article that explains it", () => {
  render(<ConnectRepo />)

  const note = screen.getByText(/java only\. other files are ignored\./i)
  const link = screen.getByRole("link", { name: "What is analysed" })
  expect(link).toHaveAttribute("href", "/help/what-is-analysed")
  expect(note).toContainElement(link)
  // The note is read with the field, not only seen next to it.
  expect(screen.getByLabelText(/repository url/i)).toHaveAttribute(
    "aria-describedby",
    note.id,
  )
})

test("a refusal and the Java note both describe the field", () => {
  render(<ConnectRepo error="Too large." />)

  const describedBy =
    screen.getByLabelText(/repository url/i).getAttribute("aria-describedby") ??
    ""
  expect(describedBy.split(" ")).toEqual([
    screen.getByRole("alert").id,
    screen.getByText(/java only/i).id,
  ])
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

test("a refusal is shown under the URL field and tied to it", () => {
  render(<ConnectRepo error="We couldn't find any Java in this repository." />)

  const input = screen.getByLabelText(/repository url/i)
  const message = screen.getByRole("alert")
  expect(message).toHaveTextContent(/couldn't find any java/i)
  expect(input).toHaveAttribute("aria-invalid", "true")
  expect(input.getAttribute("aria-describedby")).toContain(message.id)
})

test("no refusal, no message and no invalid state", () => {
  render(<ConnectRepo />)

  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(screen.getByLabelText(/repository url/i)).not.toHaveAttribute(
    "aria-invalid",
  )
})

test("a refused URL stays in the box, so the message still describes it", async () => {
  const onConnect = vi.fn().mockResolvedValue(false)
  render(<ConnectRepo onConnect={onConnect} />)

  const input = screen.getByLabelText(/repository url/i)
  await userEvent.type(input, "https://github.com/acme/nojava-site")
  await userEvent.click(screen.getByRole("button", { name: /connect/i }))

  expect(onConnect).toHaveBeenCalledWith("https://github.com/acme/nojava-site")
  expect(input).toHaveValue("https://github.com/acme/nojava-site")
})

test("a successful connect clears the box", async () => {
  const onConnect = vi.fn().mockResolvedValue(true)
  render(<ConnectRepo onConnect={onConnect} />)

  const input = screen.getByLabelText(/repository url/i)
  await userEvent.type(input, "https://github.com/acme/x")
  await userEvent.click(screen.getByRole("button", { name: /connect/i }))

  expect(input).toHaveValue("")
})

test("editing the URL clears the refusal it no longer describes", async () => {
  const onErrorClear = vi.fn()
  render(<ConnectRepo error="Too large." onErrorClear={onErrorClear} />)

  await userEvent.type(screen.getByLabelText(/repository url/i), "h")

  expect(onErrorClear).toHaveBeenCalled()
})
