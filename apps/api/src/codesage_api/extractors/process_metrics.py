from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from time import perf_counter

from pydriller import Repository

from codesage_api.logging import get_logger

logger = get_logger(__name__)

SECONDS_PER_WEEK = 7 * 24 * 60 * 60


@dataclass(frozen=True, slots=True)
class FileProcessMetrics:
    path: str

    number_of_versions_until: int
    number_of_authors_until: int

    lines_added_until: int
    max_lines_added_until: int
    avg_lines_added_until: float

    lines_removed_until: int
    max_lines_removed_until: int
    avg_lines_removed_until: float

    code_churn_until: int
    max_code_churn_until: int
    avg_code_churn_until: float

    age_with_respect_to: float
    weighted_age_with_respect_to: float


@dataclass(slots=True)
class _History:
    commits: set[str] = field(default_factory=set)
    authors: set[str] = field(default_factory=set)

    lines_added: list[int] = field(default_factory=list)
    lines_removed: list[int] = field(default_factory=list)
    churn: list[int] = field(default_factory=list)

    # Each entry is:
    # (datetime of revision, lines added in that revision)
    changes: list[tuple[datetime, int]] = field(default_factory=list)

    first_change: datetime | None = None


def _java_files(repository_path: Path) -> set[str]:
    """Return Java files present in the scanned working tree."""
    return {
        path.relative_to(repository_path).as_posix()
        for path in repository_path.rglob("*.java")
        if ".git" not in path.parts
    }


def _normalize_path(path: str | None) -> str | None:
    if path is None:
        return None

    return path.replace("\\", "/")


def _author_identity(commit) -> str:
    """
    Return the identity used when counting distinct authors.

    Prefer email because names are more likely to vary in formatting.
    Fall back to the author's name if no email is available.
    """
    email = commit.author.email
    if email:
        return email.strip().lower()

    return commit.author.name.strip()


def _mean(values: list[int]) -> float:
    if not values:
        return 0.0

    return sum(values) / len(values)


def extract_process_metrics(
    repository_path: Path,
    commit_sha: str,
    anchor_date: datetime,
) -> list[FileProcessMetrics]:
    """
    Extract D'Ambros/Moser-style process metrics for Java files.

    History is bounded by commit_sha.

    The metrics are calculated from all revisions of each file up to
    the scanned commit.

    age_with_respect_to and weighted_age_with_respect_to are expressed
    in weeks.
    """
    started = perf_counter()

    files = _java_files(repository_path)

    histories = {
        path: _History()
        for path in files
    }

    # Maps historical paths to the current file whose history they belong to.
    #
    # Initially every current path maps to itself. When a rename is observed,
    # the old path is associated with the same current file.
    path_aliases = {
        path: path
        for path in files
    }

    commits_inspected = 0

    for commit in Repository(
        str(repository_path),
        to_commit=commit_sha,
    ).traverse_commits():
        commits_inspected += 1

        changed_at = commit.committer_date

        # anchor_date is the reference point for the age metrics.
        # commit_sha, rather than this date comparison, defines the
        # repository-history boundary.
        if changed_at > anchor_date:
            continue

        author = _author_identity(commit)

        for modified in commit.modified_files:
            old_path = _normalize_path(modified.old_path)
            new_path = _normalize_path(modified.new_path)

            current_path: str | None = None

            # Normal modification of a currently known file.
            if new_path is not None and new_path in path_aliases:
                current_path = path_aliases[new_path]

            # Modification through an already-known historical path.
            elif old_path is not None and old_path in path_aliases:
                current_path = path_aliases[old_path]

            if current_path is None:
                continue

            history = histories.get(current_path)

            if history is None:
                continue

            # Preserve rename continuity.
            if old_path is not None:
                path_aliases[old_path] = current_path

            if new_path is not None:
                path_aliases[new_path] = current_path

            # One revision of this file.
            #
            # Using the commit hash prevents the same commit from being
            # counted twice if path aliasing encounters it more than once.
            if commit.hash in history.commits:
                continue

            history.commits.add(commit.hash)
            history.authors.add(author)

            added = int(modified.added_lines or 0)
            removed = int(modified.deleted_lines or 0)

            # D'Ambros/Moser churn:
            #
            #     churn = added LOC - removed LOC
            #
            # This is deliberately NOT added + removed.
            churn = added - removed

            history.lines_added.append(added)
            history.lines_removed.append(removed)
            history.churn.append(churn)

            history.changes.append(
                (changed_at, added)
            )

            if (
                history.first_change is None
                or changed_at < history.first_change
            ):
                history.first_change = changed_at

    results: list[FileProcessMetrics] = []

    for path in sorted(files):
        history = histories[path]

        number_of_versions = len(history.commits)

        lines_added = sum(history.lines_added)
        lines_removed = sum(history.lines_removed)
        total_churn = sum(history.churn)

        max_lines_added = max(
            history.lines_added,
            default=0,
        )

        max_lines_removed = max(
            history.lines_removed,
            default=0,
        )

        max_churn = max(
            history.churn,
            default=0,
        )

        avg_lines_added = _mean(history.lines_added)
        avg_lines_removed = _mean(history.lines_removed)
        avg_churn = _mean(history.churn)

        # -------------------------------------------------------------
        # Age
        # -------------------------------------------------------------

        if history.first_change is None:
            age_weeks = 0.0
        else:
            age_seconds = (
                anchor_date - history.first_change
            ).total_seconds()

            age_weeks = max(
                0.0,
                age_seconds / SECONDS_PER_WEEK,
            )

        # -------------------------------------------------------------
        # Weighted age
        # -------------------------------------------------------------
        #
        # weighted age =
        #
        #   Σ(age of revision i in weeks × LOC added in revision i)
        #   --------------------------------------------------------
        #                    Σ(LOC added in revision i)
        #
        # If no lines were ever added, use 0.0 as the explicit fallback.
        # -------------------------------------------------------------

        if lines_added > 0:
            weighted_age_sum = 0.0

            for changed_at, added in history.changes:
                revision_age_seconds = (
                    anchor_date - changed_at
                ).total_seconds()

                revision_age_weeks = max(
                    0.0,
                    revision_age_seconds / SECONDS_PER_WEEK,
                )

                weighted_age_sum += (
                    revision_age_weeks * added
                )

            weighted_age = (
                weighted_age_sum / lines_added
            )

        else:
            weighted_age = 0.0

        results.append(
            FileProcessMetrics(
                path=path,

                number_of_versions_until=number_of_versions,
                number_of_authors_until=len(history.authors),

                lines_added_until=lines_added,
                max_lines_added_until=max_lines_added,
                avg_lines_added_until=avg_lines_added,

                lines_removed_until=lines_removed,
                max_lines_removed_until=max_lines_removed,
                avg_lines_removed_until=avg_lines_removed,

                code_churn_until=total_churn,
                max_code_churn_until=max_churn,
                avg_code_churn_until=avg_churn,

                age_with_respect_to=age_weeks,
                weighted_age_with_respect_to=weighted_age,
            )
        )

    logger.info(
        "Repository history extraction completed",
        extra={
            "event": "stage_completed",
            "stage": "history-extraction",
            "duration_ms": round(
                (perf_counter() - started) * 1000
            ),
            "commits_inspected": commits_inspected,
            "files_measured": len(results),
        },
    )

    return results