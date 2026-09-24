import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, expect, test, vi } from "vitest"

import { TeamPanel } from "./team-panel"
import * as client from "@/lib/api/client"
import { useMembers } from "@/hooks/use-members"
import { mockSession, mockSessionViewer } from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: toastSuccess, error: toastError }),
}))

beforeEach(() => {
  toastSuccess.mockClear()
  toastError.mockClear()
})

function Harness({
  canManage,
  userId,
}: Readonly<{ canManage: boolean; userId: string }>) {
  return (
    <TeamPanel
      query={useMembers()}
      canManage={canManage}
      currentUserId={userId}
    />
  )
}

const asAdmin = () => render(<Harness canManage userId={mockSession.user_id} />)
const asViewer = () =>
  render(<Harness canManage={false} userId={mockSessionViewer.user_id} />)

const rowFor = async (name: RegExp) =>
  (await screen.findAllByTestId("member-row")).find((row) =>
    name.test(row.textContent ?? ""),
  ) as HTMLElement

test("a read-only role sees every member and invitation, and no controls", async () => {
  asViewer()

  expect(await screen.findAllByTestId("member-row")).toHaveLength(5)
  expect(screen.getByText("new.hire@example.com")).toBeVisible()
  expect(within(await rowFor(/Read Only/)).getByText("You")).toBeInTheDocument()
  // No name and no email from the provider still gives the row a label.
  const unnamed = await rowFor(/Unnamed member/)
  expect(within(unnamed).getByText("No email shared")).toBeVisible()
  expect(within(unnamed).getByText("Deactivated")).toBeVisible()

  expect(screen.queryByRole("heading", { name: /invite/i })).toBeNull()
  expect(screen.queryByRole("combobox")).toBeNull()
  expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull()
})

test("an org-admin manages others, but their own row stays read-only", async () => {
  asAdmin()

  const self = await rowFor(/Janidu/)
  expect(within(self).queryByRole("combobox")).toBeNull()
  expect(within(self).queryByRole("button")).toBeNull()

  expect(
    screen.getByRole("combobox", { name: "Role for Priya Fernando" }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: "Deactivate Priya Fernando" }),
  ).toBeInTheDocument()
  // A deactivated member has nothing left to change.
  expect(
    within(await rowFor(/Unnamed member/)).queryByRole("button"),
  ).toBeNull()
})

test("inviting adds a pending invitation", async () => {
  asAdmin()
  await userEvent.type(
    await screen.findByLabelText("Email"),
    "Teammate@Example.com",
  )
  await userEvent.click(screen.getByRole("button", { name: "Send invite" }))

  await waitFor(() =>
    expect(toastSuccess).toHaveBeenCalledWith(
      "Invitation sent to teammate@example.com",
      expect.anything(),
    ),
  )
  expect(await screen.findByText("teammate@example.com")).toBeVisible()
  expect(screen.getByLabelText("Email")).toHaveValue("")
})

test("the invitation role picker never offers org-admin", async () => {
  asAdmin()
  await userEvent.click(
    await screen.findByRole("combobox", { name: "Invite as role" }),
  )
  const options = screen.getAllByRole("option").map((o) => o.textContent)
  expect(options).toEqual(["Manager", "Developer", "Viewer"])
})

test("a malformed email is caught before any request", async () => {
  const create = vi.spyOn(client, "createInvitation")
  asAdmin()
  await userEvent.type(await screen.findByLabelText("Email"), "not-an-email")
  await userEvent.click(screen.getByRole("button", { name: "Send invite" }))

  expect(screen.getByRole("alert")).toHaveTextContent(/valid email/i)
  expect(create).not.toHaveBeenCalled()
  create.mockRestore()
})

test("an address already invited is a conflict, not a delivery failure", async () => {
  asAdmin()
  await userEvent.type(
    await screen.findByLabelText("Email"),
    "new.hire@example.com",
  )
  await userEvent.click(screen.getByRole("button", { name: "Send invite" }))

  const alert = await screen.findByRole("alert")
  expect(alert).toHaveTextContent(/already a member or already has/i)
  expect(alert).toHaveAttribute("data-kind", "validation")
})

test("a delivery failure says so and leaves no false pending invitation", async () => {
  asAdmin()
  await userEvent.type(
    await screen.findByLabelText("Email"),
    "someone@bounce.example",
  )
  await userEvent.click(screen.getByRole("button", { name: "Send invite" }))

  const alert = await screen.findByRole("alert")
  expect(alert).toHaveAttribute("data-kind", "delivery")
  expect(alert).toHaveTextContent(/no invitation was created/i)
  expect(screen.queryByText("someone@bounce.example")).toBeNull()
})

test("revoking removes the pending invitation", async () => {
  asAdmin()
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Revoke invitation to new.hire@example.com",
    }),
  )
  await waitFor(() =>
    expect(screen.queryByText("new.hire@example.com")).toBeNull(),
  )
  expect(screen.getByText("No one is waiting to join.")).toBeVisible()
})

test("changing a role sends it and confirms by name", async () => {
  const change = vi.spyOn(client, "changeMemberRole")
  asAdmin()
  await userEvent.click(
    await screen.findByRole("combobox", { name: "Role for Priya Fernando" }),
  )
  await userEvent.click(screen.getByRole("option", { name: "Viewer" }))

  await waitFor(() =>
    expect(change).toHaveBeenCalledWith(
      "a1000000-0000-4000-8000-000000000002",
      "viewer",
    ),
  )
  expect(toastSuccess).toHaveBeenCalledWith("Priya Fernando is now Viewer")
  change.mockRestore()
})

test("deactivation names the member and needs a confirm", async () => {
  asAdmin()
  await userEvent.click(
    await screen.findByRole("button", { name: "Deactivate Sam Perera" }),
  )
  const dialog = await screen.findByRole("dialog", {
    name: "Deactivate Sam Perera?",
  })
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Deactivate Sam Perera" }),
  )

  await waitFor(() =>
    expect(within(rowForSync(/Sam Perera/)).getByText("Deactivated")),
  )
  expect(toastSuccess).toHaveBeenCalledWith("Sam Perera was deactivated")
})

test("the last-org-admin conflict is explained, not shown as a 409", async () => {
  server.use(
    http.patch("*/api/members/:id/role", () =>
      HttpResponse.json(
        { detail: "Conflict.", code: "CONFLICT" },
        { status: 409 },
      ),
    ),
  )
  asAdmin()
  await userEvent.click(
    await screen.findByRole("combobox", { name: "Role for Priya Fernando" }),
  )
  await userEvent.click(screen.getByRole("option", { name: "Developer" }))

  await waitFor(() =>
    expect(toastError).toHaveBeenCalledWith(
      "Priya Fernando is the only active org-admin. Make someone else an org-admin first.",
    ),
  )
})

test("a 403 reads as a permission message", async () => {
  server.use(
    http.delete("*/api/members/:id", () =>
      HttpResponse.json(
        { detail: "Forbidden.", code: "FORBIDDEN" },
        { status: 403 },
      ),
    ),
  )
  asAdmin()
  await userEvent.click(
    await screen.findByRole("button", { name: "Deactivate Sam Perera" }),
  )
  await userEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Deactivate Sam Perera",
    }),
  )
  await waitFor(() =>
    expect(toastError).toHaveBeenCalledWith(
      "Only an org-admin can manage members.",
    ),
  )
})

function rowForSync(name: RegExp) {
  return screen
    .getAllByTestId("member-row")
    .find((row) => name.test(row.textContent ?? "")) as HTMLElement
}
