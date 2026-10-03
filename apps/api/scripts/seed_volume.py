"""Generate deterministic dashboard volume for the performance checks.

Run only against a disposable database, as its owner or a superuser (row-level
security would hide the rows being linked otherwise)::

    # One large workspace — 20 repos x 30 snapshots x 500 files x ~20 findings
    python scripts/seed_volume.py --workspaces 1 --repositories 20 --snapshots 30 \\
        --files 500 --findings-per-file 20

    # Baseline capacity — 50 workspaces, one user each, a few small repos
    python scripts/seed_volume.py --workspaces 50 --repositories 3 --snapshots 3 \\
        --files 50 --findings-per-file 4

Rows are generated set-wise inside PostgreSQL, one statement per snapshot, so
the large profile (about six million findings) takes minutes rather than hours.
Findings keep the same fingerprint from one snapshot to the next unless they are
"fixed", which gives the traceability diff realistic work to do.
"""

from __future__ import annotations

import argparse
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from codesage_api.db.rls import set_workspace_context
from codesage_api.services import profiles


@dataclass
class SeededWorkspace:
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    repository_ids: list[uuid.UUID] = field(default_factory=list)


_SNAPSHOT_FACTS = text(
    """
    WITH files AS (
      INSERT INTO source_file (id, snapshot_id, relative_path, language)
      SELECT gen_random_uuid(), :snapshot,
             'src/main/java/pkg' || (i % 25) || '/File' || i || '.java', 'java'
      FROM generate_series(1, :files) AS i
      RETURNING id, relative_path
    ),
    metrics AS (
      INSERT INTO static_metric (id, source_file_id, metric_name, value)
      SELECT gen_random_uuid(), f.id, 'loc', 80 + (abs(hashtext(f.relative_path)) % 400)
      FROM files f
    ),
    locations AS (
      INSERT INTO source_location (id, source_file_id, start_line, end_line, start_column, end_column)
      SELECT gen_random_uuid(), f.id, j * 7, j * 7, 0, 1
      FROM files f CROSS JOIN generate_series(1, :per_file) AS j
      -- A finding "fixed" in this snapshot disappears; the rest persist.
      WHERE (abs(hashtext(f.relative_path || j)) + :ordinal) % 10 <> 0
      RETURNING id, source_file_id, start_line
    )
    INSERT INTO finding (id, snapshot_id, source_location_id, category_id, rule_id,
                         source, severity, description, fingerprint)
    SELECT gen_random_uuid(), :snapshot, l.id,
           (ARRAY['code-design','security','documentation','test','requirement'])
             [1 + abs(hashtext(f.relative_path || l.start_line)) % 5],
           'complex-function', 'rule',
           ((ARRAY['critical','high','medium','medium','low','low'])
             [1 + abs(hashtext(l.start_line || f.relative_path)) % 6])::severity,
           'volume seed finding',
           md5(f.relative_path || ':' || l.start_line)
    FROM locations l JOIN files f ON f.id = l.source_file_id
    """
)


def seed(
    db: Connection,
    *,
    workspaces: int,
    repositories: int,
    snapshots: int,
    files: int,
    findings_per_file: int,
    label: str | None = None,
) -> list[SeededWorkspace]:
    """Insert the volume in the caller's transaction and return what was made."""
    label = label or uuid.uuid4().hex[:8]
    engine_id = db.scalar(
        text(
            "INSERT INTO analysis_engine_version "
            "(id, version_identifier, tool_versions, rule_set_version, extraction_logic_version) "
            "VALUES (gen_random_uuid(), 'perf-seed', '{}', 'v1', 'v1') "
            "ON CONFLICT (version_identifier) DO UPDATE SET rule_set_version = 'v1' "
            "RETURNING id"
        )
    )
    now = datetime.now(UTC)
    seeded: list[SeededWorkspace] = []
    for w in range(workspaces):
        item = SeededWorkspace(uuid.uuid4(), uuid.uuid4())
        seeded.append(item)
        db.execute(
            text("INSERT INTO workspace (id, name) VALUES (:id, :name)"),
            {"id": item.workspace_id, "name": f"Perf {label} {w}"},
        )
        db.execute(
            text(
                "INSERT INTO app_user (id, asgardeo_sub, email, email_verified, theme_preference) "
                "VALUES (:id, :sub, :email, true, 'system')"
            ),
            {"id": item.user_id, "sub": f"perf-{label}-{w}", "email": f"perf{w}@{label}.test"},
        )
        db.execute(
            text(
                "INSERT INTO membership (id, user_id, workspace_id, status, role_id) "
                "VALUES (gen_random_uuid(), :user, :workspace, 'active', 'org-admin')"
            ),
            {"user": item.user_id, "workspace": item.workspace_id},
        )
        # The built-in profiles and default, exactly as onboarding creates them.
        orm = Session(bind=db)
        set_workspace_context(orm, item.workspace_id)
        profiles.seed_workspace_profiles(orm, item.workspace_id, actor_user_id=item.user_id)
        orm.flush()
        for r in range(repositories):
            repository_id, branch_id = uuid.uuid4(), uuid.uuid4()
            item.repository_ids.append(repository_id)
            db.execute(
                text(
                    "INSERT INTO repository (id, workspace_id, source_platform, "
                    "external_repository_id, name, owner, url, visibility, connection_status) "
                    "VALUES (:id, :workspace, 'github', :external, :name, 'perf', :url, "
                    "'public', 'connected')"
                ),
                {
                    "id": repository_id, "workspace": item.workspace_id,
                    "external": f"{label}-{w}-{r}", "name": f"repo-{r}",
                    "url": f"https://github.com/perf/{label}-{w}-{r}",
                },
            )
            db.execute(
                text(
                    "INSERT INTO branch (id, repository_id, name, head_commit_sha, is_default) "
                    "VALUES (:id, :repository, 'main', :sha, true)"
                ),
                {"id": branch_id, "repository": repository_id, "sha": "f" * 40},
            )
            for s in range(snapshots):
                attempt_id, snapshot_id = uuid.uuid4(), uuid.uuid4()
                commit = f"{w:04x}{r:04x}{s:04x}".ljust(40, "0")
                completed = now - timedelta(days=snapshots - s)
                db.execute(
                    text(
                        "INSERT INTO analysis_attempt (id, initiated_by_user_id, "
                        "initiating_workspace_id, branch_id, analysis_engine_version_id, "
                        "commit_sha, trigger_type, status, start_time, completion_time, "
                        "retry_count) VALUES (:id, :user, :workspace, :branch, :engine, "
                        ":commit, 'manual', 'done', :started, :completed, 0)"
                    ),
                    {
                        "id": attempt_id, "user": item.user_id, "workspace": item.workspace_id,
                        "branch": branch_id, "engine": engine_id, "commit": commit,
                        "started": completed - timedelta(minutes=3), "completed": completed,
                    },
                )
                db.execute(
                    text(
                        "INSERT INTO snapshot (id, analysis_attempt_id, commit_sha, scan_time, "
                        "finding_count) VALUES (:id, :attempt, :commit, :completed, 0)"
                    ),
                    {"id": snapshot_id, "attempt": attempt_id, "commit": commit,
                     "completed": completed},
                )
                db.execute(
                    _SNAPSHOT_FACTS,
                    {"snapshot": snapshot_id, "files": files, "per_file": findings_per_file,
                     "ordinal": s},
                )
                db.execute(
                    text(
                        "UPDATE snapshot SET finding_count = "
                        "(SELECT count(*) FROM finding WHERE snapshot_id = :id) WHERE id = :id"
                    ),
                    {"id": snapshot_id},
                )
    db.execute(text("ANALYZE"))
    return seeded


def main() -> None:
    from codesage_api.config import get_settings

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--workspaces", type=int, default=1)
    parser.add_argument("--repositories", type=int, default=20)
    parser.add_argument("--snapshots", type=int, default=30)
    parser.add_argument("--files", type=int, default=500)
    parser.add_argument("--findings-per-file", type=int, default=20)
    parser.add_argument(
        "--database-url",
        default=None,
        help="Owner/superuser URL. Defaults to CODESAGE_MIGRATION_DATABASE_URL.",
    )
    args = parser.parse_args()
    settings = get_settings()
    url = args.database_url or settings.migration_database_url or settings.database_url
    engine = create_engine(url)
    with engine.begin() as db:
        seeded = seed(
            db,
            workspaces=args.workspaces,
            repositories=args.repositories,
            snapshots=args.snapshots,
            files=args.files,
            findings_per_file=args.findings_per_file,
        )
    print(f"Seeded {len(seeded)} workspace(s); first: {seeded[0].workspace_id}")


if __name__ == "__main__":
    main()
