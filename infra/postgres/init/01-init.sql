-- Bootstrap for the Code Sage AI database.
--
-- ⚠️ The point of this file: create a non-superuser, non-owner application role.
--
-- Row-Level Security is silently bypassed by superusers and by a table's owner.
-- If the application connected as `postgres`, or as the role that created the
-- tables, every policy would be ignored and every cross-tenant query would
-- succeed — while appearing to work perfectly in development.
--
-- So there are two roles:
--   codesage_owner  runs migrations and owns the schema
--   codesage_app    what the API and workers connect as; subject to RLS
--
-- The policies themselves are created in the migration that creates the tables,
-- because a policy cannot exist before its table.

CREATE ROLE codesage_app WITH LOGIN PASSWORD 'devpassword' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE codesage TO codesage_app;
GRANT USAGE ON SCHEMA public TO codesage_app;

-- Table-level rights for tables that do not exist yet.
ALTER DEFAULT PRIVILEGES FOR ROLE codesage_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO codesage_app;
ALTER DEFAULT PRIVILEGES FOR ROLE codesage_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO codesage_app;

-- The policies live in the initial migration. Each tenant-owned table gets:
--
--   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON <t>
--       USING (workspace_id = app_current_workspace_id());
--
-- FORCE matters: without it the policy still does not apply to the table owner.
-- The workspace itself is bound per transaction by db/rls.py.
