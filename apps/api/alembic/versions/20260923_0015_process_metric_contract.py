"""Replace legacy process metrics with the AEEEM-compatible feature contract."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260923_0015"
down_revision: str | None = "20260921_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


NEW_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("number_of_versions_until", sa.Integer()),
    ("number_of_authors_until", sa.Integer()),
    ("lines_added_until", sa.Integer()),
    ("max_lines_added_until", sa.Integer()),
    ("avg_lines_added_until", sa.Double()),
    ("lines_removed_until", sa.Integer()),
    ("max_lines_removed_until", sa.Integer()),
    ("avg_lines_removed_until", sa.Double()),
    ("code_churn_until", sa.Integer()),
    ("max_code_churn_until", sa.Integer()),
    ("avg_code_churn_until", sa.Double()),
    ("age_with_respect_to", sa.Double()),
    ("weighted_age_with_respect_to", sa.Double()),
)


def _column_names() -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("process_metric")
    }


def _check_names() -> set[str]:
    return {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_check_constraints(
            "process_metric"
        )
        if constraint["name"] is not None
    }


def _has_check(short_name: str) -> bool:
    names = _check_names()
    return short_name in names or f"ck_process_metric_{short_name}" in names


def upgrade() -> None:
    columns = _column_names()
    for name, column_type in NEW_COLUMNS:
        if name in columns:
            continue
        op.add_column(
            "process_metric",
            sa.Column(name, column_type, nullable=False, server_default="0"),
        )

    # The old author count and file age have compatible meanings after converting
    # days to the new weeks unit. The other legacy columns are not valid proxies
    # for the new features and intentionally retain the explicit zero fallback.
    columns = _column_names()
    assignments: list[str] = []
    if "author_count" in columns:
        assignments.append("number_of_authors_until = author_count")
    if "file_age" in columns:
        assignments.append("age_with_respect_to = file_age / 7.0")
    if assignments:
        op.execute(f"UPDATE process_metric SET {', '.join(assignments)}")

    for name, _ in NEW_COLUMNS:
        op.alter_column("process_metric", name, server_default=None)

    if _has_check("author_count_nonnegative"):
        constraint_name = next(
            name
            for name in _check_names()
            if name.endswith("author_count_nonnegative")
        )
        op.drop_constraint(constraint_name, "process_metric", type_="check")
    columns = _column_names()
    for name in ("commits_90d", "author_count", "file_age", "recency"):
        if name in columns:
            op.drop_column("process_metric", name)

    checks = {
        "number_of_versions_until_nonnegative": "number_of_versions_until >= 0",
        "number_of_authors_until_nonnegative": "number_of_authors_until >= 0",
        "lines_added_nonnegative": (
            "lines_added_until >= 0 AND max_lines_added_until >= 0 "
            "AND avg_lines_added_until >= 0"
        ),
        "lines_removed_nonnegative": (
            "lines_removed_until >= 0 AND max_lines_removed_until >= 0 "
            "AND avg_lines_removed_until >= 0"
        ),
        "process_ages_nonnegative": (
            "age_with_respect_to >= 0 AND weighted_age_with_respect_to >= 0"
        ),
    }
    for name, condition in checks.items():
        if not _has_check(name):
            op.create_check_constraint(
                f"ck_process_metric_{name}", "process_metric", condition
            )


def downgrade() -> None:
    for name in (
        "number_of_versions_until_nonnegative",
        "number_of_authors_until_nonnegative",
        "lines_added_nonnegative",
        "lines_removed_nonnegative",
        "process_ages_nonnegative",
    ):
        if _has_check(name):
            constraint_name = next(
                existing
                for existing in _check_names()
                if existing.endswith(name)
            )
            op.drop_constraint(constraint_name, "process_metric", type_="check")

    legacy_columns: tuple[tuple[str, sa.types.TypeEngine], ...] = (
        ("commits_90d", sa.Integer()),
        ("author_count", sa.Integer()),
        ("file_age", sa.Double()),
        ("recency", sa.Double()),
    )
    columns = _column_names()
    for name, column_type in legacy_columns:
        if name not in columns:
            op.add_column(
                "process_metric",
                sa.Column(name, column_type, nullable=False, server_default="0"),
            )
    op.execute(
        """
        UPDATE process_metric
        SET author_count = number_of_authors_until,
            file_age = age_with_respect_to * 7.0
        """
    )
    for name in ("commits_90d", "author_count", "file_age", "recency"):
        op.alter_column("process_metric", name, server_default=None)

    for name, _ in reversed(NEW_COLUMNS):
        if name in _column_names():
            op.drop_column("process_metric", name)

    op.create_check_constraint(
        "ck_process_metric_author_count_nonnegative",
        "process_metric",
        "author_count >= 0",
    )
