# CodeSage AI Implementation Plan

Created: 2026-09-19

Owner lane: Janidu + Codex

Next fixed submission: Test plan report due Sunday, 2026-09-27

This file is the shared implementation tracker for the premium web push, delete
project work, and RBAC seam. It is intentionally practical: phases, files,
acceptance criteria, tests, and documentation updates. Do not commit from this
file unless Janidu explicitly asks.

## 1. Product Direction

The target is a slightly more branded, darker, premium SaaS product while keeping
light mode intact. CodeSage AI should feel like a real product dashboard, not a
course prototype, but the app must stay focused on the release requirements.

### UI principles

- Keep `shadcn/ui` as the component base. The underlying Radix/ARIA primitives
  are fine and should stay where they help accessibility.
- Use `lucide-react` icons for visible actions, navigation, empty states, and
  profile cards.
- Prefer compact, high-signal SaaS layouts over marketing-heavy pages inside
  the signed-in app.
- Dark mode should feel premium by default; light mode must remain polished and
  readable.
- Use stronger hierarchy, better spacing, richer empty/loading/error states, and
  clearer action surfaces.
- Avoid scope creep: no invitations, no role assignment UI, no private repos, no
  finding action workflow, no multi-language expansion.

### Feature order

1. Web premium UI and user experience first.
2. Delete project after the project UI is ready.
3. RBAC seam after delete project, as backend authorization only.
4. Documentation and test evidence continuously, not at the end.

## 2. Current Reality Check

Some items from the planning docs are already implemented in code and should not
be redone:

- `SCORE_PENDING` is handled in `useHealthReport`.
- Retry has a visible `refetch` path.
- `ThemeProvider` is mounted.
- Finding rows are keyboard-operable.
- Several named empty states exist.
- The category pie has real colors and a legend.

The remaining web gaps are:

- No branded public starting page. `/` is currently protected by middleware and
  redirects to `/login`.
- Login page is too plain for a premium product.
- Selected project is not preserved across Projects, Profiles, Dashboard, and
  History.
- Sidebar supports icon collapse internally, but the user has no obvious desktop
  collapse control.
- Dashboard scrolling is not bounded enough; the whole page can participate in
  scrolling instead of only the issue/tree regions.
- Historical scan rows are not clickable and do not load `snapshot_id`.
- Projects and Profiles pages need a premium pass.
- Delete project is not wired in the API or web client.
- RBAC is not implemented yet; OpenAPI already names `FORBIDDEN`.

## 3. Test Gate Summary

These are the gates we should run before merging each relevant phase.

### Web standard gate

Run from `apps/web`:

```powershell
pnpm typecheck
pnpm lint --max-warnings 0
pnpm format:check
pnpm test:run
pnpm build
```

For larger web phases, also run targeted Playwright:

```powershell
pnpm exec playwright test e2e/dashboard.spec.ts e2e/projects.spec.ts e2e/history.spec.ts e2e/profiles.spec.ts
```

Before final submission evidence, run:

```powershell
pnpm test:e2e
pnpm verify
```

Note: `pnpm verify` covers typecheck, lint, format check, Vitest, and build. It
does not replace Playwright E2E.

### OpenAPI gate

Run from `apps/web` after editing `docs/api/openapi.yaml`:

```powershell
pnpm gen:types
pnpm gen:types:check
pnpm typecheck
```

Generated file:

- `apps/web/src/lib/types/api.ts`

Never hand-edit generated API types.

### API gate

Run from `apps/api` for backend phases:

```powershell
pytest tests/unit
```

When database behavior, cascade, migrations, or RLS are involved:

```powershell
pytest tests/integration
```

If Docker is unavailable, record that integration tests could not be run and why.

### Manual web gate

Use these checks for every premium UI phase:

- Dark mode and light mode.
- `1280x720` viewport, no horizontal page scroll.
- Keyboard-only navigation through nav, project actions, dashboard list, tree,
  history rows, profile controls, and dialogs.
- Screen reader labels exist for icon-only buttons.
- No text clipping in buttons, cards, sidebar, tables, or dialogs.
- Loading, empty, error, and success states all have a way forward.

## 4. Phase 1 / PR 1: Premium Shell And Brand Foundation

Goal: make CodeSage AI feel like a premium product before changing feature
behavior.

### Scope

- Add a public branded starting page at `/`.
- Keep `/login`, but redesign it to match the product brand.
- Update middleware so `/` and `/login` are public, while app routes stay
  protected.
- Upgrade global theme tokens for a richer dark branded shell and cleaner light
  mode.
- Add visible desktop sidebar collapse control.
- Improve the rail brand block and account/footer area.

### Likely files

- `apps/web/src/app/page.tsx`
- `apps/web/src/app/(auth)/login/page.tsx`
- `apps/web/src/middleware.ts`
- `apps/web/src/middleware.test.ts`
- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/components/layout/app-rail.tsx`
- `apps/web/src/app/globals.css`

### Implementation details

- Public home page should show:
  - CodeSage AI name.
  - One clear product idea: code health, refactor priority, repository heat map.
  - Sign-in CTA that leads to `/login` or directly to the API login.
  - Premium visual preview of the dashboard, using CSS/components rather than
    requiring live data.
- Login page should:
  - Keep the Asgardeo navigation as a normal link.
  - Explain that sign-in is handled by the identity provider.
  - Avoid adding fake auth choices.
- Middleware should:
  - Allow `/`.
  - Allow `/login`.
  - Continue protecting `/projects`, `/profiles`, `/dashboard/...`.
- Sidebar should:
  - Show a brand mark/name.
  - Have a visible collapse/expand control on desktop.
  - Keep mobile sheet behavior intact.

### Acceptance criteria

- Visiting `/` without a session shows the branded product page.
- Visiting `/login` without a session shows the branded login page.
- Visiting `/projects` without a session still redirects to `/login`.
- Sidebar can be collapsed and expanded visibly on desktop.
- Light and dark modes both pass a quick visual check.

### Tests to add or update

Vitest:

- Middleware:
  - root path is public.
  - login path is public.
  - app paths still redirect without the session cookie.
  - app paths pass through with the session cookie.

Playwright:

- Public landing page renders product name and sign-in CTA.
- Login page exposes a sign-in link whose URL points to `/api/auth/login`.
- Sidebar collapse control works on an authenticated app route.

Manual:

- Dark/light screenshot check.
- Mobile rail trigger still works.

## 5. Phase 2 / PR 2: Preserve Selected Project Across Pages

Goal: the app remembers which repository the user is working on.

### Scope

- Add selected-project state with URL-first behavior and local fallback.
- Project selection should survive navigation to Profiles and back.
- Rail Dashboard and Scan History links should use the active/last selected repo.
- Projects page should visibly mark the active repo.

### Likely files

- `apps/web/src/components/layout/app-rail.tsx`
- `apps/web/src/components/projects/project-list.tsx`
- `apps/web/src/app/(app)/projects/page.tsx`
- New helper or hook, likely `apps/web/src/hooks/use-selected-project.ts`

### Implementation details

- URL remains the source of truth on:
  - `/dashboard/{repoId}`
  - `/dashboard/{repoId}/history`
- `localStorage` stores the last selected repo id as a fallback.
- When user selects a project, write selected repo before navigating.
- When user enters a dashboard route, update selected repo from the URL.
- If selected repo no longer exists, fall back to first available repo or demo
  only in mock/demo mode.

### Acceptance criteria

- Select a project on Projects, open Dashboard, go to Profiles, click Dashboard
  in the rail, and the same repo opens.
- Refresh on Profiles does not lose the selected repo.
- Projects page highlights the active repo.
- Rail does not unexpectedly jump back to demo while a real repo is selected.

### Tests to add or update

Vitest:

- Selected-project helper:
  - saves an id.
  - restores an id.
  - handles unavailable storage.
  - ignores invalid stored values if necessary.
- App rail:
  - Dashboard and Scan History hrefs use selected repo outside dashboard routes.
  - URL repo id wins on dashboard routes.
- ProjectList:
  - active repo is marked accessibly and visually.

Playwright:

- Select second project, go to Profiles, click Dashboard, confirm second project
  dashboard loads.
- Refresh on Profiles, then click Scan History, confirm same repo history loads.

Manual:

- Try collapsed rail, expanded rail, mobile rail.

## 6. Phase 3 / PR 3: Premium Dashboard Layout And Scroll Fix

Goal: the core dashboard feels like a bounded, high-end application surface.

### Scope

- Fix app shell and dashboard height so scrolling is contained.
- Keep dashboard top nav visible in the app flow.
- Make only the issue list/tree regions scroll internally.
- Improve dashboard top nav, health cards, ranked list, tree, and chart.
- Add better feedback when tree selection has no finding.

### Likely files

- `apps/web/src/components/dashboard/dashboard-view.tsx`
- `apps/web/src/components/dashboard/refactor-first-list.tsx`
- `apps/web/src/components/dashboard/file-tree/file-tree.tsx`
- `apps/web/src/components/dashboard/health-graph-card.tsx`
- `apps/web/src/components/dashboard/overall-health-card.tsx`
- `apps/web/src/components/layout/dashboard-topnav.tsx`
- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/app/globals.css`

### Implementation details

- Layout:
  - Ensure root/app shell has a real viewport-bounded height.
  - Dashboard main area uses `min-h-0` at every flex boundary.
  - Refactor-First list and file tree get their own scroll containers.
  - Page body should not horizontally scroll at `1280x720`.
- Top nav:
  - Add icons for branch, scan, commit, latest scanned time.
  - Keep scan controls visible and clear.
  - Reserve room for historical snapshot label in Phase 4.
- Refactor-First list:
  - State that it is ranked by priority.
  - Improve badges/chips for severity, type, source.
  - Avoid fragile truncation at small desktop sizes.
  - Preserve keyboard row behavior.
- File tree:
  - Add heat-map legend.
  - Show per-file score or grade visibly.
  - If a file has no finding, show a small helpful message/toast.
- Trend chart:
  - Add clearer axis/tick labels.
  - Avoid grey, lifeless defaults.

### Acceptance criteria

- At `1280x720`, no horizontal page scroll.
- Dashboard top nav remains accessible.
- Refactor-First list scrolls without moving the whole page.
- File tree scrolls inside its own panel.
- All icon-only buttons have accessible names.
- Tree click on a file with no finding does not fail silently.

### Tests to add or update

Vitest:

- DashboardView:
  - renders the ranked-list label.
  - renders tree legend.
  - handles no-finding tree selection feedback.
- RefactorFirstList:
  - still keyboard-selects rows.
  - selected row still exposes current/selected state.
- FileTree:
  - renders score/grade display.
  - calls no-finding feedback path when applicable.

Playwright:

- Dashboard at `1280x720` has no horizontal page scroll:
  - check `document.documentElement.scrollWidth <= window.innerWidth`.
- Refactor-First list can scroll while top nav remains visible.
- File tree can scroll independently.
- Tree click for file with finding opens detail.
- Tree click for file without finding shows helpful feedback.

Manual:

- Dark/light dashboard review.
- Keyboard-only dashboard walkthrough.
- Reduced motion check if any new transitions are added.

## 7. Phase 4 / PR 4: Historical Snapshot UX (#98)

Goal: complete FR-19 by loading immutable historical snapshots from history.

### Scope

- Extend web API client to pass optional `snapshot_id`.
- Extend hook keying so snapshot and latest reads do not collide.
- Make history rows clickable.
- Dashboard reads `branch` and `snapshot_id` from URL.
- Clearly label historical snapshots.
- Add Return to latest action.

### Likely files

- `apps/web/src/lib/api/client.ts`
- `apps/web/src/hooks/use-health-report.ts`
- `apps/web/src/components/history/scan-history.tsx`
- `apps/web/src/components/dashboard/dashboard-view.tsx`
- `apps/web/src/components/layout/dashboard-topnav.tsx`
- `apps/web/src/components/history/scan-history.test.tsx`
- `apps/web/src/components/dashboard/dashboard-view.test.tsx`
- `apps/web/e2e/history.spec.ts`
- `apps/web/e2e/dashboard.spec.ts`

### Implementation details

- URL shape:
  - `/dashboard/{repoId}?branch=main&snapshot_id={uuid}`
- Dashboard behavior:
  - `branch` query param should seed selected branch.
  - `snapshot_id` means read-only historical mode.
  - Historical mode should clearly show scan date, commit, and branch.
  - Scan button should not imply it changes the old snapshot.
  - Return to latest removes `snapshot_id` and loads latest for the branch.
- History behavior:
  - Row click navigates to dashboard with both branch and snapshot id.
  - Row remains a table row but has keyboard support if clickable.

### Acceptance criteria

- Clicking a history row loads the exact `snapshot_id`, not just latest scan on
  that branch.
- Refreshing preserves historical view.
- Return to latest removes `snapshot_id`.
- Missing/deleted snapshot produces a useful error state.
- Branch selection remains correct after loading a historical row.

### Tests to add or update

Vitest:

- `getHealthReport` includes `snapshot_id` only when provided.
- `useHealthReport` query key includes `snapshot_id`.
- ScanHistory row link includes `branch` and `snapshot_id`.
- Dashboard labels historical mode.
- Return to latest removes the snapshot query.

Playwright:

- Click a history row, verify dashboard URL includes `snapshot_id`.
- Reload, verify historical label remains.
- Click Return to latest, verify `snapshot_id` is gone and latest dashboard is
  shown.

Manual:

- Open historical snapshot in dark/light.
- Try branch switching while historical mode is active.

## 8. Phase 5 / PR 5: Premium Projects Experience

Goal: projects feel like a production workspace, not a list of placeholders.

### Scope

- Upgrade project cards.
- Add project action area.
- Improve connect form.
- Add delete confirmation design, but do not wire API until Phase 7.
- Improve loading, empty, and error states.

### Likely files

- `apps/web/src/app/(app)/projects/page.tsx`
- `apps/web/src/components/projects/project-list.tsx`
- `apps/web/src/components/projects/connect-repo.tsx`
- `apps/web/src/components/projects/project-list.test.tsx`
- `apps/web/e2e/projects.spec.ts`

### Implementation details

- Project cards should show:
  - repo icon.
  - owner/name hierarchy.
  - visibility chip.
  - health grade and score if available.
  - "Not scanned yet" as a real state, not zero.
  - connected date.
  - actions: Select/Open Dashboard, History, future Remove.
- Connect form:
  - keep pasted public GitHub URL.
  - use icon and better busy state.
  - keep existing specific error messages by code.
- Delete confirmation:
  - named confirmation dialog is enough for v1.
  - no typing repo name.
  - final API wiring waits for Phase 7.

### Acceptance criteria

- Projects page feels consistent with the dashboard.
- Active project is visible.
- Freshly connected project shows no health score until scanned.
- Destructive action cannot fire without confirmation once wired.

### Tests to add or update

Vitest:

- ProjectList renders:
  - health hint.
  - unscanned state.
  - active selected state.
  - action buttons/links.
- ConnectRepo:
  - disabled while busy.
  - preserves accessible labels.

Playwright:

- Existing connect success and failure tests still pass.
- Selecting project opens dashboard and stores selection.
- Project card actions open Dashboard and History for the same repo.

Manual:

- Check long owner/repo names.
- Check `1280x720`, collapsed sidebar, and mobile.

## 9. Phase 6 / PR 6: Premium Profiles Experience

Goal: make the scoring/profile page feel high-end and understandable.

### Scope

- Redesign preset selection as premium cards.
- Keep sliders accessible and precise.
- Make unsaved changes obvious.
- Improve apply success/error feedback.

### Likely files

- `apps/web/src/app/(app)/profiles/page.tsx`
- `apps/web/src/app/(app)/profiles/page.test.tsx`
- `apps/web/e2e/profiles.spec.ts`

### Implementation details

- Preset cards:
  - Balanced, Security-first, Delivery-speed.
  - Icons and short descriptions.
  - Active/custom state visible.
- Sliders:
  - category icon or color marker.
  - numeric badge.
  - short hint text.
  - no save until Apply.
- Apply area:
  - sticky or clearly placed action footer if layout gets long.
  - disabled/saving states clear.
  - after successful apply, update draft from server response.

### Acceptance criteria

- User can tell preset vs custom.
- User can tell when there are unsaved changes.
- Sliders remain keyboard operable.
- Applying profile preserves current API behavior.

### Tests to add or update

Vitest:

- Preset card seeds sliders.
- Moving a slider marks profile as Custom or unsaved.
- Apply sends current numbers.
- Error path shows toast or useful message.

Playwright:

- Select Security-first, apply, verify success.
- Change one slider, verify Custom/unsaved state.
- Keyboard slider operation smoke test if feasible.

Manual:

- Dark/light readability of slider labels and badges.

## 10. Phase 7 / PR 7: Delete Project API And UI (#121)

Goal: implement repository removal after the web project surface is ready.

### Scope

- OpenAPI first.
- Backend route and service.
- Frontend client.
- Projects page confirmation dialog.
- Selected-project cleanup.
- Tests across API and web.

### Likely files

API:

- `docs/api/openapi.yaml`
- `apps/api/src/codesage_api/routers/projects.py`
- `apps/api/src/codesage_api/services/repositories.py`
- `apps/api/src/codesage_api/errors.py`
- API tests under `apps/api/tests/unit/routers`, `apps/api/tests/unit/services`,
  and possibly integration tests for cascade.

Web:

- `apps/web/src/lib/api/client.ts`
- `apps/web/src/lib/types/api.ts` generated after OpenAPI change.
- `apps/web/src/components/projects/project-list.tsx`
- `apps/web/src/app/(app)/projects/page.tsx`
- MSW handlers in `apps/web/src/lib/mocks/handlers.ts`
- Web tests for projects.

### Implementation details

- Add `DELETE /api/projects/{repo_id}` to contract.
- Return success with no content or a small response. Choose one and document it
  in OpenAPI.
- Refuse delete while scan is running.
- Cascade repository children cleanly:
  - branches.
  - attempts.
  - snapshots.
  - scores.
  - source files.
  - findings.
  - tree nodes.
- Gate on RBAC later, but design route so it can accept `require_role` in Phase
  8 without reshaping.
- Web behavior:
  - open named confirmation dialog.
  - delete after confirm.
  - show success toast.
  - remove from list.
  - if deleted repo was selected, clear selected project and choose safe fallback.

### Acceptance criteria

- Removing leaves no orphaned rows.
- Running scan refusal has a clear error code/message.
- UI updates without full page reload.
- `pnpm gen:types:check` passes after OpenAPI change.

### Tests to add or update

API unit:

- Router calls repository delete service with workspace context.
- Service raises not found for foreign/missing repo.
- Service refuses running scan.
- Service deletes expected repository.

API integration if feasible:

- Cascade leaves no child rows behind.

Web Vitest:

- `deleteProject` sends DELETE request.
- ProjectList opens confirmation dialog with repo name.
- Confirm calls delete.
- Cancel does not call delete.
- Selected project is cleared when deleted.

Playwright:

- Delete a non-active project from Projects.
- Delete active project and verify rail/dashboard fallback.
- Running scan refusal displays useful message if mock can simulate it.

## 11. Phase 8 / PR 8: RBAC Seam (#120)

Goal: add backend authorization without building team-management UI.

### Scope

- Add workspace-bound role to membership.
- First sign-in provisions `org_admin`.
- Add `require_role(...)`.
- Gate writes only.
- Reads remain available to viewer.
- Add tests.
- UI handles 403 gracefully.

### Non-goals

- No invitations.
- No member management page.
- No role assignment UI.
- No Asgardeo role/scope migration.

### Likely files

- `apps/api/src/codesage_api/db/enums.py`
- `apps/api/src/codesage_api/db/models/tenancy.py`
- New Alembic migration.
- `apps/api/src/codesage_api/deps.py`
- `apps/api/src/codesage_api/errors.py`
- Routers for projects, scans, profiles.
- API tests for role gates.
- Web error handling only if needed.

### Implementation details

- Role names use the final SRS/issue names:
  - `org_admin`
  - `manager`
  - `developer`
  - `viewer`
- Permission shape:
  - reads: all active roles.
  - connect project: org_admin, manager, developer.
  - delete project: org_admin, manager.
  - start scan: org_admin, manager, developer.
  - stop scan: org_admin, manager, developer.
  - apply profile: org_admin, manager, developer.
- Add `Forbidden` error class with:
  - status 403.
  - code `FORBIDDEN`.
  - human detail.
- A new write endpoint should be protected by a default pattern or explicit test
  so nobody forgets authorization.

### Acceptance criteria

- Viewer gets 403 on every write.
- Viewer gets 200 on every read.
- Developer cannot delete project if delete is admin/manager only.
- Org admin can perform all writes.
- 401 and 403 remain distinct.

### Tests to add or update

API unit:

- Role dependency allows expected roles.
- Role dependency rejects insufficient roles with 403.
- Connect project role matrix.
- Delete project role matrix.
- Start scan role matrix.
- Stop scan role matrix.
- Apply profile role matrix.

API integration if feasible:

- Membership role persists through migration.
- First provisioned user receives `org_admin`.

Web:

- 403 write response displays friendly error/toast.
- No role assignment UI is added.

## 12. Phase 9 / PR 9: Documentation And Test Evidence

Goal: keep the course deliverables honest and ready for the 2026-09-27 test plan.

### Docs to update

- `docs/Project Management & Planning/frontend_build_stepbystep.md`
- `docs/Project Management & Planning/team-plan-to-final.md`
- `docs/Project Management & Planning/plan-to-final-submission.md` if the master
  plan needs current status.
- `docs/api/openapi.yaml` when API contract changes.
- Test plan report evidence tables before Sunday, 2026-09-27.

### What to record

- Premium shell and public landing page.
- Selected-project persistence.
- Dashboard scroll fix and responsive proof.
- Historical snapshot URL behavior.
- Project delete design and implementation.
- Profiles premium pass.
- RBAC seam and explicit non-goal of role assignment UI.
- Test commands run and results.
- Known gaps, if any, with honest reason.

### Test evidence checklist for web section

Record for the test plan:

- Vitest pass count.
- Playwright pass count.
- Typecheck result.
- Lint result.
- Build result.
- Accessibility/keyboard manual notes.
- `1280x720` viewport result.
- Dark/light visual result.
- Screenshots if useful:
  - public landing page.
  - branded login page.
  - dashboard at 1280x720.
  - historical snapshot banner.
  - projects page.
  - profiles page.
  - delete confirmation dialog.

## 13. Suggested PR Split

Use small PRs so we can review and recover quickly.

1. `web-premium-shell`
   - public landing, login, theme, sidebar collapse, middleware tests.
2. `web-selected-project`
   - selected project persistence and rail links.
3. `web-dashboard-premium`
   - dashboard layout, scroll fix, tree/list/chart polish.
4. `web-history-snapshots`
   - clickable history and `snapshot_id` dashboard.
5. `web-projects-premium`
   - project cards and delete dialog design.
6. `web-profiles-premium`
   - preset cards and slider UX.
7. `api-delete-project`
   - OpenAPI, API route, frontend wiring, tests.
8. `api-rbac-seam`
   - membership role, dependency, write gates, tests.
9. `docs-test-evidence`
   - planning docs, frontend build log, test plan evidence.

## 14. Daily Execution Order

For each phase:

1. Read the current files before editing.
2. Make the smallest coherent change.
3. Add or update tests in the same phase.
4. Run the targeted test gate.
5. Update this file's checkboxes if desired.
6. Update planning docs only after behavior is real.
7. Do not commit unless Janidu asks.

## 15. Phase Tracking

- [ ] Phase 1: Premium shell and brand foundation.
- [ ] Phase 2: Preserve selected project across pages.
- [ ] Phase 3: Premium dashboard layout and scroll fix.
- [ ] Phase 4: Historical snapshot UX.
- [ ] Phase 5: Premium projects experience.
- [ ] Phase 6: Premium profiles experience.
- [ ] Phase 7: Delete project API and UI.
- [ ] Phase 8: RBAC seam.
- [ ] Phase 9: Documentation and test evidence.

## 16. Final Release Guardrails

- If time gets tight before 2026-09-27, prioritize:
  1. dashboard usability.
  2. historical snapshot loading.
  3. selected project preservation.
  4. test evidence.
  5. project/profile polish.
  6. delete project.
  7. RBAC seam.
- Do not sacrifice tests and evidence for extra polish.
- Do not add role assignment UI in v1.0.
- Do not add private repo support.
- Do not add finding accept/resolve actions.
- Do not change ML/API contracts unless the OpenAPI and generated types move
  with the change.

