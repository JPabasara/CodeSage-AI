"""Loads the scoring constants from YAML.

"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from codesage_api.scoring.enums import Category, Severity

_CONFIG_DIR = Path(__file__).parent / "config"


@dataclass(frozen=True, slots=True)
class ScoringConfig:
    base_points: dict[Severity, float]
    churn_cap: int
    k: float
    weight_range: tuple[float, float]
    s_range: tuple[float, float]
    grade_bands: tuple[tuple[float, str], ...]  # descending by threshold


@dataclass(frozen=True, slots=True)
class Preset:
    name: str
    weights: dict[Category, float]
    s: float


@lru_cache
def get_scoring_config() -> ScoringConfig:
   
    base = yaml.safe_load((_CONFIG_DIR / "base_points.yaml").read_text(encoding="utf-8"))
    cal = yaml.safe_load((_CONFIG_DIR / "calibration.yaml").read_text(encoding="utf-8"))
    return ScoringConfig(
        base_points={Severity(k): float(v) for k, v in base["base_points"].items()},
        churn_cap=int(cal["churn_cap_commits"]),
        k=float(cal["k"]),
        weight_range=(float(cal["weight_min"]), float(cal["weight_max"])),
        s_range=(float(cal["s_min"]), float(cal["s_max"])),
        grade_bands=tuple(
            (float(band["min_score"]), str(band["grade"])) for band in cal["grade_bands"]
        ),
    )


@lru_cache
def get_presets() -> dict[str, Preset]:
    """The three seed profiles. Balanced is the default for every new workspace."""
    raw = yaml.safe_load((_CONFIG_DIR / "presets.yaml").read_text(encoding="utf-8"))
    return {
        key: Preset(
            name=body["name"],
            weights={Category(c): float(w) for c, w in body["weights"].items()},
            s=float(body["s"]),
        )
        for key, body in raw["presets"].items()
    }
