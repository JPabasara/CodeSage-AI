# Backup and recovery

CodeSage's durable state is the complete PostgreSQL database: tenant identity,
repositories, immutable scan facts, profiles, sessions, and audit records. Redis
contains only transient Celery and progress/cancellation state and is not restored.

## Recovery objective and ownership

The production operator/on-call engineer owns recovery. REL-07 sets a 30-minute
recovery-time target, measured from declaring the incident until a dashboard read
succeeds against the recovered database. Record every drill's timestamps, selected
recovery point, validation result, and operator here or in the linked incident.

Neon point-in-time recovery is limited to the project's configured history window.
As of this runbook, Neon documents a configurable window of up to 30 days; the
operator must verify the actual production value in the Neon Console before relying
on it. Snapshots should cover recovery points that must outlive that window.

## Point-in-time restore

1. Stop API and worker writes and record the UTC incident/recovery timestamp.
2. In Neon Console, create a new branch from the production branch at that timestamp.
3. Attach a compute endpoint and validate the branch without changing production.
4. Set `CODESAGE_DATABASE_URL` for API and workers to the restored endpoint.
5. Run `alembic upgrade head`, then `alembic current` from `apps/api`.
6. Run health, sign-in, tenant-isolation, and one representative dashboard query.
7. Restart workers, then the API. Watch error rate and database connections.
8. Preserve the old branch until validation and incident review are complete.

## Independent dump verification

Run `infra/scripts/backup-verify.sh` with `CODESAGE_DATABASE_URL` set. It creates a
custom-format dump, restores it into a fresh PostgreSQL 16 container, verifies the
Alembic revision, and compares deterministic per-table row counts and checksums.
The script removes only its own temporary container and files.

## Restore drill record

No timed production-like drill has yet been recorded. A release cannot claim REL-07
until a dated drill, evidence screenshot, and elapsed time below 30 minutes are added
to SAD section 3.1.7.
