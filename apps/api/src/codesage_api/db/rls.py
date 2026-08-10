"""Row-Level Security context — the one place tenancy is established.

SRS DB-2 / SAD G1: a workspace is a tenant, every tenant-owned table carries
`workspace_id`, and Postgres RLS keeps them apart. The column exists from day one
even though v1.0 has one user per workspace, so adding teams in v2 is not a
migration.

The mechanism: policies are written against `current_setting('app.workspace_id')`,
and this module is what sets it. `SET LOCAL` scopes the value to the current
transaction, so it cannot leak across pooled connections — a plain `SET` would
persist on the connection and hand the next request someone else's tenant.

⚠️ Two ways to make this look like it works while it does not:
  * Connecting as a superuser or the table owner. Both BYPASS RLS silently. The
    app role must be neither — see infra/postgres/init/01-init.sql.
  * Forgetting to call this on a code path. Then the policy sees no setting and
    (depending on how it is written) either errors or returns nothing. Prefer
    failing closed; a test that asserts cross-tenant reads return zero rows is
    worth more than any amount of care here.
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session


def set_workspace_context(session: Session, workspace_id: uuid.UUID) -> None:
    """Bind the tenant for the current transaction. Called by the request dependency."""
    session.execute(
        text("SET LOCAL app.workspace_id = :wid"),
        {"wid": str(workspace_id)},
    )
