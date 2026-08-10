"""Detection reference data (SAD §9 group 4): RULE_DEFINITION, SATD_MARKER_PATTERN.

These two tables are the database-resident form of SRS Appendix C, which is the
single normative source for two requirements at once: FR-8.1 (every rule carries a
fixed severity and category) and FR-16 (every rule carries a message template).

They are *reference data*, seeded by migration from
`detection/rules/register.yaml` and `detection/satd/markers.yaml`. Storing them
serves DBR-8/DBR-18 provenance — an attempt can be tied to the rule set that ran —
while the YAML stays the editable source, so recalibrating a threshold is a config
change and not a release (MAINT-04).
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
import uuid

from codesage_api.db.base import Base, UUIDPrimaryKey


class RuleDefinition(UUIDPrimaryKey, Base):
    """One rule-engine rule (SRS Appendix C.1, Table 4.31).

    Each row carries the four things a rule hard-codes: what it detects, the
    category it emits, the severity it emits, and its message template. The rule
    knows what it found, so it knows how bad it is — nothing downstream decides
    this, and no user control writes to any column here.

    Severity is flat per rule in v1.0: `complex-function` emits Medium whether WMC
    is 16 or 45, and a file simply accumulates more findings the worse it gets.
    """

    __tablename__ = "rule_definition"

    rule_id: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("debt_category.id", ondelete="RESTRICT"), nullable=False
    )
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    base_points: Mapped[int] = mapped_column(Integer, nullable=False)

    # 'metric' rules compare a CK measurement against `threshold`; 'pattern' rules
    # match a regex or entropy test against source text. A difference of mechanism,
    # not of detector — both run in the one rule engine, so both emit source='rule'.
    mechanism: Mapped[str] = mapped_column(String(20), nullable=False)
    metric_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    threshold: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)

    message_template: Mapped[str] = mapped_column(Text, nullable=False)


class SATDMarkerPattern(UUIDPrimaryKey, Base):
    """One severity marker for SATD findings (SRS Appendix C.2, Table 4.32).

    ML-1 decides *whether this is debt and of what type*; this table decides *how
    bad*. The division is deliberate: each half does what it is actually good at,
    and severity stays 100% deterministic because nothing in the training data
    labels it.

    `precedence` orders evaluation high → low; the highest match wins, so
    "FIXME: TODO later" is High. Patterns match anywhere in the comment, not only
    at the start, so "this is a temporary workaround" still hits.

    No marker matched is NOT the same as not debt — the classifier catching
    "this whole module is a mess" with no keyword at all is exactly why ML-1 exists
    rather than a plain regex scan. Those default to Medium.
    """

    __tablename__ = "satd_marker_pattern"

    pattern: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    base_points: Mapped[int] = mapped_column(Integer, nullable=False)
    precedence: Mapped[int] = mapped_column(Integer, nullable=False)
    message_template: Mapped[str] = mapped_column(Text, nullable=False)
