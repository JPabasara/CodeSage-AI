# CodeSage AI Implementation Plan

Created: 2026-09-19

Revised: 2026-09-23

Next fixed submission: Test plan report due Sunday, 2026-09-27

This is the active implementation tracker for completing the CodeSage AI API
and web application for SUS. It replaces the older assumption that delete and
RBAC were still future backend work. It records the current backend reality,
the approved profile and workspace architecture, the required PR order,
acceptance criteria, tests, and final release evidence.

Do not commit changes from this plan unless Janidu explicitly asks.

## 1. Product Direction

CodeSage AI is a workspace-based team product:

- A user can belong to multiple workspaces.
- A membership gives that user one role inside one workspace.
- A workspace contains multiple connected projects/repositories.
- Projects, profiles, members, scans, findings, and dashboard reads are always
  bounded to the active workspace.
- A workspace owns a reusable scoring-profile pool.
- Every workspace has one default scoring profile.
- Every project inherits the workspace default unless it has an explicit
  project profile override.
- Profile selection is shared team configuration. There are no per-user or
  private personal scoring profiles in this release.

The web target is a premium, modern SaaS dashboard with strong dark mode and a
fully polished light mode. The product must remain accessible, responsive, and
clear at normal laptop sizes instead of becoming visually heavy.

### UI principles

- Keep shadcn/ui and its Radix/ARIA primitives as the component base.
- Use lucide-react for visible actions, navigation, empty states, profile cards,
  workspace controls, and Team controls.
- Prefer compact, high-signal product surfaces over marketing-heavy layouts
  inside the signed-in application.
- Preserve keyboard operation and visible focus for every interactive control.
- Use clear loading, empty, success, conflict, forbidden, and recovery states.
- Avoid hiding backend permission failures behind generic error messages.
- Keep destructive actions behind a named confirmation dialog.
- Avoid horizontal page scrolling at 1280x720.
- Keep private repository support and finding accept/resolve workflows outside
  this release.

## 2. Locked Product And Data Decisions

These decisions are approved for the remaining implementation. Do not silently
change them inside an individual PR.

### 2.1 Workspace and project hierarchy

- A new user must create a workspace before entering the main application.
- The first workspace creator becomes its active org-admin.
- A user may later create and switch between multiple workspaces.
- Each workspace stores:
  - required name;
  - optional description;
  - optional website URL;
  - created and updated timestamps;
  - derived project and member counts where useful to the web.
- Image upload and custom workspace branding are not required for this release.
- A real newly created workspace starts with no connected repositories. Demo
  repositories remain mock/demo behavior only.
- The Projects page lists only repositories in the active workspace.
- Switching workspace invalidates workspace-bound web data and restores a
  project selection belonging only to the newly active workspace.

### 2.2 Workspace and dashboard selectors

The signed-in application needs an obvious workspace context. The dashboard
top area ultimately contains three selectors:

1. Workspace selector.
2. Project selector.
3. Branch selector.

Rules:

- Workspace selection changes the server-side active workspace session.
- Project selection must never carry a repository from another workspace.
- Selected project storage must be namespaced by workspace ID rather than using
  one global repository ID.
- Branch selection remains bounded to the selected project.
- Historical snapshot mode remains bounded to the selected workspace, project,
  and branch.
- If workspace switching leaves no selected project, navigate to Projects or
  show a purposeful no-project state instead of requesting a stale dashboard.

### 2.3 Scoring profile pool

Each workspace has the following profile pool:

- Three immutable built-in profiles:
  - Balanced;
  - Security-first;
  - Delivery-speed.
- Up to five custom profiles created inside that workspace.
- The three built-ins do not count toward the five-custom-profile limit.
- Custom profile names must be unique inside a workspace.
- Built-ins may be selected or cloned but cannot be patched or deleted.
- Custom profiles may be created, patched, and deleted by org-admin and manager
  roles only.
- Developer and viewer roles may read the profile pool and effective profile,
  but cannot mutate profile configuration.
- The initial workspace default is Balanced.
- Org-admin or manager may select any built-in or custom profile as the
  workspace default.
- Every project has either:
  - no override and therefore inherits the workspace default; or
  - one explicit profile selected from the same workspace profile pool.
- Clearing a project override returns that project to workspace-default
  inheritance.
- A project cannot reference a profile from another workspace.
- Updating a custom profile intentionally affects the workspace default and all
  projects that reference that profile.
- A custom profile that is the workspace default or is assigned to any project
  cannot be deleted. Return a stable 409 profile-in-use error until references
  are changed.
- Profile changes re-rank/re-score stored scan results without starting a scan
  or creating a snapshot.
- No per-user profile table or user-project profile preference is added.

### 2.4 Team and RBAC

The navigation label is Team, not Users.

- All active roles can open Team and read the current workspace member list.
- Only org-admin can invite members, revoke invitations, change roles, and
  deactivate members.
- Manager cannot administer members even though manager can administer projects
  and profiles.
- The last active org-admin cannot be demoted or deactivated.
- Roles stay workspace-specific:
  - org-admin;
  - manager;
  - developer;
  - viewer.
- The API remains the security boundary. Hiding or disabling a web control is
  only a user-experience improvement.

### 2.5 Help and onboarding tour

- Help is a permanent navigation tab.
- A short product tour starts after a new user creates the first workspace and
  reaches the application shell.
- The tour includes Skip and Finish controls.
- Help includes Restart tour.
- Tour completion is stored under a versioned, user-specific localStorage key
  for this release so another signed-in account on the same browser does not
  inherit the wrong completion state.
- The tour must not trap focus, block normal navigation after dismissal, or
  ignore reduced-motion preferences.

## 3. Current Repository Reality

Do not redo already delivered work.

### Completed web foundation

- Premium shell and brand foundation.
- Selected-project persistence foundation.
- Dashboard layout and scroll work.
- Historical snapshot navigation.
- Premium Projects experience.
- Theme support, mobile navigation, keyboard improvements, named empty states,
  retry behavior, SCORE_PENDING handling, and dashboard visual improvements.

### Completed backend foundation

- Authentication and server-side sessions.
- Workspace-bound row-level security.
- Workspace-specific Membership roles.
- Role and permission catalogue.
- Permission checks for existing workspace operations.
- Multiple-workspace listing, creation, rename, and active-session switching.
- Member listing, invitations, invitation acceptance, role change, invitation
  revoke, and membership deactivation.
- Last-org-admin protection.
- OpenAPI definitions and generated types for the current workspace/member
  endpoints.

### Current gaps

- PR #165 must be merged for project deletion.
- Deleted active-project selection can be written back by AppRail and needs a
  dedicated follow-up.
- Profiles are currently one mutable active row per workspace. There is no
  reusable custom pool or per-project override.
- First sign-in currently provisions a workspace automatically instead of
  presenting workspace creation onboarding.
- Workspace metadata is too limited for the approved Workspace screen.
- The web has no Workspace page/switcher, Team page, or invitation acceptance
  page.
- The API client exposes generated workspace/member types but no handwritten web
  client functions for those operations.
- The profile page is functional but not the approved premium profile
  management experience.
- The web still needs a full permission, responsive, loading, error, and visual
  consistency audit.
- Help and the onboarding tour do not exist.

## 4. Fixed Execution And PR Order

Keep this order unless a blocking dependency is discovered.

1. Merge PR #165 without combining unrelated new work.
2. Open a dedicated delete/selected-project follow-up PR.
3. Deliver all profile schema, migration, contract, service, and API changes.
4. Deliver workspace onboarding, metadata, and workspace-less session API
   changes.
5. Complete an API integration/hardening PR so the web starts against stable
   contracts.
6. Build the new Profiles web experience and premium Phase 6 UI.
7. Build workspace onboarding, Workspace navigation/settings, workspace switch,
   project switch, and dashboard selector behavior.
8. Build the Team tab and invitation acceptance experience.
9. Add Help and the onboarding tour.
10. Fix remaining visible and behavioral bugs.
11. Perform the final premium polish and collect test evidence.

API and database contracts must be stable before the corresponding web phase
starts. Do not build the new profile, workspace, or Team UI against guessed
response shapes.

## 5. Test Gates

### 5.1 Web standard gate

Run from apps/web:

~~~powershell
pnpm typecheck
pnpm lint --max-warnings 0
pnpm format:check
pnpm test:run
pnpm build
~~~

For relevant feature PRs, run targeted Playwright:

~~~powershell
pnpm exec playwright test e2e/projects.spec.ts e2e/profiles.spec.ts e2e/dashboard.spec.ts e2e/history.spec.ts
~~~

Add and include workspace, Team, Help, onboarding, and tour specifications as
those surfaces are created.

Before final evidence:

~~~powershell
pnpm test:e2e
pnpm verify
~~~

pnpm verify does not replace Playwright.

### 5.2 OpenAPI gate

Run from apps/web whenever docs/api/openapi.yaml changes:

~~~powershell
pnpm gen:types
pnpm gen:types:check
pnpm typecheck
~~~

Never hand-edit apps/web/src/lib/types/api.ts.

### 5.3 API and database gate

Run from apps/api:

~~~powershell
pytest tests/unit
pytest tests/integration
~~~

Migration, cascade, RLS, authorization-order, workspace onboarding, profile
limit, and cross-workspace tests require disposable PostgreSQL integration
coverage. If Docker or PostgreSQL is unavailable, record the missing gate and do
not describe the change as fully verified.

### 5.4 Manual web gate

For every web PR verify:

- dark and light mode;
- 1280x720 with no horizontal document scrolling;
- desktop expanded and collapsed rail;
- mobile rail;
- keyboard-only navigation;
- screen-reader names for icon-only controls;
- no clipped text in cards, tables, selectors, dialogs, and toast messages;
- loading, empty, success, 401, 403, 404, and 409 states where applicable;
- long workspace, repository, profile, and member names;
- switching workspace does not show data from the previous workspace.

## 6. Phase 6A: Merge Delete Project PR #165

Goal: land the already reviewed project-removal contract and implementation
without mixing it with the follow-up architecture.

### Merge checklist

- Confirm the live PR head includes the latest main merge.
- Confirm OpenAPI and generated types match.
- Confirm active API, web, type, lint, unit, and image checks pass.
- Confirm no unrelated local documentation changes enter the merge.
- Merge PR #165.
- Do not add profile, workspace, Team, Help, or tour changes to this PR.

### Expected delivered behavior

- DELETE /api/projects/{repo_id}.
- repository:disconnect authorization for org-admin and manager.
- Refusal for queued or running scans.
- Database cascade through repository descendants.
- Named web confirmation.
- Success and conflict feedback.
- Web list refresh after deletion.

## 7. Phase 6B: Delete And Selected-Project Follow-Up

Goal: close the known correctness and coverage gaps immediately after PR #165.

### Required behavior fix

The Projects page and AppRail currently own independent project query state.
Clearing a deleted active project on the page can allow the rail's stale list to
write that deleted project ID back into storage.

Implement one coherent solution:

- Preferred short-term behavior:
  - after deleting the active project, select the first remaining project;
  - if no project remains, clear the selection and send Dashboard/History
    navigation to Projects.
- Also ensure project list invalidation reaches every consumer, or move project
  data to a shared query/cache layer.
- Never allow AppRail to restore an ID known to have been deleted.
- Namespace selected project by active workspace as part of the later workspace
  phase; do not introduce a second incompatible persistence format here without
  a migration plan.

### Backend hardening

- Resolve repository visibility before operation permission so foreign and
  missing repositories preserve the established 404 behavior.
- Remove the delete-specific exception from the foreign-resource authorization
  integration test.
- Make OpenAPI and user messages consistently say queued or running.
- Coordinate scan creation and deletion with a common database lock or other
  transactional guard so a scan cannot be accepted while its repository is
  concurrently removed.

### Tests

- Render the full application layout with AppRail while deleting the active
  first project.
- Prove the deleted ID is absent from storage and rail links.
- Prove the safe remaining project becomes active.
- Prove deleting the last project creates the intentional empty state.
- Add Playwright coverage for active and non-active deletion.
- Add a PostgreSQL integration test proving cascade removal of branches,
  attempts, snapshots, cached scores, files, findings, predictions, and tree
  nodes.
- Add authorization tests for local, missing, and foreign repository IDs.
- Add a concurrency-focused deletion/scan-start test.

### Acceptance criteria

- No stale dashboard/history link points to a deleted repository.
- No descendant rows remain after deletion.
- A queued or running scan blocks deletion deterministically.
- Cross-workspace IDs remain indistinguishable from missing IDs.

## 8. Phase 7A: Workspace Profile Data Model And Migration

Goal: replace the single mutable workspace profile with a reusable workspace
profile pool, one workspace default, and optional per-project overrides.

### Schema design

Prefer simple relational references over copied JSON configuration.

ScoringProfile must support:

- workspace_id;
- profile kind: built-in or custom;
- stable preset key for built-ins;
- name;
- five category weights;
- trust slider;
- created_by_user_id for custom profiles;
- updated_by_user_id;
- created_at;
- updated_at.

Add a workspace default profile reference. This may be a dedicated
workspace-profile settings table or a carefully constrained workspace foreign
key.

Add one optional repository profile assignment:

- repository_id, unique;
- workspace_id;
- scoring_profile_id;
- updated_by_user_id;
- updated_at.

Database and service checks must guarantee that the repository and profile
belong to the same workspace. Prefer a composite key/foreign-key invariant when
practical, with service validation as defense in depth.

### Required invariants

- Exactly three built-ins are available in every workspace.
- Built-ins are immutable.
- Balanced is the initial workspace default.
- A workspace may have at most five custom profiles.
- The five-profile limit is transaction-safe under concurrent creation. Lock a
  workspace/settings row or otherwise serialize count enforcement.
- Custom names are unique per workspace after normalization.
- One workspace default always exists after onboarding completes.
- One project has at most one override.
- Removing a repository cascades its profile assignment.
- Removing a workspace cascades its custom profiles and assignments.
- An in-use profile cannot be deleted.
- Cross-workspace assignment is impossible.

### Migration

- Seed the three built-ins for every existing workspace.
- Inspect the existing active profile:
  - if it exactly matches a built-in, point the workspace default at that
    built-in;
  - otherwise migrate it to one custom profile and select it as default.
- Preserve existing profile values and effective dashboard behavior.
- Give existing projects no explicit override so they inherit the migrated
  workspace default.
- Remove the old one-active-profile partial index only after the replacement
  default invariant exists.
- Provide a downgrade or clearly document irreversible data loss if a faithful
  downgrade is impossible.

### Migration tests

- Empty/new workspace seeds three built-ins and Balanced default.
- Existing preset-equivalent active row maps to the correct built-in.
- Existing custom active row remains a custom default.
- Existing repositories inherit the same effective profile.
- Five custom profiles succeed; the sixth is refused.
- Concurrent sixth-profile creation cannot bypass the limit.
- Cross-workspace profile assignment is rejected.
- In-use and built-in delete restrictions hold at database/service boundaries.

## 9. Phase 7B: Profile OpenAPI, Service, And Endpoints

Goal: expose the approved profile pool and effective project-profile behavior
through a stable contract.

### Contract-first endpoints

- GET /api/profiles
  - list built-ins and custom profiles in the active workspace;
  - identify built-in/custom, workspace default, usage count, and mutability.
- POST /api/profiles
  - create a custom profile;
  - refuse the sixth custom profile with a stable 409 error.
- GET /api/profiles/{profile_id}
  - return a workspace-visible profile.
- PATCH /api/profiles/{profile_id}
  - partially update the custom profile name and/or scoring values;
  - reject built-ins.
- DELETE /api/profiles/{profile_id}
  - delete an unused custom profile;
  - reject built-ins and in-use profiles.
- GET /api/profiles/default
  - return the workspace default.
- PUT /api/profiles/default
  - select a built-in or custom workspace profile as default.
- GET /api/projects/{repo_id}/profile
  - return effective profile, inheritance state, workspace default, and explicit
    override if present.
- PUT /api/projects/{repo_id}/profile
  - assign one profile from the same workspace as the project override.
- DELETE /api/projects/{repo_id}/profile
  - clear the override and restore workspace-default inheritance.

PATCH uses partial input. PUT default/assignment endpoints replace the whole
selection and remain idempotent.

### Stable error codes

Add contract members for at least:

- PROFILE_LIMIT_REACHED;
- PROFILE_BUILT_IN;
- PROFILE_IN_USE;
- PROFILE_NAME_CONFLICT;
- PROFILE_WORKSPACE_MISMATCH, unless the resource is deliberately hidden as
  NOT_FOUND;
- FORBIDDEN;
- NOT_FOUND;
- VALIDATION_FAILED.

Do not expose foreign-workspace profile or repository existence.

### Authorization

- profile:read:
  - org-admin;
  - manager;
  - developer;
  - viewer.
- profile:update for every create, patch, delete, workspace-default change, and
  project-override change:
  - org-admin;
  - manager.
- Developer and viewer receive 403 for mutations.
- Resource visibility is resolved before mutation permission where an existing
  profile or project ID is supplied.

### Scoring and dashboard integration

- Introduce one service function that resolves the effective profile:
  - project override when present;
  - otherwise workspace default.
- Dashboard health reads use the effective project profile.
- Project-card health hints use each project's effective profile.
- Score cache keys continue to include the profile fingerprint.
- Warming/recalculation targets the affected projects and profiles rather than
  assuming one active profile for the whole workspace.
- Updating a custom profile invalidates or queues new cache entries for every
  assigned project and for all inheriting projects when it is the workspace
  default.
- Changing an assignment/default does not create a scan, snapshot, finding, or
  analysis attempt.

### Tests

- Contract and generated-type drift check.
- CRUD success and all stable error cases.
- Built-in immutability.
- Five-custom limit.
- Workspace default selection.
- Project override selection and clearing.
- Cross-workspace 404 behavior.
- Full role matrix.
- Effective-profile resolution.
- Project listing and dashboard use different effective profiles where
  expected.
- Cache fingerprints prevent result collisions.
- Profile writes enqueue only required scoring work and never start scans.

## 10. Phase 8: Workspace Onboarding And Metadata API

Goal: make workspace creation the explicit first authenticated experience and
provide the contract needed by Workspace and selector UI.

### Authentication/session change

The current session assumes a workspace already exists. New-user onboarding
requires an authenticated session before a workspace exists.

- Allow UserSession.workspace_id to be nullable during onboarding, or implement
  an equally explicit pre-workspace authenticated session state.
- GET /api/auth/session returns:
  - authenticated user identity;
  - nullable active workspace_id;
  - needs_workspace_setup;
  - enough active-workspace role/permission context for the web to render
    controls without duplicating policy blindly.
- Workspace-bound endpoints fail with a stable WORKSPACE_REQUIRED response while
  the session has no active workspace.
- Pre-workspace sessions may access only:
  - auth/session;
  - workspace list;
  - workspace creation;
  - invitation acceptance;
  - logout;
  - public health/version endpoints.

### First sign-in behavior

- Provision/update the user identity and create the server session.
- Do not automatically create a personal workspace or demo repository.
- If the user has active memberships, select the proper active/last workspace
  according to a deterministic rule.
- If the user has none, leave workspace_id null and redirect the frontend to
  workspace creation onboarding.
- Creating the first workspace:
  - validates metadata;
  - creates workspace;
  - creates active org-admin membership;
  - seeds built-in profiles and Balanced default;
  - switches the current session to the new workspace;
  - creates no production repository.

### Workspace contract

Create and update payload:

- name: required, trimmed, bounded length;
- description: optional, bounded length;
- website_url: optional, validated URL.

Response:

- workspace_id;
- name;
- description;
- website_url;
- current user role;
- is_active;
- created_at;
- updated_at;
- derived project_count and member_count if included by the final contract.

Endpoints:

- GET /api/auth/workspaces;
- POST /api/auth/workspaces;
- GET /api/auth/workspaces/{workspace_id}, if needed by Workspace settings;
- PATCH /api/auth/workspaces/{workspace_id};
- PUT /api/auth/workspaces/active.

Workspace create and update remain org-admin operations after onboarding. The
special first-workspace create authorization must require the authenticated
workspace-less session, not anonymous access.

### Invitation edge cases

- A workspace-less authenticated user can accept a valid invitation.
- After acceptance, the web can switch the session to the accepted workspace.
- Invalid, expired, revoked, used, mismatched-email, and foreign tokens remain
  indistinguishable where required.
- Invitation acceptance never silently creates a second unrelated workspace.

### Tests

- First login returns workspace setup state and no workspace data access.
- First workspace creation is atomic and assigns org-admin.
- Built-ins/default are provisioned in the same workflow.
- Returning users keep existing memberships and roles.
- Workspace switch changes server-side session context.
- Workspace metadata validation and update authorization.
- A user may have different roles in different workspaces.
- RLS prevents data from the previous workspace after switching.
- Invitation acceptance works with a workspace-less session.

## 11. Phase 9: API Integration And Hardening

Goal: freeze reliable contracts before starting the new web surfaces.

### Required audit

- Regenerate web API types from the final OpenAPI.
- Ensure handwritten web domain types do not contradict generated types.
- Update the route-operation authorization inventory.
- Ensure every new operation has an explicit permission.
- Verify 401, WORKSPACE_REQUIRED, 403, 404, and 409 are distinct and documented.
- Verify resource visibility happens before mutation authorization for existing
  IDs.
- Verify migrations form one Alembic head.
- Verify fresh database upgrade and upgrade from the current production head.
- Verify RLS policies cover new profile/assignment tables.
- Verify workspace switching resets database session context correctly.
- Update outdated RBAC documentation that still describes delivered member
  endpoints as future work.

### Exit criteria

- OpenAPI generation check passes.
- API unit suite passes.
- PostgreSQL integration suite passes.
- Fresh and upgrade migration tests pass.
- No web phase needs to invent an API response or error code.

## 12. Phase 10: Premium Profiles Web Experience

Goal: implement the approved workspace profile pool and per-project selection
as the first major web phase after the API work.

### Page structure

- Premium header explaining how workspace defaults and project overrides work.
- Workspace profile pool:
  - three built-in cards;
  - up to five custom cards;
  - visible default badge;
  - built-in/custom badge;
  - usage count;
  - edit/delete actions only when allowed.
- Context controls:
  - Workspace default mode;
  - Project profile mode with project selector.
- Effective-profile summary:
  - inherited from workspace;
  - or explicit project override.
- Accessible slider editor with all five category weights and trust.
- Sticky/clear action area when content is long.

### Create/edit/delete behavior

- Create custom:
  - start from a built-in, existing custom profile, or current slider values;
  - require a unique name;
  - show custom count such as 3 of 5;
  - block the sixth with the contract message.
- Edit custom:
  - PATCH only changed fields;
  - clearly warn that projects using the profile will receive the update;
  - adopt clamped server values after save.
- Delete custom:
  - named confirmation;
  - built-ins have no delete action;
  - show useful PROFILE_IN_USE feedback and where practical show usage count.
- Workspace default:
  - manager/org-admin can select from the pool;
  - current default is obvious;
  - developer/viewer see a read-only state.
- Project override:
  - choose any profile from the active workspace pool;
  - clear override to inherit workspace default;
  - never show projects from another workspace.

### Premium and accessibility requirements

- Preset cards have icons, descriptions, active/default/selected states, and
  sufficient dark/light contrast.
- Slider rows have labels, hints, numeric badges, and keyboard operation.
- Unsaved changes are explicit.
- Save, create, edit, delete, default change, and override change have distinct
  busy states.
- Navigation away with unsaved changes receives an appropriate warning if it
  can be implemented without fragile global interception.
- 403 produces a permission explanation, not a generic failure toast.
- Empty custom-profile state teaches the user how to create the first one.

### Tests

Vitest:

- Built-ins and custom pool render correctly.
- Limit counter and sixth-profile error.
- Create, PATCH, delete, default select, override select, and override clear.
- Built-ins cannot expose mutation actions.
- In-use delete keeps the dialog/profile.
- Developer/viewer read-only behavior.
- Preset/card selection seeds sliders.
- Slider changes mark unsaved state.
- Server-clamped response replaces the draft.

Playwright:

- Create and edit a custom profile.
- Select it as workspace default.
- Override one project and prove another still inherits default.
- Clear override.
- Delete an unused custom profile.
- Keyboard-operate sliders and dialogs.
- Verify manager/org-admin and read-only role experiences where fixtures allow.

## 13. Phase 11: Workspace And Project Web Experience

Goal: make workspace creation, selection, metadata, and project context obvious
throughout the application.

### New-user onboarding

- Add a protected onboarding route for authenticated users without a workspace.
- Present a focused create-workspace form:
  - name;
  - description;
  - optional website URL.
- Explain that projects and team members will belong to this workspace.
- On success:
  - update/refetch session;
  - enter the app with the new workspace active;
  - open Projects or a clear getting-started state;
  - start the first-run tour.
- Middleware/client guards must distinguish not authenticated from authenticated
  but needing workspace setup.

### Workspace tab

Add a Workspace navigation tab and page.

- Show workspace metadata and current role.
- Org-admin can edit name, description, and website URL.
- Show project/member summary counts if provided by the API.
- Include create-another-workspace action for permitted users.
- Do not mix Team administration into Workspace settings.

### Workspace selector

- Place an accessible workspace selector in the persistent shell and dashboard
  context.
- Show workspace name and current role.
- On switch:
  - update server-side active session;
  - clear/invalidate projects, profiles, members, dashboard, history, scan, and
    effective-profile queries;
  - restore only the selected project saved for that workspace;
  - navigate to that dashboard if valid, otherwise Projects;
  - never flash data from the previous workspace.

### Project selector

- Add project selector to dashboard top navigation.
- It lists only projects from the active workspace.
- Switching project updates the URL, persisted workspace-specific selection,
  branches, dashboard data, history target, and profile context.
- Keep existing branch selector as the third context control.
- Historical snapshot parameters are cleared when changing project unless the
  target snapshot is explicitly valid for that project.

### Projects page

- Make active workspace name visible.
- Continue showing every connected repository in that workspace.
- Keep connect, select, dashboard, history, external link, and remove actions.
- Show permission-aware connect/remove controls.
- Empty state connects workspace onboarding to the first project action.

### Selected-project storage migration

- Replace one global codesage.selectedProjectId value with a workspace-keyed
  format.
- Safely migrate the old value only if it belongs to the active workspace.
- Clear invalid/foreign/deleted values.
- Cover same-tab events, cross-tab storage events, workspace switching, and
  unavailable localStorage.

### Tests

- Workspace-less user is routed to onboarding, not login.
- Create workspace and enter Projects.
- Edit metadata.
- Switch between two workspaces with different roles and repositories.
- No previous-workspace project/profile/member data remains visible.
- Project selector changes dashboard URL and data.
- Workspace-specific project selection restores correctly.
- Workspace with zero projects produces the correct rail and dashboard
  behavior.
- 1280x720 and mobile selector layouts do not overflow.

## 14. Phase 12: Team Tab And Invitation Acceptance

Goal: complete the web layer for the existing member-administration API.

### Navigation and page

- Add Team to the signed-in navigation.
- Team always reflects the active workspace.
- All active roles can open it.
- Page header shows workspace name, current user's role, member count, and
  pending invitation count.

### Member list

- Display:
  - name with safe fallback;
  - email with safe fallback;
  - role;
  - membership status;
  - current-user indicator where applicable.
- Handle long names/emails and mobile layouts without an unusable table.
- Org-admin sees role-change and deactivate controls.
- Other roles see a read-only list.

### Invitations

- Org-admin can:
  - invite a validated email;
  - select manager, developer, or viewer role;
  - view pending invitations;
  - revoke a pending invitation.
- Decide explicitly whether inviting another org-admin is supported by the
  current contract. Do not expose it if policy/product rules do not approve it.
- Show delivery failure separately from validation/conflict failure.
- Do not leave a false pending invitation after email delivery rollback.

### Role and member changes

- Use named confirmation for deactivation.
- Explain last-org-admin conflicts.
- Prevent misleading self-demotion/deactivation UX where the backend refuses it.
- Refetch Team and active workspace role after role changes.
- If the current user's membership becomes inactive in another valid flow,
  redirect safely when the next session check fails.

### Invitation acceptance page

- Implement /invitations/accept?token=....
- If not authenticated, preserve the token safely through sign-in.
- After authentication, submit the token to the existing acceptance endpoint.
- On success:
  - switch to the accepted workspace or offer one clear Enter workspace action;
  - invalidate workspace/session data;
  - navigate into that workspace.
- Handle invalid, expired, revoked, used, and email-mismatch responses without
  leaking sensitive information.

### Web API client

Add typed client functions for:

- list workspaces;
- create/update/switch workspace;
- list members and pending invitations;
- create/revoke invitation;
- accept invitation;
- change member role;
- deactivate membership.

Use generated request/response types instead of the stale manual v2 Member and
Workspace shapes.

### Tests

- Every role can read Team.
- Only org-admin sees and can use management controls.
- Invite, revoke, role change, and deactivate flows.
- Last-admin conflict.
- Invitation acceptance success and failure.
- Workspace switch after acceptance.
- Friendly 403 and 409 feedback.
- Keyboard and mobile Team checks.

## 15. Phase 13: Help And First-Run Tour

Goal: make the finished product understandable without external explanation.

### Help tab

Add a Help navigation item and page containing:

- quick start:
  - create/select workspace;
  - connect/select project;
  - select branch;
  - choose workspace default or project profile;
  - start scan;
  - read dashboard and history;
- role and permission explanation;
- profile inheritance explanation;
- scan lifecycle and queued/running deletion restriction;
- Team invitation guidance;
- common 401, 403, 404, 409, and SCORE_PENDING explanations;
- keyboard/accessibility hints;
- Restart tour action.

Keep Help concise and product-focused. Link to deeper documentation only where
it is useful.

### Tour

Use a small sequence of contextual panels, not a long modal presentation:

1. Workspace selector and Workspace tab.
2. Projects and connect action.
3. Dashboard workspace/project/branch selectors.
4. Profiles and inheritance.
5. Team.
6. Help and Restart tour.

Requirements:

- Start after first workspace creation when the app shell is ready.
- Skip, Back, Next, and Finish as appropriate.
- Escape closes/skips safely.
- Focus moves predictably.
- Missing targets do not break the app.
- Mobile and collapsed-sidebar layouts remain usable.
- Honor reduced motion.
- Persist completion in a versioned user-specific localStorage key.
- Restart clears/overrides completion only for the current user and current tour
  version.

### Tests

- New user sees tour after first workspace creation.
- Skip suppresses automatic restart.
- Finish persists completion.
- Existing user does not see it automatically.
- Restart from Help opens step one.
- Separate users on one browser do not share completion state.
- Missing target and mobile layout do not crash.

## 16. Phase 14: Visible Bug And Behavior Audit

Goal: remove all visible defects after the feature surfaces are complete.

### Full route audit

Review:

- public landing;
- login;
- workspace onboarding;
- Workspace;
- Projects;
- Dashboard latest and historical modes;
- Scan History;
- Profiles;
- Team;
- invitation acceptance;
- Help.

### Behavior checklist

- No stale data after workspace/project/profile changes.
- No deleted project can return through AppRail or storage.
- All selectors agree with URL and server session state.
- Branch and snapshot state reset only when required.
- Every mutation has a busy state and duplicate-submit protection.
- All 403 responses explain missing permission.
- All destructive 409 responses keep context/dialog state needed for recovery.
- 401 redirects safely without losing invitation flow unnecessarily.
- Workspace-required state never looks like signed-out state.
- Empty workspaces, empty projects, unscanned projects, no history, no custom
  profiles, no pending invitations, and no findings all have purposeful states.
- Errors never expose SQL, stack traces, secrets, or foreign-resource existence.

### Responsive/accessibility checklist

- 1280x720 no horizontal page scroll.
- Common larger desktop viewport.
- Tablet and mobile widths.
- Expanded/collapsed/mobile navigation.
- Keyboard-only completion of primary tasks.
- Visible focus, dialog focus return, escape behavior, and screen-reader names.
- Contrast in light and dark themes.
- Reduced motion.
- Zoom/text resizing and long-content resilience.

### Test additions

Every reproduced bug receives the narrowest stable regression test at the
correct layer. Do not solve final polish failures only with screenshots or
manual notes.

## 17. Phase 15: Final Premium Polish And Evidence

Goal: make the stable product visually consistent and produce honest SUS/test
evidence.

### Polish

- Normalize page widths, headings, action placement, card density, skeletons,
  empty states, and toast language.
- Check icon consistency and remove unlabeled icon-only actions.
- Ensure workspace, project, branch, and profile context is always visible where
  a decision affects data.
- Refine dark mode first without allowing light mode regressions.
- Remove obsolete comments, manual type shapes, and stale mock assumptions.
- Avoid introducing new feature scope during this phase.

### Documentation

Update after behavior is real:

- docs/Project Management & Planning/frontend_build_stepbystep.md;
- docs/Project Management & Planning/team-plan-to-final.md;
- docs/Project Management & Planning/plan-to-final-submission.md;
- docs/RBAC_PERMISSION_MATRIX.md;
- docs/api/openapi.yaml;
- architecture/data-model decisions for profile inheritance and workspace-less
  onboarding;
- test plan evidence tables.

### Evidence to record

- Exact API unit and integration results.
- Migration fresh/upgrade results.
- OpenAPI generation result.
- Web typecheck, lint, format, Vitest, build, and Playwright results.
- Role matrix evidence.
- Cross-workspace isolation evidence.
- 1280x720 result.
- Mobile result.
- Keyboard/accessibility notes.
- Dark/light screenshots.
- Key screenshots:
  - workspace onboarding;
  - Workspace page and selector;
  - workspace-scoped Projects;
  - dashboard with three selectors;
  - profile pool/default/project override;
  - Team;
  - invitation acceptance;
  - Help;
  - tour panel;
  - delete confirmation.

## 18. Suggested PR Split

Keep PRs coherent and reviewable.

1. Existing PR #165: merge repository removal.
2. delete-project-follow-up:
   - AppRail/selection fix;
   - authorization ordering;
   - cascade/concurrency/E2E coverage.
3. profile-pool-schema:
   - migration;
   - seeded built-ins;
   - default and assignment tables/invariants.
4. profile-pool-api:
   - OpenAPI;
   - CRUD/default/project endpoints;
   - effective scoring and cache integration;
   - generated types and tests.
5. workspace-onboarding-api:
   - workspace-less session;
   - first workspace creation;
   - metadata;
   - invitation edge cases;
   - migrations and tests.
6. api-contract-hardening:
   - RLS;
   - permissions;
   - migration upgrade gates;
   - docs/generated-type cleanup.
7. web-profiles-premium:
   - pool CRUD;
   - workspace default;
   - project override;
   - premium cards/sliders and tests.
8. web-workspace-project-context:
   - onboarding;
   - Workspace tab;
   - workspace and project selectors;
   - storage migration;
   - Projects/dashboard integration.
9. web-team:
   - Team tab;
   - member/invitation management;
   - invitation acceptance.
10. web-help-tour:
    - Help;
    - first-run tour;
    - restart/persistence/accessibility.
11. web-bug-audit:
    - regression fixes and full route checks.
12. web-final-polish-and-evidence:
    - visual consistency;
    - final test gates;
    - documentation and screenshots.

Do not combine schema migrations, large web redesigns, and unrelated deployment
changes in one PR.

## 19. Daily Execution Rules

For each phase:

1. Re-read the current implementation and relevant migrations.
2. Confirm the OpenAPI/data decision before coding.
3. Make the smallest coherent change.
4. Add or update tests in the same PR.
5. Run the targeted gate.
6. Review the diff for unrelated files and generated drift.
7. Update this tracker and documentation only after behavior is real.
8. Do not commit unless Janidu asks.

## 20. Phase Tracking

Completed foundation:

- [x] Original Phase 1: Premium shell and brand foundation.
- [x] Original Phase 2: Preserve selected project across pages.
- [x] Original Phase 3: Premium dashboard layout and scroll fix.
- [x] Original Phase 4: Historical snapshot UX.
- [x] Original Phase 5: Premium Projects experience.
- [x] RBAC core, workspace selection/creation, and member-administration backend.

Remaining execution:

- [ ] Phase 6A: Merge PR #165.
- [ ] Phase 6B: Delete and selected-project follow-up.
- [ ] Phase 7A: Workspace profile data model and migration.
- [ ] Phase 7B: Profile OpenAPI, service, and endpoints.
- [x] Phase 8: Workspace onboarding and metadata API.
- [x] Phase 9: API integration and hardening.
- [ ] Phase 10: Premium Profiles web experience.
- [ ] Phase 11: Workspace and Project web experience.
- [ ] Phase 12: Team tab and invitation acceptance.
- [ ] Phase 13: Help and first-run tour.
- [ ] Phase 14: Visible bug and behavior audit.
- [ ] Phase 15: Final premium polish and evidence.

## 21. Final Release Guardrails

- Do not implement per-user scoring profiles.
- Do not allow more than five custom profiles per workspace.
- Do not count built-ins toward the custom limit.
- Do not permit built-in profile mutation.
- Do not allow profile/project references across workspaces.
- Do not permit deletion of an in-use profile without an explicit approved
  reassignment design.
- Do not treat web role visibility as authorization.
- Do not reintroduce automatic production demo repositories.
- Do not add private repository support.
- Do not add finding accept/resolve actions.
- Do not weaken RLS for easier workspace switching.
- Do not confuse workspace-required with unauthenticated.
- Do not hand-edit generated OpenAPI types.
- Do not sacrifice tests and evidence for extra animation or decoration.
- Do not change ML behavior unless the API/profile scoring contract requires it
  and the change is separately reviewed.
