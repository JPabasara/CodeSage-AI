"""Build the canonical ML-2 training dataset from D'Ambros/AEEEM files."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np
import pandas as pd



EXPECTED_TOTAL_CLASSES = 5_371

current_dir = Path(__file__).resolve().parent
ml_src = current_dir.parent.parent / "src"

if str(ml_src) not in sys.path:
    sys.path.insert(0, str(ml_src))




from codesage_ml.risk.features import (
    FEATURE_ORDER,
    PROCESS_FEATURES,
    PRODUCT_FEATURES,
    TARGET_NAME,
)


EXPECTED_PROJECTS = (
    "eclipse",
    "equinox",
    "lucene",
    "mylyn",
    "pde",
)

CK_FILENAME = "single-version-ck-oo.csv"
CHANGE_FILENAME = "change-metrics.csv"


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy()
    result.columns = [
        str(column).strip().rstrip(":")
        for column in result.columns
    ]
    return result


def _load_csv(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(
            f"Required D'Ambros dataset file not found: {path}"
        )

    return _normalize_columns(
        pd.read_csv(path, sep=";")
    )


def _require_columns(
    df: pd.DataFrame,
    required: set[str],
    *,
    source: Path,
) -> None:
    missing = required - set(df.columns)

    if missing:
        raise ValueError(
            f"{source} is missing required columns: "
            f"{sorted(missing)}"
        )


def _prepare_project(
    project: str,
    project_dir: Path,
) -> pd.DataFrame:
    ck_path = project_dir / CK_FILENAME
    change_path = project_dir / CHANGE_FILENAME

    ck = _load_csv(ck_path)
    change = _load_csv(change_path)

    _require_columns(
        ck,
        {"classname", *PRODUCT_FEATURES},
        source=ck_path,
    )

    _require_columns(
        change,
        {
            "classname",
            "bugs",
            *PROCESS_FEATURES,
        },
        source=change_path,
    )

    ck["classname"] = ck["classname"].astype(str).str.strip()
    change["classname"] = (
        change["classname"]
        .astype(str)
        .str.strip()
    )

    if (ck["classname"] == "").any():
        raise ValueError(
            f"{project}: CK dataset contains an empty classname"
        )

    if (change["classname"] == "").any():
        raise ValueError(
            f"{project}: change dataset contains an empty classname"
        )

    if ck["classname"].duplicated().any():
        duplicates = (
            ck.loc[
                ck["classname"].duplicated(keep=False),
                "classname",
            ]
            .unique()
            .tolist()
        )

        raise ValueError(
            f"{project}: duplicate CK classes: {duplicates[:10]}"
        )

    if change["classname"].duplicated().any():
        duplicates = (
            change.loc[
                change["classname"].duplicated(keep=False),
                "classname",
            ]
            .unique()
            .tolist()
        )

        raise ValueError(
            f"{project}: duplicate change-metric classes: "
            f"{duplicates[:10]}"
        )

    ck_selected = ck[
        [
            "classname",
            *PRODUCT_FEATURES,
        ]
    ].copy()

    change_selected = change[
        [
            "classname",
            *PROCESS_FEATURES,
            "bugs",
        ]
    ].copy()

    merged = ck_selected.merge(
        change_selected,
        on="classname",
        how="inner",
        validate="one_to_one",
    )

    if len(merged) != len(ck_selected):
        missing_from_change = sorted(
            set(ck_selected["classname"])
            - set(change_selected["classname"])
        )

        raise ValueError(
            f"{project}: CK classes disappeared during join: "
            f"{missing_from_change[:10]}"
        )

    if len(merged) != len(change_selected):
        missing_from_ck = sorted(
            set(change_selected["classname"])
            - set(ck_selected["classname"])
        )

        raise ValueError(
            f"{project}: change-metric classes disappeared during join: "
            f"{missing_from_ck[:10]}"
        )

    for feature in FEATURE_ORDER:
        merged[feature] = pd.to_numeric(
            merged[feature],
            errors="raise",
        )

    bugs = pd.to_numeric(
        merged["bugs"],
        errors="raise",
    )

    values = merged[list(FEATURE_ORDER)].to_numpy(
        dtype=float
    )

    if not np.isfinite(values).all():
        raise ValueError(
            f"{project}: ML-2 features contain NaN or infinity"
        )

    prepared = pd.DataFrame(
        {
            "project_name": project,
            "class_name": merged["classname"],
        }
    )

    for feature in FEATURE_ORDER:
        prepared[feature] = merged[feature]

    prepared[TARGET_NAME] = (
        bugs > 0
    ).astype(int)

    return prepared


def prepare(
    source_dir: Path,
    output_path: Path,
) -> str:
    frames: list[pd.DataFrame] = []

    for project in EXPECTED_PROJECTS:
        project_dir = source_dir / project

        if not project_dir.is_dir():
            raise FileNotFoundError(
                f"Expected project directory not found: "
                f"{project_dir}"
            )

        frames.append(
            _prepare_project(
                project,
                project_dir,
            )
        )

    prepared = pd.concat(
        frames,
        ignore_index=True,
    )

    if len(prepared) != EXPECTED_TOTAL_CLASSES:
        raise ValueError(
            f"Expected 5,371 classes, got "
            f"{len(prepared):,}"
        )

    expected_columns = [
        "project_name",
        "class_name",
        *FEATURE_ORDER,
        TARGET_NAME,
    ]

    if list(prepared.columns) != expected_columns:
        raise ValueError(
            "Prepared ML-2 dataset has an unexpected schema"
        )

    if prepared[
        ["project_name", "class_name"]
    ].duplicated().any():
        raise ValueError(
            "Prepared ML-2 dataset contains duplicate "
            "project/class identities"
        )

    if set(prepared[TARGET_NAME].unique()) != {0, 1}:
        raise ValueError(
            "ML-2 target must contain exactly classes {0, 1}"
        )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    prepared.to_csv(
        output_path,
        index=False,
    )

    return hashlib.sha256(
        output_path.read_bytes()
    ).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--source",
        type=Path,
        default=(
            Path(__file__).resolve().parents[2]
            / "data"
            / "raw"
        ),
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=(
            Path(__file__).resolve().parents[2]
            / "data"
            / "processed"
            / "dambros_aeeem_ml2.csv"
        ),
    )

    args = parser.parse_args()

    checksum = prepare(
        args.source,
        args.output,
    )

    print(
        f"Prepared {args.output} "
        f"(SHA-256: {checksum})"
    )


if __name__ == "__main__":
    main()