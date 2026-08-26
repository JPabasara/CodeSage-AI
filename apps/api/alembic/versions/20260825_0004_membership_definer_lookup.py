"""Let the sign-in workspace lookup actually see MEMBERSHIP.

Revision ID: 20260825_0004
Revises: 20260825_0003

THE BUG THIS FIXES: the second sign-in, and every one after it, answered
401 NOT_AUTHENTICATED from `/api/auth/callback`.

Sign-in has a chicken-and-egg problem. To bind a workspace we must first look
one up, but MEMBERSHIP -- the table holding the answer -- is itself filtered by
the workspace we do not have yet. `app_workspace_for_user()` was created
SECURITY DEFINER precisely to see past that filter, and it is the only thing in
the system allowed to.

It could not. The initial migration also ran:

    ALTER TABLE membership FORCE ROW LEVEL SECURITY

and FORCE means "apply policies to the table OWNER as well". A SECURITY DEFINER
function runs as its owner, which is the migration role, which owns the table.
So the one deliberate escape hatch was closed by the very setting meant to close
the accidental ones.

With no workspace bound, `app_current_workspace_id()` is NULL, the predicate
`workspace_id = NULL` is NULL rather than true, every row is filtered out, and
the function returns NULL. `resolve_workspace` reads that as "this person
belongs to no workspace" and raises NotAuthenticated.

WHY THE FIRST SIGN-IN ALWAYS WORKED, which is what hid this for two weeks:
a brand new user goes through `_provision_new_user`, which calls
`set_workspace_context` before inserting the MEMBERSHIP row. The context is
therefore already bound when the lookup runs, the predicate matches, and
sign-in succeeds. A returning user skips that path entirely, so nothing binds a
context and the lookup fails. First sign-in fine, every later one 401.

THE FIX: drop FORCE on MEMBERSHIP alone.

This does NOT weaken tenant isolation for the application. FORCE only changes
what the table OWNER sees; `codesage_app`, which is what the API and the workers
connect as, is not the owner and remains fully subject to the policy. The policy
itself is untouched. What changes is that the owner -- migrations, and this one
narrow SECURITY DEFINER function -- can read MEMBERSHIP without a bound
workspace, which is exactly the exemption the function was written to have.

MEMBERSHIP is the only table that needs this. It is the only one read BEFORE a
workspace is known; everything else is read after `set_workspace_context` has
run, and every other table keeps FORCE.

Rejected alternative, recorded so nobody tries it: widening the policy to
`workspace_id = app_current_workspace_id() OR app_current_workspace_id() IS
NULL`. That reads as "when no workspace is bound, show every workspace's rows",
which turns a forgotten `set_workspace_context` from a visible failure into a
silent cross-tenant read. The bug we have is loud and safe. That one would be
quiet and would breach DBR-3.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260825_0004"
down_revision: str | None = "20260825_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # RLS stays ENABLED, so the policy still applies to every non-owner role.
    # Only the owner's exemption is restored.
    op.execute("ALTER TABLE membership NO FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE membership FORCE ROW LEVEL SECURITY")
