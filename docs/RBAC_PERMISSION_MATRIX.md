# Workspace permission matrix

Approved policy for application-managed RBAC. Asgardeo continues to provide authentication.

Machine-readable definition: [`policy.json`](../apps/api/src/codesage_api/authorization/policy.json).

**Status:** implemented and enforced end to end. The database, account
provisioning, the reusable authorization layer, and every workspace business
operation — projects, repositories, branches, scans, results, history, the
scoring-profile pool, team administration, and workspace management — check
permissions through the layer described below. Nothing in this matrix is
aspirational any more; the inventory near the end of this document lists each
operation and the permission it requires.

| Permission | Description | Org Admin | Manager | Developer | Viewer |
| --- | --- | :---: | :---: | :---: | :---: |
| `project:read` | View all projects in the workspace | ✓ | ✓ | ✓ | ✓ |
| `repository:read` | View connected repositories and repository details | ✓ | ✓ | ✓ | ✓ |
| `repository:connect` | Connect repositories to the workspace | ✓ | ✓ | — | — |
| `repository:disconnect` | Disconnect repositories from the workspace | ✓ | ✓ | — | — |
| `scan:start` | Start scans for repositories in the workspace | ✓ | ✓ | ✓ | — |
| `scan:cancel_own` | Cancel scans started by the same user | ✓ | ✓ | ✓ | — |
| `scan:cancel_any` | Cancel any running scan in the workspace | ✓ | ✓ | — | — |
| `result:read` | View findings and analysis results | ✓ | ✓ | ✓ | ✓ |
| `history:read` | View scan and analysis history | ✓ | ✓ | ✓ | ✓ |
| `profile:read` | View scoring profiles | ✓ | ✓ | ✓ | ✓ |
| `profile:update` | Apply/change the workspace scoring profile | ✓ | ✓ | — | — |
| `member:read` | View workspace members and their roles | ✓ | ✓ | ✓ | ✓ |
| `member:manage` | Invite/remove members and assign roles | ✓ | — | — | — |
| `workspace:update` | Modify workspace settings | ✓ | — | — | — |

## Enforcement requirements

- Roles are assigned to workspace memberships, not globally to users. Only active memberships grant access.
- Unassigned permissions are denied. All grants are explicit; no wildcard or implicit role inheritance is used.
- Every operation must also verify that its resource belongs to the authorized workspace. Preserve PostgreSQL RLS.
- Scan cancellation requires `scan:cancel_any`, or `scan:cancel_own` with the scan’s initiating user matching the authenticated user. Both paths require the same workspace and a cancellable scan state. Never accept an initiating user ID from the client as proof of ownership.
- Scans without a recorded initiating user cannot qualify for `scan:cancel_own`. Record the authenticated initiating user when creating new scans.
- Keep `project:read` and `repository:read` distinct when mapping endpoints, even if both currently have identical grants.
- Permissions for future operations do not imply that their endpoints already exist.
- Freeze policy values into each database migration; historical migrations must not load this mutable file. Future policy changes require a new migration and updated authorization tests.

## Database migration

Revision `20260921_0010` follows `20260920_0009`. It creates the global `role`,
`permission`, and `role_permission` catalogue and a required `membership.role_id`.
Role IDs use the names in this matrix. The catalogue contains 4 roles,
14 permissions, and 40 grants; the application database role has read-only access.
Membership assignments remain subject to the existing workspace RLS policy.

Existing sole active workspace members become `org-admin`; inactive and invited
members become `viewer`. The migration aborts transactionally if any workspace
has multiple active members: review those memberships before migrating rather
than automatically granting administrator access to everyone. Workspaces with
no active members receive no automatic administrator.

New membership inserts default to `viewer`. Sign-in provisioning explicitly makes
the creator of a new workspace `org-admin`.

From `infra/`, apply the updated images and migration:

```bash
docker compose up -d --build
docker compose logs --tail=100 migrate
```

Deploy the migrations before running the updated API models.

Downgrading to `20260920_0009` removes the RBAC catalogue and membership role
assignments while retaining users, workspaces, and memberships. Those assignments
cannot be recovered by re-upgrading; back up the database before downgrading.

Migration tests use disposable PostgreSQL databases. Run from `apps/api/`:

```bash
pytest tests/integration/test_rbac_migration.py
```

Tests use Docker by default. Alternatively, set `CODESAGE_TEST_POSTGRES_URL` to a
**disposable test PostgreSQL superuser connection**; the fixture creates and removes
its own databases and needs permission to create database roles.

## Account provisioning and membership status

- First sign-in creates the **person and nothing else**. Until revision
  `20260923_0017` it also created a workspace, named it after the user, and
  seeded a demo repository into it, so nobody ever saw an empty product. That
  guess was wrong often enough to be worth removing: the user is now asked what
  their workspace is called, and their first session carries no workspace at all.
- Returning sign-ins preserve existing roles and never activate pending
  invitations. They resolve to the workspace the user was last in — see
  [Workspace selection](#workspace-selection) — or to none, which means
  onboarding rather than failure.
- Session validation rechecks the membership in the session's workspace. Invited,
  inactive, or removed memberships invalidate that session. An active membership
  in another workspace does not grant access to this one. Signing in again then
  succeeds with no workspace instead of being refused: having been removed from
  the only workspace you belonged to is not a failure of authentication, and the
  user can create or accept an invitation to another.
- Effective permission lookup returns an empty set for non-active memberships.
  Roles are read from the database rather than copied into session cookies.
- `services.memberships.accept_workspace_invitation` accepts a pending membership
  already linked to the authenticated user. It preserves the stored role, locks
  the row during acceptance, and rejects missing, inactive, or already accepted
  memberships. Call it in a dedicated transaction with a server-authenticated
  user ID; the caller commits or rolls back the transaction.
- Invitation creation and revocation, single-use token acceptance, verified-email
  linking for invitees who have no account yet, and workspace switching are all
  implemented and listed in the operation inventory below. What is still
  deliberately absent is any **automatic** email-based joining during sign-in: a
  matching email address is not consent, so an invitation is only ever joined by
  someone who follows its token.
- Active-membership access checks and permissions for every workspace operation
  are enforced by the API.

## Reusable authorization dependencies

`deps.get_authorization_context` resolves an immutable request-local
`AuthorizationContext`: `user_id`, `workspace_id`, `membership_id`, `role_id`, and
`permissions`. Its membership is always active. Membership, role, and grants are
read together from PostgreSQL; nothing is cached across requests or stored in the
browser cookie. A valid membership with no grants remains authenticated but has
no operation permissions.

For operations that do not first need to resolve a resource, use:

```python
from typing import Annotated
from fastapi import Depends
from codesage_api.authorization.context import AuthorizationContext
from codesage_api.deps import require_permission

# Include this parameter on the endpoint:
auth: Annotated[AuthorizationContext, Depends(require_permission("scan:start"))]
```

For an operation on a specific existing resource, inject
`Depends(get_authorization_context)` and the usual `Depends(get_db)`. Resolve the
resource with the workspace-bound database session first, then check access:

```python
repository = db.get(Repository, repo_id)
repository = auth.require_resource(
    repository,
    resource_workspace_id=repository.workspace_id if repository else None,
)
auth.require_permission("scan:start")
# Only now perform writes or enqueue work.
```

Use database-derived ownership, including the owning repository for descendants;
never pass client-supplied ownership as proof of access. When combining these
checks into a dependency, make the permission check depend on resource resolution
so it cannot run before the visibility check.

- Missing/invalid authentication or revoked workspace membership: `401 NOT_AUTHENTICATED`.
- Active member without the requested permission: `403 FORBIDDEN`.
- Missing resource or resource outside the session workspace: identical `404 NOT_FOUND`.
- Unknown permission names fail closed with `403`.

The reusable layer is applied to every existing workspace business operation.

## Protected operation inventory

Every operation below is enforced in code. A row marked **resource-first**
resolves the repository, profile, or scan from the workspace-bound session
before the permission is checked, so a missing resource and a resource in
another workspace are indistinguishable `404`s.

### Projects and repositories

| Operation | Method and path | Permission |
| --- | --- | --- |
| List projects | `GET /api/projects` | `project:read` |
| Connect repository | `POST /api/projects` | `repository:connect` |
| Disconnect repository | `DELETE /api/projects/{repo_id}` | `repository:disconnect` (resource-first) |
| List repository branches | `GET /api/repos/{repo_id}/branches` | `repository:read` (resource-first) |

### Scans, results, and history

| Operation | Method and path | Permission |
| --- | --- | --- |
| Start scan | `POST /api/repos/{repo_id}/scan` | `scan:start` (resource-first) |
| Read scan status | `GET /api/repos/{repo_id}/scan/{scan_id}` | `result:read` (resource-first) |
| Cancel scan | `POST /api/repos/{repo_id}/scan/{scan_id}/stop` | `scan:cancel_any`, or `scan:cancel_own` when the authenticated user initiated it (resource-first) |
| Read scan history | `GET /api/repos/{repo_id}/scans` | `history:read` (resource-first) |
| Read repository health and findings | `GET /api/repos/{repo_id}/health` | `result:read` (resource-first) |

### Scoring profiles

The workspace owns a pool of profiles: three built-ins plus at most five custom
ones. Reading is open to every role; every change to the pool, to the workspace
default, and to a project override is one permission, `profile:update`.

| Operation | Method and path | Permission |
| --- | --- | --- |
| List the workspace profile pool | `GET /api/profiles` | `profile:read` |
| Create a custom profile | `POST /api/profiles` | `profile:update` |
| Read one profile | `GET /api/profiles/{profile_id}` | `profile:read` (resource-first) |
| Update a custom profile | `PATCH /api/profiles/{profile_id}` | `profile:update` (resource-first) |
| Delete a custom profile | `DELETE /api/profiles/{profile_id}` | `profile:update` (resource-first) |
| Read the workspace default | `GET /api/profiles/default` | `profile:read` |
| Change the workspace default | `PUT /api/profiles/default` | `profile:update` |
| Read the effective profile | `GET /api/profiles/active` | `profile:read` |
| Apply an explicit profile | `PUT /api/profiles/active` | `profile:update` |
| Read a project's effective profile | `GET /api/projects/{repo_id}/profile` | `profile:read` (resource-first) |
| Override a project's profile | `PUT /api/projects/{repo_id}/profile` | `profile:update` (resource-first) |
| Clear a project override | `DELETE /api/projects/{repo_id}/profile` | `profile:update` (resource-first) |

Built-in profiles are immutable regardless of permission: `PATCH` and `DELETE`
on one answer `409 PROFILE_BUILT_IN`, and a database trigger enforces the same
rule so no future code path can bypass it. Deleting a profile a project still
uses answers `409 PROFILE_IN_USE`; the sixth custom profile answers
`409 PROFILE_LIMIT_REACHED`.

### Team administration

| Operation | Method and path | Permission |
| --- | --- | --- |
| List members and pending invitations | `GET /api/members` | `member:read` |
| Invite a member | `POST /api/invitations` | `member:manage` |
| Revoke a pending invitation | `DELETE /api/invitations/{invitation_id}` | `member:manage` |
| Change a member's role | `PATCH /api/members/{membership_id}/role` | `member:manage` |
| Deactivate a member | `DELETE /api/members/{membership_id}` | `member:manage` |
| Accept an invitation | `POST /api/invitations/accept` | Authenticated only — see below |

Accepting an invitation deliberately carries no permission. The invitee is by
definition not yet a member of the workspace they are joining, so there is no
membership in which to hold one; the signed invitation token is the proof of
access. It is also reachable without a workspace, because a user whose only
route into the product is someone else's invitation must be able to take it.

### Workspace management

| Operation | Method and path | Permission |
| --- | --- | --- |
| Read the current session | `GET /api/auth/session` | Authenticated only |
| List the user's workspaces | `GET /api/auth/workspaces` | Authenticated only |
| Create a workspace | `POST /api/auth/workspaces` | `workspace:update`, except during onboarding — see below |
| Read the active workspace | `GET /api/auth/workspaces/{workspace_id}` | Active membership only — see below |
| Update the active workspace | `PATCH /api/auth/workspaces/{workspace_id}` | `workspace:update` |
| Switch the active workspace | `PUT /api/auth/workspaces/active` | Active membership in the target workspace |

Three of these are deliberately not permission-checked, and each for a reason
worth stating rather than leaving to look like an oversight:

- **Reading the active workspace** requires an active membership and nothing
  more. Its contents — name, description, website, project and member counts —
  are already visible to every role through the workspace switcher and the
  Projects page, so a `workspace:read` permission would restrict nothing while
  implying a boundary that does not exist. Only the **active** workspace is
  readable; another workspace the caller belongs to answers `404`, because the
  session binds one workspace and row-level security isolates the transaction
  to it. Switch first, then read.
- **Creating a workspace** is an org-admin operation once the user has a
  workspace, and authentication alone during onboarding. A user with no
  workspace holds no membership and therefore no permission anywhere; requiring
  `workspace:update` would leave them permanently unable to start. The
  distinction is made by whether the session has a workspace at all, not by
  anything the client sends.
- **Switching** changes only the current server-side session, after an atomic
  check that the target membership is active. There is no permission because
  there is no cross-tenant effect: the user is choosing among workspaces they
  already belong to.

### Workspaces are required, not assumed

A signed-in user with no workspace is a real authenticated state, not a failed
sign-in. Every workspace-bound operation — that is, everything above except the
session, the workspace list, workspace creation, invitation acceptance,
sign-out, and the public health probes — answers `409 WORKSPACE_REQUIRED` in
that state. It is deliberately not `401`: the session is valid and the identity
is known, and answering `401` would send the browser back to sign-in, which
would succeed and land in exactly the same state — a loop with no exit.

`WORKSPACE_REQUIRED` is decided before any permission check, because it has to
be: there is no workspace in which to hold a permission yet. The order for any
request is therefore authentication (`401`), workspace (`409`), resource
visibility (`404`), permission (`403`).

Revision `20260921_0011` records `initiated_by_user_id` and
`initiating_workspace_id` on new analysis attempts. Historical attempts keep a
null initiator, so only `scan:cancel_any` can cancel them. A scan that passed
authorization and was queued continues if its initiator's role later changes;
workers remain constrained to the recorded workspace. New scan requests always
use the caller's current database permissions.

Repository, branch, snapshot, and scan visibility is resolved before permission
checks. Missing and cross-workspace resources therefore return the same `404`,
and denied mutations fail before database writes, GitHub calls, or queue calls.

## Workspace selection

`GET /api/auth/workspaces` lists only the authenticated user's active workspace
memberships and marks the workspace selected by the current session. `PUT
/api/auth/workspaces/active` changes only that server-side session after an
atomic active-membership check; invited, inactive, missing, and foreign
workspaces return the same `404`.

Revision `20260921_0012` adds two narrowly scoped `SECURITY DEFINER` functions.
Discovery requires a matching server-side session and user and returns only
workspace IDs and roles. Switching checks the session owner and target active
membership in the same SQL statement. The existing membership RLS policy is not
widened, and ordinary application queries still see no membership without a
bound workspace.

The pre-session `app_workspace_for_user()` bootstrap remains necessary during
sign-in, when no server-side session or workspace exists yet. Its active-only
filter is unchanged.

Revision `20260921_0012` first made it deterministic by ordering on workspace
ID. Revision `20260923_0017` replaced that ordering with the one users actually
expect: most recently used first, by the latest `session.last_used_at` for each
membership, falling back to workspace ID when a user has never used any of
them. Returning to the application therefore lands in the workspace you left,
rather than in whichever one happened to sort first.

It also now returns `NULL` legitimately. A user with no active membership is not
an error — it is the onboarding state — so sign-in creates a session with a null
`workspace_id` and the application asks them to create a workspace.
