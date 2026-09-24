"""Persist class-level bug risk and finding structural context."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260924_0017"
down_revision: str | None = "20260923_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "class_risk_prediction",
        sa.Column("source_file_id", sa.Uuid(), nullable=False),
        sa.Column("model_version_id", sa.Uuid(), nullable=False),
        sa.Column("class_name", sa.String(length=500), nullable=False),
        sa.Column("risk_score", sa.Double(), nullable=False),
        sa.Column("confidence", sa.Double(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name=op.f("ck_class_risk_prediction_class_risk_confidence_probability"),
        ),
        sa.CheckConstraint(
            "risk_score >= 0 AND risk_score <= 1",
            name=op.f("ck_class_risk_prediction_class_risk_score_probability"),
        ),
        sa.ForeignKeyConstraint(
            ["model_version_id"],
            ["ml_model_version.id"],
            name=op.f("fk_class_risk_prediction_model_version_id_ml_model_version"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_file_id"],
            ["source_file.id"],
            name=op.f("fk_class_risk_prediction_source_file_id_source_file"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_class_risk_prediction")),
        sa.UniqueConstraint(
            "source_file_id",
            "model_version_id",
            "class_name",
            name=op.f("uq_class_risk_prediction_source_file_id_model_version_id_class_name"),
        ),
    )
    op.create_index(
        op.f("ix_class_risk_prediction_class_name"),
        "class_risk_prediction",
        ["class_name"],
        unique=False,
    )
    op.create_index(
        op.f("ix_class_risk_prediction_model_version_id"),
        "class_risk_prediction",
        ["model_version_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_class_risk_prediction_source_file_id"),
        "class_risk_prediction",
        ["source_file_id"],
        unique=False,
    )
    op.add_column("finding", sa.Column("class_name", sa.String(length=500), nullable=True))
    op.add_column("finding", sa.Column("method_name", sa.String(length=500), nullable=True))
    predicate = (
        "EXISTS (SELECT 1 FROM source_file sf "
        "JOIN snapshot s ON s.id=sf.snapshot_id "
        "JOIN analysis_attempt a ON a.id=s.analysis_attempt_id "
        "JOIN branch b ON b.id=a.branch_id "
        "JOIN repository r ON r.id=b.repository_id "
        "WHERE sf.id=class_risk_prediction.source_file_id "
        "AND r.workspace_id=app_current_workspace_id())"
    )
    op.execute('ALTER TABLE "class_risk_prediction" ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE "class_risk_prediction" FORCE ROW LEVEL SECURITY')
    op.execute(
        'CREATE POLICY tenant_isolation ON "class_risk_prediction" '
        f"USING ({predicate}) WITH CHECK ({predicate})"
    )


def downgrade() -> None:
    op.drop_column("finding", "method_name")
    op.drop_column("finding", "class_name")
    op.drop_index(
        op.f("ix_class_risk_prediction_source_file_id"),
        table_name="class_risk_prediction",
    )
    op.drop_index(
        op.f("ix_class_risk_prediction_model_version_id"),
        table_name="class_risk_prediction",
    )
    op.drop_index(
        op.f("ix_class_risk_prediction_class_name"),
        table_name="class_risk_prediction",
    )
    op.drop_table("class_risk_prediction")
