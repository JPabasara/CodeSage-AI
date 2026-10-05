
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from codesage_api.config import get_settings
from codesage_api.db.enums import (
    AnalysisStatus,
    RepositoryConnectionStatus,
    RepositoryPlatform,
    RepositoryVisibility,
)
from codesage_api.db.models import AnalysisAttempt, Branch, Repository, SnapshotScore
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import (
    NotFound,
    RepositoryAlreadyConnected,
    RepositoryHasNoJava,
    RepositoryMissingDefaultBranch,
    RepositoryScanRunning,
    RepositoryTooLarge,
)
from codesage_api.integrations.github import (
    GitHubRepository,
    fetch_branch,
    fetch_branches,
    fetch_file_paths,
    fetch_repository,
)
from codesage_api.logging import get_logger
from codesage_api.schemas import BranchOut, LatestHealthOut, RepoOut, SourceScopeConfigOut
from codesage_api.scoring.cache import profile_payload
from codesage_api.scoring.models import Profile
from codesage_api.services import audit, dashboard, profiles
from codesage_api.source_scope import DEFAULT_TEST_PATHS
from codesage_api.tasks.app import celery_app

logger = get_logger(__name__)

#: GitHub's name for the language CodeSage analyses.
ANALYSED_GITHUB_LANGUAGES = frozenset({"Java"})


def disconnect(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    actor_user_id: uuid.UUID,
) -> None:
    repository = session.scalar(
        select(Repository)
        .where(
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
        )
        .with_for_update()
    )
    if repository is None:
        raise NotFound

    active_attempt = session.scalar(
        select(AnalysisAttempt.id)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .where(
            Branch.repository_id == repository.id,
            AnalysisAttempt.status.in_((AnalysisStatus.QUEUED, AnalysisStatus.RUNNING)),
        )
        .limit(1)
    )
    if active_attempt is not None:
        raise RepositoryScanRunning

    audit.record(
        session,
        event_type="repository_disconnected",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="repository",
        resource_id=str(repository.id),
    )
    session.delete(repository)
    session.flush()


def _check_guardrails(metadata: GitHubRepository) -> None:
    """Refuse at connect what a scan could never finish .

    Fast answers from what GitHub already knows. The worker checks again at scan
    time, because the scanned branch can differ from what GitHub reports here.
    """
    limit_mb = get_settings().max_repository_size_mb
    if metadata.size_kb > limit_mb * 1024:
        raise RepositoryTooLarge(limit_mb)
    if not ANALYSED_GITHUB_LANGUAGES.intersection(metadata.languages):
        raise RepositoryHasNoJava(list(metadata.languages))


def connect(
    session: Session,
    workspace_id: uuid.UUID,
    url: str,
    actor_user_id: uuid.UUID,
) -> RepoOut:
    metadata = fetch_repository(url)
    existing = session.scalar(
        select(Repository).where(
            Repository.workspace_id == workspace_id,
            Repository.source_platform == RepositoryPlatform.GITHUB,
            Repository.external_repository_id == metadata.external_id,
        )
    )
    if existing is not None:
        raise RepositoryAlreadyConnected
    _check_guardrails(metadata)

    repository = Repository(
        workspace_id=workspace_id,
        source_platform=RepositoryPlatform.GITHUB,
        external_repository_id=metadata.external_id,
        name=metadata.name,
        owner=metadata.owner,
        url=metadata.url,
        visibility=RepositoryVisibility.PUBLIC,
        connection_status=RepositoryConnectionStatus.CONNECTED,
    )
    default_branch = Branch(
        name=metadata.default_branch,
        head_commit_sha=metadata.default_branch_sha,
        is_default=True,
    )
    repository.branches.append(default_branch)

    try:
        with session.begin_nested():
            session.add(repository)
            session.flush()
    except IntegrityError as exc:
        raise RepositoryAlreadyConnected from exc

    audit.record(
        session,
        event_type="repository_connected",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="repository",
        resource_id=str(repository.id),
    )
    return _to_output(repository, default_branch.name, latest_health=None)


def list_projects(session: Session, workspace_id: uuid.UUID) -> list[RepoOut]:

    statement = (
        select(Repository)
        .where(Repository.workspace_id == workspace_id)
        .options(selectinload(Repository.branches))
        .order_by(Repository.created_at.desc(), Repository.id.desc())
    )
    stored_repositories = session.scalars(statement).all()
    pool = profiles.load_pool(session, workspace_id) if stored_repositories else None
    output: list[RepoOut] = []
    pending: list[tuple[SnapshotScore, Profile]] = []
    for repository in stored_repositories:
        assert pool is not None
        profile = profiles.to_scoring_profile(pool.for_repository(repository.id))
        default_branch = next(
            (branch.name for branch in repository.branches if branch.is_default), None
        )
        if default_branch is None:
            logger.error(
                "Skipping repository without a default branch",
                extra={"repository_id": str(repository.id)},
            )
            continue

        latest_health, prepared = dashboard.build_latest_health_hint(
            session,
            workspace_id,
            repository.id,
            default_branch,
            profile,
        )
        pending.extend((cached, profile) for cached in prepared)
        output.append(_to_output(repository, default_branch, latest_health))
    if pending:
        session.commit()
        try:
            for cached, cached_profile in pending:
                celery_app.send_task(
                    "codesage.score_snapshot",
                    args=[
                        str(cached.id),
                        str(workspace_id),
                        profile_payload(cached_profile),
                    ],
                )
        except Exception:
            logger.exception("Could not enqueue project score calculation")
            set_workspace_context(session, workspace_id)
            for cached, _ in pending:
                stored = session.get(SnapshotScore, cached.id)
                if stored is not None and stored.status == "pending":
                    stored.status = "error"
                    stored.failure_information = "Score calculation could not be queued."
            session.commit()
    return output


def list_branches(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
) -> list[BranchOut]:
    """Refresh GitHub branch heads for a tenant-owned repository."""
    repository = session.scalar(
        select(Repository)
        .where(
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
        )
        .options(selectinload(Repository.branches))
    )
    if repository is None:
        raise NotFound

    default_name = next((branch.name for branch in repository.branches if branch.is_default), None)
    if default_name is None:
        raise RepositoryMissingDefaultBranch

    existing = {branch.name: branch for branch in repository.branches}
    output: list[BranchOut] = []
    seen: set[str] = set()
    for github_branch in fetch_branches(repository.owner, repository.name):
        branch = existing.get(github_branch.name)
        is_default = github_branch.name == default_name
        if branch is None:
            branch = Branch(
                name=github_branch.name,
                head_commit_sha=github_branch.head_commit_sha,
                is_default=is_default,
            )
            repository.branches.append(branch)
        else:
            branch.head_commit_sha = github_branch.head_commit_sha
            branch.is_default = is_default
        seen.add(branch.name)
        output.append(
            BranchOut(
                name=branch.name,
                is_default=branch.is_default,
                head_commit_sha=branch.head_commit_sha,
                head_commit_at=None,
            )
        )

    for stale in repository.branches:
        if stale.name not in seen:
            session.delete(stale)
    return output


def _scope_output(repository: Repository) -> SourceScopeConfigOut:
    return SourceScopeConfigOut(
        test_path_patterns=repository.test_path_patterns or list(DEFAULT_TEST_PATHS),
        production_path_overrides=repository.production_path_overrides or [],
        scan_excluded_directories=bool(repository.scan_excluded_directories),
        hide_excluded_findings=bool(
            repository.scan_excluded_directories and repository.hide_excluded_findings
        ),
    )


def get_source_scope_config(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    *,
    include_paths: bool = False,
) -> SourceScopeConfigOut:
    repository = session.scalar(
        select(Repository).where(
            Repository.id == repository_id, Repository.workspace_id == workspace_id
        )
    )
    if repository is None:
        raise NotFound
    result = _scope_output(repository)
    if include_paths:
        default_branch = next((branch for branch in repository.branches if branch.is_default), None)
        if default_branch is None:
            raise NotFound
        revision = fetch_branch(
            repository.owner, repository.name, default_branch.name
        ).head_commit_sha
        result.file_paths = fetch_file_paths(repository.owner, repository.name, revision)
    return result


def update_source_scope_config(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    test_path_patterns: list[str],
    production_path_overrides: list[str],
    scan_excluded_directories: bool = False,
    hide_excluded_findings: bool = False,
) -> SourceScopeConfigOut:
    repository = session.scalar(
        select(Repository)
        .where(Repository.id == repository_id, Repository.workspace_id == workspace_id)
        .with_for_update()
    )
    if repository is None:
        raise NotFound
    repository.test_path_patterns = list(
        dict.fromkeys(item.strip() for item in test_path_patterns if item.strip())
    )
    repository.production_path_overrides = list(
        dict.fromkeys(item.strip() for item in production_path_overrides if item.strip())
    )
    repository.scan_excluded_directories = scan_excluded_directories
    repository.hide_excluded_findings = scan_excluded_directories and hide_excluded_findings
    session.flush()
    return _scope_output(repository)


def _to_output(
    repository: Repository,
    default_branch: str,
    latest_health: LatestHealthOut | None,
) -> RepoOut:
    return RepoOut(
        id=str(repository.id),
        name=repository.name,
        owner=repository.owner,
        visibility=repository.visibility.value,
        url=repository.url,
        default_branch=default_branch,
        connected_at=repository.created_at.isoformat(),
        latest_health=latest_health,
        hide_excluded_findings=bool(
            repository.scan_excluded_directories and repository.hide_excluded_findings
        ),
    )
