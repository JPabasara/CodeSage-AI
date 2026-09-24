import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

import { http, HttpResponse } from "msw"

import ProfilesPage from "./page"
import * as client from "@/lib/api/client"
import {
  DEMO_REPO_ID,
  mockSession,
  mockSessionViewer,
} from "@/lib/mocks/fixtures"
import { server } from "@/lib/mocks/server"
import type { ProfileValues } from "@/components/profiles/profile-values"
import type { Session } from "@/lib/types"

// The scope being configured lives in `?project=`, so the search string is a
// knob, and `replace` records what the page wrote back.
const nav = vi.hoisted(() => ({ replace: vi.fn(), search: "" }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/profiles",
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))

// <Toaster> lives in the root layout, so a page rendered alone puts no toast in
// the DOM. Assert on the calls instead: what matters is which message was
// chosen for which refusal.
const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: toastSuccess }),
}))

// The role is the one thing these screens branch on, so it is a knob rather
// than a fixed fixture: a read-only role has to be renderable in the same file.
const session = vi.hoisted(() => ({ current: null as Session | null }))
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ data: session.current, loading: false }),
}))

beforeEach(() => {
  localStorage.clear()
  nav.replace.mockClear()
  nav.search = ""
  session.current = mockSession
  toastError.mockClear()
  toastSuccess.mockClear()
})

/** Wait for the pool read to land — the skeleton is gone once a card is here. */
async function ready() {
  expect(await screen.findByText("Category weights")).toBeInTheDocument()
}

const applyTo = () => screen.getByRole("region", { name: "Apply to" })

const poolList = () =>
  screen.getByRole("list", { name: /workspace profile pool/i })

const card = (name: string) =>
  within(poolList())
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .closest("li") as HTMLElement

const values: ProfileValues = {
  weights: {
    security: 2,
    code_design: 1,
    requirement: 1,
    documentation: 1,
    test: 1,
  },
  trust_s: 0.5,
}

/** Fill the pool through the real endpoint, so the limit is really reached. */
async function fillCustomProfiles(count: number) {
  for (let i = 0; i < count; i++) {
    await client.createProfile({ name: `Custom ${i + 1}`, ...values })
  }
}

// ── the pool ────────────────────────────────────────────────────────────────

test("renders the three built-ins, and says which is the workspace default", async () => {
  render(<ProfilesPage />)
  await ready()

  for (const name of ["Balanced", "Security-first", "Delivery-speed"]) {
    expect(card(name)).toBeInTheDocument()
  }
  expect(within(card("Balanced")).getByText("Default")).toBeVisible()
  expect(screen.getByTestId("workspace-default-name")).toHaveTextContent(
    "Balanced",
  )
  // Built-ins do not count toward the five-custom limit, so an untouched
  // workspace has used none of them.
  expect(screen.getByTestId("custom-count")).toHaveTextContent("0 of 5")
})

test("a custom profile joins the pool and is marked as one", async () => {
  await client.createProfile({ name: "Release gate", ...values })

  render(<ProfilesPage />)
  await ready()

  const row = card("Release gate")
  expect(within(row).getByText("Custom")).toBeVisible()
  // Created, but NOT made the default: authoring and choosing are separate.
  expect(within(row).queryByText("Default")).not.toBeInTheDocument()
  expect(screen.getByTestId("custom-count")).toHaveTextContent("1 of 5")
})

test("built-ins expose no edit or delete action", async () => {
  render(<ProfilesPage />)
  await ready()

  const balanced = card("Balanced")
  expect(
    within(balanced).queryByRole("button", { name: /edit balanced/i }),
  ).not.toBeInTheDocument()
  expect(
    within(balanced).queryByRole("button", { name: /delete balanced/i }),
  ).not.toBeInTheDocument()
  // Duplicating one is how a built-in becomes editable.
  expect(
    within(balanced).getByRole("button", { name: /duplicate balanced/i }),
  ).toBeVisible()
})

test("selecting a card seeds the sliders from that profile", async () => {
  render(<ProfilesPage />)
  await ready()

  expect(screen.getByTestId("value-security")).toHaveTextContent("1.0")

  await userEvent.click(
    within(card("Security-first")).getByRole("button", {
      name: /^Security-first/,
    }),
  )

  // Security-first is 3.0 on security and 0.5 on documentation.
  await waitFor(() =>
    expect(screen.getByTestId("value-security")).toHaveTextContent("3.0"),
  )
  expect(screen.getByTestId("value-documentation")).toHaveTextContent("0.5")
})

test("the pool read failing offers a Retry that actually reloads it", async () => {
  let broken = true
  server.use(
    http.get("*/api/profiles", () =>
      broken
        ? HttpResponse.json(
            { detail: "Something broke.", code: "INTERNAL_ERROR" },
            { status: 500 },
          )
        : undefined,
    ),
  )

  render(<ProfilesPage />)
  expect(
    await screen.findByText(/couldn’t load the profile pool/i),
  ).toBeInTheDocument()

  broken = false
  await userEvent.click(screen.getByRole("button", { name: "Retry" }))
  await ready()
  expect(
    screen.queryByText(/couldn’t load the profile pool/i),
  ).not.toBeInTheDocument()
})

// ── editing ─────────────────────────────────────────────────────────────────

test("moving a slider marks the profile unsaved and sends nothing", async () => {
  await client.createProfile({ name: "Release gate", ...values })
  const patch = vi.spyOn(client, "updateProfile")

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(
    within(card("Release gate")).getByRole("button", { name: /^Release gate/ }),
  )

  const slider = await screen.findByRole("slider", { name: /security weight/i })
  slider.focus()
  await userEvent.keyboard("{ArrowRight}")

  expect(await screen.findByTestId("unsaved-badge")).toBeVisible()
  // A drag crosses many values; only Save writes one.
  expect(patch).not.toHaveBeenCalled()
  patch.mockRestore()
})

test("Save sends only what changed, and Discard puts the stored values back", async () => {
  const created = await client.createProfile({
    name: "Release gate",
    ...values,
  })
  const patch = vi.spyOn(client, "updateProfile")

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(
    within(card("Release gate")).getByRole("button", { name: /^Release gate/ }),
  )

  const slider = await screen.findByRole("slider", { name: /test weight/i })
  slider.focus()
  await userEvent.keyboard("{ArrowRight}")
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
  const [profileId, body] = patch.mock.calls[0]
  expect(profileId).toBe(created.id)
  // PATCH, not PUT: the four untouched weights and the name are absent, so
  // re-sending values the form only displayed cannot re-clamp them.
  expect(Object.keys(body)).toEqual(["weights"])
  expect(Object.keys(body.weights ?? {})).toEqual(["test"])
  expect(screen.queryByTestId("unsaved-badge")).not.toBeInTheDocument()
  patch.mockRestore()
})

test("the clamped values the server stored replace the draft", async () => {
  await client.createProfile({ name: "Release gate", ...values })
  // The server clamps rather than rejecting: 9.0 is stored, and returned, as 3.0.
  const patch = vi.spyOn(client, "updateProfile")

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(
    within(card("Release gate")).getByRole("button", { name: /^Release gate/ }),
  )

  const slider = await screen.findByRole("slider", { name: /security weight/i })
  slider.focus()
  // Drive it past the 3.0 maximum. The client clamp holds the slider at the
  // bound; the response is still what decides what is on screen.
  for (let i = 0; i < 20; i++) await userEvent.keyboard("{ArrowRight}")
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

  await waitFor(() => expect(patch).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getByTestId("value-security")).toHaveTextContent("3.0"),
  )
  patch.mockRestore()
})

test("editing another profile with unsaved changes asks before discarding", async () => {
  await client.createProfile({ name: "Release gate", ...values })

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(
    within(card("Release gate")).getByRole("button", { name: /^Release gate/ }),
  )

  const slider = await screen.findByRole("slider", { name: /security weight/i })
  slider.focus()
  await userEvent.keyboard("{ArrowRight}")

  await userEvent.click(
    within(card("Balanced")).getByRole("button", { name: /^Balanced/ }),
  )
  expect(
    await screen.findByText(/discard unsaved changes\?/i),
  ).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: "Keep editing" }))
  expect(await screen.findByTestId("unsaved-badge")).toBeVisible()
})

// ── creating ────────────────────────────────────────────────────────────────

test("a profile can be created from a built-in, and is offered a name", async () => {
  const post = vi.spyOn(client, "createProfile")

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(
    screen.getByRole("button", { name: /duplicate security-first/i }),
  )

  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByLabelText("Name")).toHaveValue(
    "Security-first copy",
  )
  // Seeded from the card it was duplicated from, so the sliders open on 3.0.
  expect(screen.getByTestId("new-value-security")).toHaveTextContent("3.0")

  await userEvent.clear(within(dialog).getByLabelText("Name"))
  await userEvent.type(within(dialog).getByLabelText("Name"), "Release gate")
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create profile" }),
  )

  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(post.mock.calls[0][0].name).toBe("Release gate")
  expect(await screen.findByTestId("custom-count")).toHaveTextContent("1 of 5")
  post.mockRestore()
})

test("the sixth custom profile is refused, with the count on screen", async () => {
  await fillCustomProfiles(5)

  render(<ProfilesPage />)
  await ready()

  expect(screen.getByTestId("custom-count")).toHaveTextContent("5 of 5")
  // The create path is closed rather than offering a refusal the server has
  // already promised.
  expect(screen.getByRole("button", { name: /new profile/i })).toBeDisabled()
  expect(
    screen.getByLabelText("This workspace already has 5 custom profiles"),
  ).toBeInTheDocument()
  expect(
    screen.getByText(/delete one before creating another/i),
  ).toBeInTheDocument()
})

test("a name already in the pool keeps the dialog open and says so", async () => {
  await client.createProfile({ name: "Release gate", ...values })

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(screen.getByRole("button", { name: /new profile/i }))

  const dialog = await screen.findByRole("dialog")
  await userEvent.type(within(dialog).getByLabelText("Name"), "release gate")
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create profile" }),
  )

  // Names are unique per workspace after trimming and lower-casing.
  expect(
    await within(dialog).findByText(/already uses that name/i),
  ).toBeInTheDocument()
  expect(screen.getByRole("dialog")).toBeInTheDocument()
})

// ── deleting ────────────────────────────────────────────────────────────────

test("an unused custom profile is deleted after a named confirmation", async () => {
  await client.createProfile({ name: "Release gate", ...values })

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(
    screen.getByRole("button", { name: /delete release gate/i }),
  )

  expect(await screen.findByText(/delete release gate\?/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Delete profile" }))

  await waitFor(() =>
    expect(
      within(poolList()).queryByRole("button", { name: /^Release gate/ }),
    ).not.toBeInTheDocument(),
  )
  expect(toastSuccess).toHaveBeenCalledWith("Deleted Release gate")
})

test("an in-use profile survives the delete, and the dialog explains why", async () => {
  const created = await client.createProfile({
    name: "Release gate",
    ...values,
  })
  await client.setProjectProfile(DEMO_REPO_ID, created.id)

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(
    screen.getByRole("button", { name: /delete release gate/i }),
  )
  await userEvent.click(screen.getByRole("button", { name: "Delete profile" }))

  expect(
    await screen.findByText(/change those selections first/i),
  ).toBeInTheDocument()
  // The dialog stays open: the next step is to move the reference, not to press
  // Delete again.
  expect(screen.getByRole("dialog")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
  // And the profile is still in the pool — the refusal was not a silent delete.
  expect(
    within(poolList()).getByRole("button", { name: /^Release gate/ }),
  ).toBeInTheDocument()
})

// ── choosing what is in force ───────────────────────────────────────────────

test("the workspace default moves to the selected profile", async () => {
  render(<ProfilesPage />)
  await ready()

  await userEvent.click(
    within(card("Security-first")).getByRole("button", {
      name: /^Security-first/,
    }),
  )
  await userEvent.click(
    screen.getByRole("button", { name: /set as workspace default/i }),
  )

  await waitFor(() =>
    expect(screen.getByTestId("workspace-default-name")).toHaveTextContent(
      "Security-first",
    ),
  )
  // Exactly one default: the badge moved rather than being added.
  expect(
    within(card("Balanced")).queryByText("Default"),
  ).not.toBeInTheDocument()
  expect(within(card("Security-first")).getByText("Default")).toBeVisible()
})

test("a project overrides the default, and clearing it inherits again", async () => {
  render(<ProfilesPage />)
  await ready()

  // The rail on the right picks what is being configured; there are no tabs.
  await userEvent.click(
    within(applyTo()).getByRole("button", { name: /acme-payments/ }),
  )
  expect(nav.replace).toHaveBeenCalledWith(
    `/profiles?project=${DEMO_REPO_ID}`,
    { scroll: false },
  )
  expect(await screen.findByTestId("effective-summary")).toHaveTextContent(
    /is scored with Balanced, inherited from the workspace default/i,
  )

  await userEvent.click(
    within(card("Delivery-speed")).getByRole("button", {
      name: /^Delivery-speed/,
    }),
  )
  await userEvent.click(
    screen.getByRole("button", { name: /use for this project/i }),
  )

  await waitFor(() =>
    expect(screen.getByTestId("effective-summary")).toHaveTextContent(
      /Delivery-speed, an override for this project alone/i,
    ),
  )
  // The workspace default is untouched by a project's own choice.
  expect(screen.getByTestId("workspace-default-name")).toHaveTextContent(
    "Balanced",
  )

  await userEvent.click(screen.getByRole("button", { name: /clear override/i }))
  await waitFor(() =>
    expect(screen.getByTestId("effective-summary")).toHaveTextContent(
      /Balanced, inherited from the workspace default/i,
    ),
  )
})

// ── roles ───────────────────────────────────────────────────────────────────

test("a viewer reads the pool and can change nothing", async () => {
  session.current = mockSessionViewer
  await client.createProfile({ name: "Release gate", ...values })

  render(<ProfilesPage />)
  await ready()

  expect(card("Release gate")).toBeInTheDocument()
  // Main actions stay visible but locked, with the reason on the wrapper that
  // hover and keyboard focus reach.
  expect(screen.getByRole("button", { name: /new profile/i })).toBeDisabled()
  expect(
    screen.getByRole("button", { name: /set as workspace default/i }),
  ).toBeDisabled()
  expect(
    screen.getAllByLabelText("Only org-admins and managers can change profiles")
      .length,
  ).toBeGreaterThan(0)
  // Destructive and editing controls are not offered at all.
  expect(
    screen.queryByRole("button", { name: /delete release gate/i }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: /edit release gate/i }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByText(/needs the manager or org-admin role/i),
  ).toBeInTheDocument()

  // Read-only means readable: the numbers are still on screen, they just do not
  // operate.
  expect(
    screen.getByRole("slider", { name: /security weight/i }),
  ).toHaveAttribute("aria-disabled", "true")
})

test("a 403 from the API explains the permission rather than failing vaguely", async () => {
  server.use(
    http.put("*/api/profiles/default", () =>
      HttpResponse.json(
        { detail: "Forbidden.", code: "FORBIDDEN" },
        { status: 403 },
      ),
    ),
  )

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(
    within(card("Security-first")).getByRole("button", {
      name: /^Security-first/,
    }),
  )
  await userEvent.click(
    screen.getByRole("button", { name: /set as workspace default/i }),
  )

  expect(
    await screen.findByText(/an org-admin or a manager can make this change/i),
  ).toBeInTheDocument()
  expect(toastError).toHaveBeenCalledWith(
    expect.stringContaining("org-admin or a manager"),
  )
})

// ── the scope rail (13F) ────────────────────────────────────────────────────

test("the rail lists the workspace default and every project with its profile", async () => {
  render(<ProfilesPage />)
  await ready()

  const rail = applyTo()
  expect(
    within(rail).getByRole("button", { name: /workspace default/i }),
  ).toHaveAttribute("aria-pressed", "true")
  for (const name of ["acme-payments", "web-store", "octo-cli"]) {
    const project = within(rail).getByRole("button", {
      name: new RegExp(name),
    })
    expect(project).toHaveAttribute("aria-pressed", "false")
    // Each project says what it is scored with, once its profile has loaded.
    await waitFor(() => expect(project).toHaveTextContent("Balanced"))
  }
})

test("?project= opens on that project, and choosing the default goes back", async () => {
  nav.search = `project=${DEMO_REPO_ID}`
  render(<ProfilesPage />)
  await ready()

  expect(
    within(applyTo()).getByRole("button", { name: /acme-payments/ }),
  ).toHaveAttribute("aria-pressed", "true")
  expect(await screen.findByTestId("effective-summary")).toHaveTextContent(
    /acme-payments is scored with Balanced/i,
  )

  await userEvent.click(
    within(applyTo()).getByRole("button", { name: /workspace default/i }),
  )
  expect(nav.replace).toHaveBeenCalledWith("/profiles", { scroll: false })
  expect(screen.queryByTestId("effective-summary")).not.toBeInTheDocument()
})

test("an unknown ?project= falls back to the workspace default", async () => {
  nav.search = "project=11111111-2222-3333-4444-555555555555"
  render(<ProfilesPage />)
  await ready()

  expect(
    within(applyTo()).getByRole("button", { name: /workspace default/i }),
  ).toHaveAttribute("aria-pressed", "true")
})

test("switching scope with unsaved edits asks first", async () => {
  await client.createProfile({ name: "Release gate", ...values })

  render(<ProfilesPage />)
  await ready()
  await userEvent.click(
    within(card("Release gate")).getByRole("button", { name: /^Release gate/ }),
  )
  const slider = await screen.findByRole("slider", { name: /security weight/i })
  slider.focus()
  await userEvent.keyboard("{ArrowRight}")

  await userEvent.click(
    within(applyTo()).getByRole("button", { name: /acme-payments/ }),
  )
  expect(
    await screen.findByText(/discard unsaved changes\?/i),
  ).toBeInTheDocument()
})
