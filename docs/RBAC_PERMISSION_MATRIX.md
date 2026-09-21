# Workspace permission matrix

Approved policy for application-managed RBAC. Asgardeo continues to provide authentication.

Machine-readable definition: [`policy.json`](../apps/api/src/codesage_api/authorization/policy.json).

**Status:** the database, account provisioning, reusable authorization layer, and
existing project/repository/scan/result/history/profile endpoint enforcement are
implemented. Team and workspace-management endpoints remain future work.

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

- First sign-in creates a personal workspace with an active `org-admin` membership.
- Returning sign-ins preserve existing roles and never activate pending invitations.
- Session validation rechecks the membership in the session's workspace. Invited,
  inactive, or removed memberships invalidate that session. An active membership
  in another workspace does not grant access to this one.
- Effective permission lookup returns an empty set for non-active memberships.
  Roles are read from the database rather than copied into session cookies.
- `services.memberships.accept_workspace_invitation` accepts a pending membership
  already linked to the authenticated user. It preserves the stored role, locks
  the row during acceptance, and rejects missing, inactive, or already accepted
  memberships. Call it in a dedicated transaction with a server-authenticated
  user ID; the caller commits or rolls back the transaction.
- Invitation creation/delivery, token or verified-email linking for new invitees,
  HTTP acceptance endpoints, and workspace switching remain separate work. No
  automatic email-based joining is performed during sign-in.
- Active-membership access checks and permissions for all existing workspace
  operations are enforced by the API.

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

| Operation | Permission |
| --- | --- |
| List projects | `project:read` |
| Connect repository | `repository:connect` |
| List repository branches | `repository:read` |
| Start scan | `scan:start` |
| Read scan status | `result:read` |
| Cancel scan | `scan:cancel_any`, or `scan:cancel_own` when the authenticated user initiated it |
| Read scan history | `history:read` |
| Read repository health and findings | `result:read` |
| List/read scoring profiles | `profile:read` |
| Apply scoring profile | `profile:update` |

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
filter is unchanged. The migration adds workspace-ID ordering so users with
several active memberships receive a deterministic initial workspace before
they explicitly switch.
