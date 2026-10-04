import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import {
  JavaOnlyDialog,
  javaOnlyAckKey,
  readJavaOnlyAck,
  repositoryLabel,
} from "@/components/projects/java-only-dialog"

const ACK_KEY = javaOnlyAckKey("user-1", "workspace-1")

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function renderDialog(
  props: Partial<React.ComponentProps<typeof JavaOnlyDialog>> = {},
) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const view = render(
    <JavaOnlyDialog
      repository="jhy/jsoup"
      ackKey={ACK_KEY}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  )
  return { ...view, onConfirm, onCancel }
}

test("names the repository and says what is and is not analysed", () => {
  renderDialog()

  const dialog = screen.getByRole("alertdialog")
  expect(
    within(dialog).getByRole("heading", { name: "Connect jhy/jsoup?" }),
  ).toBeInTheDocument()
  expect(dialog).toHaveTextContent(/java source code only/i)

  const analysed = within(dialog)
    .getByRole("heading", { name: "Analysed" })
    .closest("div")!
  expect(analysed).toHaveTextContent(".java files on the branch you scan")
  expect(analysed).toHaveTextContent(/test code, tagged separately/i)
  expect(analysed).toHaveTextContent(
    "pom.xml / build.gradle, only to detect the Java version",
  )
  expect(analysed).toHaveTextContent(/git history, for change frequency/i)

  const notAnalysed = within(dialog)
    .getByRole("heading", { name: "Not analysed" })
    .closest("div")!
  expect(notAnalysed).toHaveTextContent("Markdown and docs (.md)")
  expect(notAnalysed).toHaveTextContent("Resources, XML, properties, YAML")
  expect(notAnalysed).toHaveTextContent(/other languages/i)
  expect(notAnalysed).toHaveTextContent("Files over 1 MB and binaries")

  expect(
    within(dialog).getByRole("link", { name: /what is analysed/i }),
  ).toHaveAttribute("href", "/help/what-is-analysed")
})

test("Connect and scan has the focus, so Enter takes the usual next step", async () => {
  renderDialog()

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Connect and scan" }),
    ).toHaveFocus(),
  )
})

test("Connect only connects without a scan", async () => {
  const { onConfirm, onCancel } = renderDialog()

  await userEvent.click(screen.getByRole("button", { name: "Connect only" }))

  expect(onConfirm).toHaveBeenCalledExactlyOnceWith("connect")
  expect(onCancel).not.toHaveBeenCalled()
  // Unticked: the question comes back next time.
  expect(readJavaOnlyAck(ACK_KEY)).toBeUndefined()
})

test("Connect and scan connects and asks for the first scan", async () => {
  const { onConfirm, onCancel } = renderDialog()

  await userEvent.click(
    screen.getByRole("button", { name: "Connect and scan" }),
  )

  expect(onConfirm).toHaveBeenCalledExactlyOnceWith("scan")
  expect(onCancel).not.toHaveBeenCalled()
})

test("Cancel and Escape connect nothing", async () => {
  const { onConfirm, onCancel } = renderDialog()

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(onCancel).toHaveBeenCalledTimes(1)

  // The page closes it; here it is still open, so Escape asks again.
  await userEvent.keyboard("{Escape}")
  expect(onCancel).toHaveBeenCalledTimes(2)
  expect(onConfirm).not.toHaveBeenCalled()
})

test("closed while no repository is waiting", () => {
  renderDialog({ repository: undefined })

  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
})

test("Don't show this again remembers the choice for this person and workspace", async () => {
  const { onConfirm } = renderDialog()

  await userEvent.click(
    screen.getByRole("checkbox", {
      name: "Don't show this again in this workspace",
    }),
  )
  await userEvent.click(screen.getByRole("button", { name: "Connect only" }))

  expect(onConfirm).toHaveBeenCalledWith("connect")
  expect(
    localStorage.getItem("codesage.javaOnlyAck.v1:user-1:workspace-1"),
  ).toBe("connect")
  expect(readJavaOnlyAck(ACK_KEY)).toBe("connect")
  // Another workspace still asks.
  expect(
    readJavaOnlyAck(javaOnlyAckKey("user-1", "workspace-2")),
  ).toBeUndefined()
})

test("a remembered Connect and scan is read back as a scan", async () => {
  renderDialog()

  await userEvent.click(screen.getByRole("checkbox"))
  await userEvent.click(
    screen.getByRole("button", { name: "Connect and scan" }),
  )

  expect(readJavaOnlyAck(ACK_KEY)).toBe("scan")
})

test("Cancel saves nothing, even with the box ticked", async () => {
  renderDialog()

  await userEvent.click(screen.getByRole("checkbox"))
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }))

  expect(readJavaOnlyAck(ACK_KEY)).toBeUndefined()
})

test("the box starts clear every time the dialog opens", async () => {
  const { rerender, onConfirm, onCancel } = renderDialog()
  await userEvent.click(screen.getByRole("checkbox"))
  expect(screen.getByRole("checkbox")).toBeChecked()

  rerender(
    <JavaOnlyDialog
      repository={undefined}
      ackKey={ACK_KEY}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
  rerender(
    <JavaOnlyDialog
      repository="acme/other"
      ackKey={ACK_KEY}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )

  expect(
    await screen.findByRole("heading", { name: "Connect acme/other?" }),
  ).toBeInTheDocument()
  expect(screen.getByRole("checkbox")).not.toBeChecked()
})

test("without a session to key it by, the box cannot be ticked", () => {
  renderDialog({ ackKey: undefined })

  expect(screen.getByRole("checkbox")).toBeDisabled()
  expect(readJavaOnlyAck(undefined)).toBeUndefined()
})

test("blocked storage is not an error: the dialog simply asks again", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked")
  })
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked")
  })
  const { onConfirm } = renderDialog()

  await userEvent.click(screen.getByRole("checkbox"))
  await userEvent.click(screen.getByRole("button", { name: "Connect only" }))

  expect(onConfirm).toHaveBeenCalledWith("connect")
  expect(readJavaOnlyAck(ACK_KEY)).toBeUndefined()
})

test("the title's owner/repo comes from the URL", () => {
  expect(repositoryLabel("https://github.com/jhy/jsoup")).toBe("jhy/jsoup")
  expect(repositoryLabel("https://github.com/jhy/jsoup.git")).toBe("jhy/jsoup")
  expect(repositoryLabel("https://github.com/jhy/jsoup/")).toBe("jhy/jsoup")
})
