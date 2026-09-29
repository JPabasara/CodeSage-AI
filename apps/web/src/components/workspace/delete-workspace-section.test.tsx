import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, expect, test, vi } from "vitest"

import { DeleteWorkspaceSection } from "./delete-workspace-section"
import * as client from "@/lib/api/client"
import { getWorkspaces } from "@/lib/api/client"
import { WORKSPACE_ID } from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccess,
    error: vi.fn(),
  }),
}))

beforeEach(() => toastSuccess.mockClear())

function setup(onDeleted = vi.fn()) {
  render(
    <DeleteWorkspaceSection
      workspaceId={WORKSPACE_ID}
      workspaceName="Acme Engineering"
      onDeleted={onDeleted}
    />,
  )
  return onDeleted
}

async function openDialog() {
  await userEvent.click(
    screen.getByRole("button", { name: "Delete workspace" }),
  )
  return screen.findByRole("dialog", {
    name: "Delete Acme Engineering permanently?",
  })
}

test("requires the exact workspace name and permanently deletes", async () => {
  const request = vi.spyOn(client, "deleteWorkspace")
  const onDeleted = setup()
  const dialog = await openDialog()
  const confirmation = within(dialog).getByLabelText(
    "Type Acme Engineering to confirm",
  )
  const submit = within(dialog).getByRole("button", {
    name: "Delete workspace permanently",
  })

  expect(submit).toBeDisabled()
  await userEvent.type(confirmation, "Acme")
  expect(submit).toBeDisabled()
  await userEvent.clear(confirmation)
  await userEvent.type(confirmation, "Acme Engineering")
  expect(submit).toBeEnabled()
  await userEvent.click(submit)

  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
  expect(request).toHaveBeenCalledWith(WORKSPACE_ID, {
    confirmation_name: "Acme Engineering",
  })
  expect(toastSuccess).toHaveBeenCalledWith(
    "Acme Engineering was permanently deleted",
  )
  const remaining = await getWorkspaces()
  expect(remaining.map((item) => item.name)).not.toContain("Acme Engineering")
  // The session drops to no workspace; it is not moved into another one.
  expect(remaining.filter((item) => item.is_active)).toEqual([])
  request.mockRestore()
})

test("keeps the confirmation open when a scan blocks deletion", async () => {
  server.use(
    http.delete("*/api/auth/workspaces/:workspaceId", () =>
      HttpResponse.json(
        {
          detail: "A scan is active.",
          code: "WORKSPACE_SCAN_RUNNING",
        },
        { status: 409 },
      ),
    ),
  )
  const onDeleted = setup()
  const dialog = await openDialog()
  const confirmation = within(dialog).getByLabelText(
    "Type Acme Engineering to confirm",
  )
  await userEvent.type(confirmation, "Acme Engineering")
  await userEvent.click(
    within(dialog).getByRole("button", {
      name: "Delete workspace permanently",
    }),
  )

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    /stop or wait for every queued or running scan/i,
  )
  expect(confirmation).toHaveValue("Acme Engineering")
  expect(onDeleted).not.toHaveBeenCalled()
})
