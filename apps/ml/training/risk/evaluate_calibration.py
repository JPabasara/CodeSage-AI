"""Project-aware sigmoid calibration evaluation for CodeSage ML-2.

This script reuses the Random Forest hyperparameters selected by the completed
nested-LOPO evaluation.

For each outer test project:

1. The outer test project remains completely untouched.
2. Using the four outer-training projects, generate out-of-project RF
   probabilities by leaving one training project out at a time.
3. Fit a sigmoid calibrator using only those out-of-project probabilities.
4. Train the RF on all four outer-training projects.
5. Predict the untouched outer project.
6. Compare raw and calibrated probabilities.

Calibration is evaluated primarily using Brier score.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    roc_auc_score,
)


# ---------------------------------------------------------------------------
# Production ML-2 contract
# ---------------------------------------------------------------------------

current_dir = Path(__file__).resolve().parent
ml_src = current_dir.parent.parent / "src"

if str(ml_src) not in sys.path:
    sys.path.insert(0, str(ml_src))


from codesage_ml.risk.features import (  # noqa: E402
    FEATURE_ORDER,
    POSITIVE_CLASS,
    TARGET_NAME,
)


PROJECT_COLUMN = "project_name"

EXPECTED_PROJECTS = (
    "eclipse",
    "equinox",
    "lucene",
    "mylyn",
    "pde",
)

RANDOM_STATE = 42


# ---------------------------------------------------------------------------
# General helpers
# ---------------------------------------------------------------------------


def sha256(path: Path) -> str:
    return hashlib.sha256(
        path.read_bytes()
    ).hexdigest()


def load_dataset(
    path: Path,
) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(
            f"Processed ML-2 dataset not found: {path}"
        )

    df = pd.read_csv(path)

    required = {
        PROJECT_COLUMN,
        "class_name",
        TARGET_NAME,
        *FEATURE_ORDER,
    }

    missing = required - set(df.columns)

    if missing:
        raise ValueError(
            f"Dataset is missing columns: {sorted(missing)}"
        )

    if df.isna().any().any():
        raise ValueError(
            "Dataset contains missing values"
        )

    values = df[
        list(FEATURE_ORDER)
    ].to_numpy(dtype=float)

    if not np.isfinite(values).all():
        raise ValueError(
            "Dataset contains non-finite feature values"
        )

    projects = tuple(
        sorted(df[PROJECT_COLUMN].unique())
    )

    if projects != tuple(
        sorted(EXPECTED_PROJECTS)
    ):
        raise ValueError(
            f"Unexpected project set: {projects}"
        )

    return df


def make_random_forest(
    params: dict[str, Any],
) -> RandomForestClassifier:
    return RandomForestClassifier(
        **params,
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )


def positive_probability(
    model: RandomForestClassifier,
    X: pd.DataFrame,
) -> np.ndarray:
    classes = list(model.classes_)

    if POSITIVE_CLASS not in classes:
        raise RuntimeError(
            f"Positive class {POSITIVE_CLASS} "
            "is missing from the RF"
        )

    index = classes.index(POSITIVE_CLASS)

    return model.predict_proba(X)[:, index]


# ---------------------------------------------------------------------------
# Read exact RF configurations selected by nested LOPO
# ---------------------------------------------------------------------------


def load_outer_configurations(
    summary_path: Path,
    *,
    dataset_path: Path,
) -> dict[str, dict[str, Any]]:
    if not summary_path.is_file():
        raise FileNotFoundError(
            f"Nested-LOPO summary not found: {summary_path}"
        )

    summary = json.loads(
        summary_path.read_text(
            encoding="utf-8"
        )
    )

    expected_sha = summary.get(
        "dataset_sha256"
    )

    actual_sha = sha256(dataset_path)

    if expected_sha != actual_sha:
        raise ValueError(
            "Dataset SHA-256 does not match the dataset "
            "used during nested-LOPO evaluation"
        )

    configurations: dict[
        str,
        dict[str, Any],
    ] = {}

    for row in summary["outer_results"]:
        project = row["test_project"]

        configurations[project] = {
            "n_estimators": int(
                row["best_n_estimators"]
            ),
            "max_depth": (
                None
                if row["best_max_depth"] is None
                else int(row["best_max_depth"])
            ),
            "min_samples_leaf": int(
                row["best_min_samples_leaf"]
            ),
            "max_features": (
                row["best_max_features"]
            ),
            "class_weight": (
                row["best_class_weight"]
            ),
        }

    if set(configurations) != set(
        EXPECTED_PROJECTS
    ):
        raise ValueError(
            "Nested-LOPO summary does not contain "
            "all expected outer projects"
        )

    return configurations


# ---------------------------------------------------------------------------
# Out-of-project calibration data
# ---------------------------------------------------------------------------


def make_calibration_dataset(
    outer_train: pd.DataFrame,
    params: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray]:
    """Generate predictions only for projects excluded from RF training."""

    probabilities: list[np.ndarray] = []
    labels: list[np.ndarray] = []

    projects = sorted(
        outer_train[PROJECT_COLUMN].unique()
    )

    for calibration_project in projects:
        calibration_train = outer_train[
            outer_train[PROJECT_COLUMN]
            != calibration_project
        ]

        calibration_test = outer_train[
            outer_train[PROJECT_COLUMN]
            == calibration_project
        ]

        model = make_random_forest(
            params
        )

        model.fit(
            calibration_train[
                list(FEATURE_ORDER)
            ],
            calibration_train[
                TARGET_NAME
            ],
        )

        project_probabilities = (
            positive_probability(
                model,
                calibration_test[
                    list(FEATURE_ORDER)
                ],
            )
        )

        probabilities.append(
            project_probabilities
        )

        labels.append(
            calibration_test[
                TARGET_NAME
            ].to_numpy(dtype=int)
        )

    return (
        np.concatenate(probabilities),
        np.concatenate(labels),
    )


# ---------------------------------------------------------------------------
# Sigmoid probability calibration
# ---------------------------------------------------------------------------


def fit_sigmoid_calibrator(
    raw_probabilities: np.ndarray,
    labels: np.ndarray,
) -> LogisticRegression:
    """Fit P(defective | raw RF probability).

    No class weighting is used here. Calibration must learn the observed
    probability distribution rather than rebalance the target classes.
    """

    X = raw_probabilities.reshape(-1, 1)

    calibrator = LogisticRegression(
        C=1_000_000.0,
        solver="lbfgs",
        max_iter=2_000,
        random_state=RANDOM_STATE,
    )

    calibrator.fit(
        X,
        labels,
    )

    classes = list(
        calibrator.classes_
    )

    if classes != [0, 1]:
        raise RuntimeError(
            f"Unexpected calibrator classes: {classes}"
        )

    slope = float(
        calibrator.coef_[0, 0]
    )

    # We require an increasing calibration mapping. Otherwise a larger raw
    # RF risk would become a smaller calibrated defect probability.
    if slope <= 0:
        raise RuntimeError(
            "Sigmoid calibration produced a non-positive slope"
        )

    return calibrator


def apply_calibrator(
    calibrator: LogisticRegression,
    raw_probabilities: np.ndarray,
) -> np.ndarray:
    X = raw_probabilities.reshape(-1, 1)

    classes = list(
        calibrator.classes_
    )

    positive_index = classes.index(
        POSITIVE_CLASS
    )

    return calibrator.predict_proba(
        X
    )[:, positive_index]


# ---------------------------------------------------------------------------
# Outer evaluation
# ---------------------------------------------------------------------------


def evaluate_calibration(
    df: pd.DataFrame,
    configurations: dict[
        str,
        dict[str, Any],
    ],
) -> pd.DataFrame:
    results: list[dict[str, Any]] = []

    for index, test_project in enumerate(
        EXPECTED_PROJECTS,
        start=1,
    ):
        print()
        print("=" * 78)
        print(
            f"CALIBRATION [{index}/5] "
            f"outer test project: {test_project}"
        )
        print("=" * 78)

        outer_train = df[
            df[PROJECT_COLUMN]
            != test_project
        ].copy()

        outer_test = df[
            df[PROJECT_COLUMN]
            == test_project
        ].copy()

        params = configurations[
            test_project
        ]

        print(
            "RF parameters:"
        )
        print(
            json.dumps(
                params,
                indent=2,
            )
        )

        # ---------------------------------------------------------------
        # Create out-of-project probabilities using only outer training
        # projects. The outer test project is not involved.
        # ---------------------------------------------------------------

        calibration_scores, calibration_y = (
            make_calibration_dataset(
                outer_train,
                params,
            )
        )

        calibrator = (
            fit_sigmoid_calibrator(
                calibration_scores,
                calibration_y,
            )
        )

        slope = float(
            calibrator.coef_[0, 0]
        )
        intercept = float(
            calibrator.intercept_[0]
        )

        print(
            f"Calibrator: sigmoid("
            f"{slope:.4f} × RF_score "
            f"{intercept:+.4f})"
        )

        # ---------------------------------------------------------------
        # Train the actual outer RF on all four available projects.
        # ---------------------------------------------------------------

        model = make_random_forest(
            params
        )

        model.fit(
            outer_train[
                list(FEATURE_ORDER)
            ],
            outer_train[
                TARGET_NAME
            ],
        )

        raw_probabilities = (
            positive_probability(
                model,
                outer_test[
                    list(FEATURE_ORDER)
                ],
            )
        )

        calibrated_probabilities = (
            apply_calibrator(
                calibrator,
                raw_probabilities,
            )
        )

        y_true = outer_test[
            TARGET_NAME
        ].to_numpy(dtype=int)

        raw_roc = float(
            roc_auc_score(
                y_true,
                raw_probabilities,
            )
        )

        calibrated_roc = float(
            roc_auc_score(
                y_true,
                calibrated_probabilities,
            )
        )

        raw_pr = float(
            average_precision_score(
                y_true,
                raw_probabilities,
            )
        )

        calibrated_pr = float(
            average_precision_score(
                y_true,
                calibrated_probabilities,
            )
        )

        raw_brier = float(
            brier_score_loss(
                y_true,
                raw_probabilities,
            )
        )

        calibrated_brier = float(
            brier_score_loss(
                y_true,
                calibrated_probabilities,
            )
        )

        result = {
            "test_project": test_project,
            "n_test": len(outer_test),
            "defective": int(
                y_true.sum()
            ),
            "prevalence": float(
                y_true.mean()
            ),
            "raw_roc_auc": raw_roc,
            "calibrated_roc_auc": (
                calibrated_roc
            ),
            "raw_pr_auc": raw_pr,
            "calibrated_pr_auc": (
                calibrated_pr
            ),
            "raw_brier": raw_brier,
            "calibrated_brier": (
                calibrated_brier
            ),
            "brier_improvement": (
                raw_brier
                - calibrated_brier
            ),
            "calibration_slope": slope,
            "calibration_intercept": (
                intercept
            ),
        }

        results.append(result)

        print()
        print(
            f"Raw Brier:        "
            f"{raw_brier:.4f}"
        )

        print(
            f"Calibrated Brier: "
            f"{calibrated_brier:.4f}"
        )

        print(
            f"Improvement:      "
            f"{result['brier_improvement']:+.4f}"
        )

    return pd.DataFrame(results)


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def print_summary(
    results: pd.DataFrame,
) -> None:
    print()
    print("=" * 78)
    print(
        "PROJECT-AWARE SIGMOID CALIBRATION RESULTS"
    )
    print("=" * 78)

    columns = [
        "test_project",
        "prevalence",
        "raw_pr_auc",
        "calibrated_pr_auc",
        "raw_brier",
        "calibrated_brier",
        "brier_improvement",
    ]

    print(
        results[
            columns
        ].to_string(
            index=False,
            float_format=lambda value: (
                f"{value:.4f}"
            ),
        )
    )

    print()
    print("Macro performance")

    pairs = (
        (
            "ROC-AUC",
            "raw_roc_auc",
            "calibrated_roc_auc",
        ),
        (
            "PR-AUC",
            "raw_pr_auc",
            "calibrated_pr_auc",
        ),
        (
            "Brier",
            "raw_brier",
            "calibrated_brier",
        ),
    )

    for label, raw_column, calibrated_column in pairs:
        raw_mean = float(
            results[raw_column].mean()
        )

        calibrated_mean = float(
            results[
                calibrated_column
            ].mean()
        )

        print(
            f"  {label:<8} "
            f"raw={raw_mean:.4f}  "
            f"calibrated={calibrated_mean:.4f}"
        )

    mean_improvement = float(
        results[
            "brier_improvement"
        ].mean()
    )

    improved_projects = int(
        (
            results[
                "brier_improvement"
            ]
            > 0
        ).sum()
    )

    print()
    print(
        "Mean Brier improvement: "
        f"{mean_improvement:+.4f}"
    )

    print(
        "Projects with improved Brier: "
        f"{improved_projects}/"
        f"{len(results)}"
    )


def write_results(
    results: pd.DataFrame,
    *,
    dataset_sha256: str,
    output_dir: Path,
) -> None:
    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    csv_path = (
        output_dir
        / "risk_calibration_outer.csv"
    )

    json_path = (
        output_dir
        / "risk_calibration_summary.json"
    )

    results.to_csv(
        csv_path,
        index=False,
    )

    summary = {
        "model": "RandomForestClassifier",
        "calibration": (
            "project-aware sigmoid"
        ),
        "dataset_sha256": (
            dataset_sha256
        ),
        "target": TARGET_NAME,
        "positive_class": (
            POSITIVE_CLASS
        ),
        "feature_count": (
            len(FEATURE_ORDER)
        ),
        "macro": {
            "raw_roc_auc": float(
                results[
                    "raw_roc_auc"
                ].mean()
            ),
            "calibrated_roc_auc": float(
                results[
                    "calibrated_roc_auc"
                ].mean()
            ),
            "raw_pr_auc": float(
                results[
                    "raw_pr_auc"
                ].mean()
            ),
            "calibrated_pr_auc": float(
                results[
                    "calibrated_pr_auc"
                ].mean()
            ),
            "raw_brier": float(
                results[
                    "raw_brier"
                ].mean()
            ),
            "calibrated_brier": float(
                results[
                    "calibrated_brier"
                ].mean()
            ),
            "mean_brier_improvement": float(
                results[
                    "brier_improvement"
                ].mean()
            ),
        },
        "outer_results": (
            results.to_dict(
                orient="records"
            )
        ),
    }

    json_path.write_text(
        json.dumps(
            summary,
            indent=2,
            allow_nan=False,
        ),
        encoding="utf-8",
    )

    print()
    print("Saved:")
    print(f"  {csv_path}")
    print(f"  {json_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--dataset",
        type=Path,
        default=(
            Path(__file__).resolve().parents[2]
            / "data"
            / "processed"
            / "dambros_aeeem_ml2.csv"
        ),
    )

    parser.add_argument(
        "--nested-summary",
        type=Path,
        default=(
            Path(__file__).resolve().parents[2]
            / "evaluation"
            / "risk_nested_lopo_summary.json"
        ),
    )

    parser.add_argument(
        "--output-dir",
        type=Path,
        default=(
            Path(__file__).resolve().parents[2]
            / "evaluation"
        ),
    )

    args = parser.parse_args()

    print("=" * 78)
    print(
        "CodeSage ML-2 Project-Aware "
        "Sigmoid Calibration"
    )
    print("=" * 78)

    df = load_dataset(
        args.dataset
    )

    configurations = (
        load_outer_configurations(
            args.nested_summary,
            dataset_path=args.dataset,
        )
    )

    results = evaluate_calibration(
        df,
        configurations,
    )

    print_summary(
        results
    )

    write_results(
        results,
        dataset_sha256=sha256(
            args.dataset
        ),
        output_dir=args.output_dir,
    )


if __name__ == "__main__":
    main()