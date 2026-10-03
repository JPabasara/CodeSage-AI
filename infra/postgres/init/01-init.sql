-- Bootstrap for the CodeSage AI database.
--
-- Row-Level Security does not apply to superusers or table owners, so the API and
-- workers connect as codesage_app, a non-owner role. codesage_owner runs migrations
-- and owns the schema. The RLS policies are created by the migrations.

CREATE ROLE codesage_app WITH LOGIN PASSWORD 'devpassword' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE codesage TO codesage_app;
GRANT USAGE ON SCHEMA public TO codesage_app;

-- Table-level rights for tables created later by migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE codesage_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO codesage_app;
ALTER DEFAULT PRIVILEGES FOR ROLE codesage_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO codesage_app;
