"""SCORING_PROFILE and SCORING_PRESET (SAD §9 group 4; SRS DBR-19, FR-20)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from codesage_api.db.base import Base, TimestampMixin, UUIDPrimaryKey


class ScoringPreset(UUIDPrimaryKey, Base):
    """Reference data: Balanced, Security-first, Delivery-speed (FR-20).

    Presets *seed* the sliders — they are not a separate mechanism, which is why a
    preset and a custom profile are different tables only in role, not in shape.
    "Reset to preset" is the same PUT with a preset's values as its body.

    Global rather than per-workspace: a preset is a product-defined starting point,
    so seeding it once beats copying three rows into every new workspace.
    """

    __tablename__ = "scoring_preset"

    key: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    weights: Mapped[dict[str, float]] = mapped_column(JSONB, nullable=False)
    trust_s: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False, default=0.5)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ScoringProfile(UUIDPrimaryKey, TimestampMixin, Base):
    """A workspace's scoring configuration: five category weights plus trust_s.

    Six numbers in `weights` + `trust_s` — that is the entire write performed by
    `PUT /api/profiles/active`. No SNAPSHOT, FINDING or SOURCE_FILE row is touched
    (FR-20, FR-21).

    Holds weights, NEVER severities. That separation is what keeps the visibility
    floor safe: a user who could edit severity could set security to Low and
    quietly defeat FR-24.

    Note there is no `is_active` column — the active profile is pointed at by
    WORKSPACE.active_profile_id, which makes "exactly one active profile per
    workspace" structural rather than something a constraint has to police.
    """

    __tablename__ = "scoring_profile"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    # A JSON object keyed by the FIVE DebtCategory keys: security, code-design,
    # requirement, documentation, test. JSONB rather than five columns because the
    # weight set is versioned by the category taxonomy — the taxonomy already
    # changed once when it was re-read off the dataset, and that should not be a
    # schema migration. Clamping to 0.1–3.0 happens in services.profiles on write.
    weights: Mapped[dict[str, float]] = mapped_column(JSONB, nullable=False)

    # The rules ←→ model trust slider. 0–1, default 0.5, where 0.5 gives both
    # sources a trust of 1.0 so the default position changes nothing.
    trust_s: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False, default=0.5)

    # Which preset this was seeded from, for the "Reset to preset" affordance and
    # so the trend chart can label itself with a real name rather than "custom".
    seeded_from_preset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("scoring_preset.id", ondelete="SET NULL"), nullable=True
    )

    # DBR-19 requires modification time and the user responsible for each change.
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
