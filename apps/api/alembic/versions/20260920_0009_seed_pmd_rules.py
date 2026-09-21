"""Seed the curated PMD rules used by the Java scan."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260920_0009"
down_revision: str | None = "20260902_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PMD_RULES = (
    ("pmd:UnusedLocalVariable", "low", "Unused local variable detected by PMD."),
    ("pmd:EmptyCatchBlock", "medium", "Empty catch block detected by PMD."),
    (
        "pmd:ExcessiveParameterList",
        "medium",
        "Excessive method parameter list detected by PMD.",
    ),
    (
        "pmd:UseStringBufferForStringAppends",
        "low",
        "Repeated String concatenation detected by PMD.",
    ),
)


def upgrade() -> None:
    bind = op.get_bind()
    for rule_id, severity, message in PMD_RULES:
        bind.execute(
            sa.text(
                """
                INSERT INTO rule_definition
                    (rule_id, category_id, threshold, severity, message_template)
                VALUES (:rule_id, 'code-design', 0, :severity, :message)
                ON CONFLICT (rule_id) DO NOTHING
                """
            ),
            {"rule_id": rule_id, "severity": severity, "message": message},
        )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM rule_definition WHERE rule_id IN "
            "(:rule_1, :rule_2, :rule_3, :rule_4)"
        ),
        {
            f"rule_{index}": rule_id
            for index, (rule_id, _, _) in enumerate(PMD_RULES, start=1)
        },
    )
