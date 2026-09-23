from pathlib import Path

import pandas as pd
import pytest

from codesage_ml.risk.features import (
    FEATURE_ORDER,
    PROCESS_FEATURES,
    PRODUCT_FEATURES,
    TARGET_NAME,
)
from training.risk.prepare_aeeem import _prepare_project


def _write_project(
    project_dir: Path,
    *,
    duplicate_ck_class: bool = False,
    missing_ck_feature: str | None = None,
) -> None:
    project_dir.mkdir(parents=True)

    class_names = ["org.example.A", "org.example.B"]

    if duplicate_ck_class:
        class_names = ["org.example.A", "org.example.A"]

    ck_rows = []

    for index, class_name in enumerate(class_names, start=1):
        row = {
            "classname": class_name,
        }

        for feature in PRODUCT_FEATURES:
            row[feature] = float(index)

        ck_rows.append(row)

    ck = pd.DataFrame(ck_rows)

    if missing_ck_feature is not None:
        ck = ck.drop(columns=[missing_ck_feature])

    change_rows = []

    for index, class_name in enumerate(
        ["org.example.A", "org.example.B"],
        start=1,
    ):
        row = {
            "classname": class_name,
            "bugs": 0 if index == 1 else 2,
        }

        for feature in PROCESS_FEATURES:
            row[feature] = float(index)

        # Churn is allowed to be negative.
        row["codeChurnUntil"] = -5.0 if index == 1 else 3.0
        row["maxCodeChurnUntil"] = -1.0 if index == 1 else 2.0
        row["avgCodeChurnUntil"] = -2.5 if index == 1 else 1.5

        change_rows.append(row)

    change = pd.DataFrame(change_rows)

    ck.to_csv(
        project_dir / "single-version-ck-oo.csv",
        sep=";",
        index=False,
    )

    change.to_csv(
        project_dir / "change-metrics.csv",
        sep=";",
        index=False,
    )


def test_prepare_project_produces_canonical_ml_2_dataset(
    tmp_path: Path,
) -> None:
    project_dir = tmp_path / "demo"

    _write_project(project_dir)

    prepared = _prepare_project(
        "demo",
        project_dir,
    )

    assert list(prepared.columns) == [
        "project_name",
        "class_name",
        *FEATURE_ORDER,
        TARGET_NAME,
    ]

    assert prepared.shape == (
        2,
        2 + len(FEATURE_ORDER) + 1,
    )

    assert prepared["project_name"].tolist() == [
        "demo",
        "demo",
    ]

    assert prepared["class_name"].tolist() == [
        "org.example.A",
        "org.example.B",
    ]

    assert prepared[TARGET_NAME].tolist() == [
        0,
        1,
    ]


def test_prepared_dataset_contains_no_training_leakage(
    tmp_path: Path,
) -> None:
    project_dir = tmp_path / "demo"

    _write_project(project_dir)

    prepared = _prepare_project(
        "demo",
        project_dir,
    )

    assert "bugs" not in prepared.columns
    assert "commits_90d" not in prepared.columns


def test_prepare_project_preserves_signed_churn(
    tmp_path: Path,
) -> None:
    project_dir = tmp_path / "demo"

    _write_project(project_dir)

    prepared = _prepare_project(
        "demo",
        project_dir,
    )

    assert prepared.loc[0, "codeChurnUntil"] == -5.0
    assert prepared.loc[0, "maxCodeChurnUntil"] == -1.0
    assert prepared.loc[0, "avgCodeChurnUntil"] == -2.5


def test_prepare_project_rejects_missing_feature(
    tmp_path: Path,
) -> None:
    project_dir = tmp_path / "demo"

    _write_project(
        project_dir,
        missing_ck_feature="wmc",
    )

    with pytest.raises(
        ValueError,
        match="missing required columns",
    ):
        _prepare_project(
            "demo",
            project_dir,
        )


def test_prepare_project_rejects_duplicate_class_identity(
    tmp_path: Path,
) -> None:
    project_dir = tmp_path / "demo"

    _write_project(
        project_dir,
        duplicate_ck_class=True,
    )

    with pytest.raises(
        ValueError,
        match="duplicate CK classes",
    ):
        _prepare_project(
            "demo",
            project_dir,
        )