"""Train the final CodeSage ML-2 bug-proneness artifact.

The model architecture is:

    21 canonical features
        -> Random Forest
        -> project-aware sigmoid probability calibration

Model evaluation is performed separately. This script uses all five projects
only after the nested-LOPO evaluation has been completed.

Final RF hyperparameters are selected using project-aware LOPO across the full
training dataset. The sigmoid calibrator is fitted only on out-of-project RF
predictions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    roc_auc_score,
)
from sklearn.model_selection import ParameterGrid


# ---------------------------------------------------------------------------
# Production imports
# ---------------------------------------------------------------------------

current_dir = Path(__file__).resolve().parent
ml_src = current_dir.parent.parent / "src"

if str(ml_src) not in sys.path:
    sys.path.insert(0, str(ml_src))


from codesage_ml.risk.features import (  # noqa: E402
    FEATURE_ORDER,
    NEGATIVE_CLASS,
    POSITIVE_CLASS,
    TARGET_NAME,
)
from codesage_ml.risk.model import (  # noqa: E402
    SigmoidCalibratedRiskModel,
)


# ---------------------------------------------------------------------------
# Training contract
# ---------------------------------------------------------------------------

PROJECT_COLUMN = "project_name"
CLASS_COLUMN = "class_name"

EXPECTED_PROJECTS = (
    "eclipse",
    "equinox",
    "lucene",
    "mylyn",
    "pde",
)

EXPECTED_PROJECT_SIZES = {
    "eclipse": 997,
    "equinox": 324,
    "lucene": 691,
    "mylyn": 1862,
    "pde": 1497,
}

EXPECTED_TOTAL_CLASSES = 5_371

RANDOM_STATE = 42


# Must remain identical to the grid used by evaluate.py.
PARAM_GRID = {
    "n_estimators": [200],
    "max_depth": [None, 10, 20],
    "min_samples_leaf": [1, 3, 5],
    "max_features": ["sqrt", 0.5],
    "class_weight": [
        "balanced",
        "balanced_subsample",
    ],
}


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


def sha256(path: Path) -> str:
    return hashlib.sha256(
        path.read_bytes()
    ).hexdigest()


def load_dataset(
    path: Path,
) -> tuple[pd.DataFrame, str]:
    if not path.is_file():
        raise FileNotFoundError(
            f"ML-2 dataset was not found: {path}"
        )

    df = pd.read_csv(path)

    expected_columns = [
        PROJECT_COLUMN,
        CLASS_COLUMN,
        *FEATURE_ORDER,
        TARGET_NAME,
    ]

    if list(df.columns) != expected_columns:
        raise ValueError(
            "ML-2 training dataset does not match "
            "the canonical schema"
        )

    if len(df) != EXPECTED_TOTAL_CLASSES:
        raise ValueError(
            f"Expected {EXPECTED_TOTAL_CLASSES:,} classes, "
            f"got {len(df):,}"
        )

    projects = tuple(
        sorted(
            df[PROJECT_COLUMN].unique()
        )
    )

    if projects != tuple(
        sorted(EXPECTED_PROJECTS)
    ):
        raise ValueError(
            f"Unexpected project set: {projects}"
        )

    for project, expected_size in (
        EXPECTED_PROJECT_SIZES.items()
    ):
        actual = int(
            (
                df[PROJECT_COLUMN]
                == project
            ).sum()
        )

        if actual != expected_size:
            raise ValueError(
                f"{project}: expected "
                f"{expected_size} classes, "
                f"got {actual}"
            )

    if df[
        [PROJECT_COLUMN, CLASS_COLUMN]
    ].duplicated().any():
        raise ValueError(
            "Dataset contains duplicate "
            "project/class identities"
        )

    if df.isna().any().any():
        raise ValueError(
            "Dataset contains missing values"
        )

    X = df[
        list(FEATURE_ORDER)
    ].to_numpy(dtype=float)

    if not np.isfinite(X).all():
        raise ValueError(
            "Dataset contains non-finite feature values"
        )

    targets = {
        int(value)
        for value
        in df[TARGET_NAME].unique()
    }

    if targets != {
        NEGATIVE_CLASS,
        POSITIVE_CLASS,
    }:
        raise ValueError(
            f"Unexpected target classes: {targets}"
        )

    return df, sha256(path)


# ---------------------------------------------------------------------------
# Evaluation evidence
# ---------------------------------------------------------------------------


def load_json(
    path: Path,
) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(
            f"Required evaluation report not found: {path}"
        )

    return json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )


def verify_evaluation_evidence(
    *,
    dataset_sha256: str,
    nested_summary: dict[str, Any],
    calibration_summary: dict[str, Any],
) -> None:
    if (
        nested_summary.get("dataset_sha256")
        != dataset_sha256
    ):
        raise ValueError(
            "Nested-LOPO evaluation used a different dataset"
        )

    if (
        calibration_summary.get(
            "dataset_sha256"
        )
        != dataset_sha256
    ):
        raise ValueError(
            "Calibration evaluation used a different dataset"
        )

    evaluated_grid = nested_summary.get(
        "parameter_grid"
    )

    if evaluated_grid != PARAM_GRID:
        raise ValueError(
            "Training parameter grid differs from "
            "the evaluated RF parameter grid"
        )


# ---------------------------------------------------------------------------
# Random Forest helpers
# ---------------------------------------------------------------------------


def make_random_forest(
    params: dict[str, Any],
    *,
    n_jobs: int = -1,
) -> RandomForestClassifier:
    return RandomForestClassifier(
        **params,
        random_state=RANDOM_STATE,
        n_jobs=n_jobs,
    )


def positive_probability(
    model: RandomForestClassifier,
    X: np.ndarray,
) -> np.ndarray:
    classes = list(
        model.classes_
    )

    if set(classes) != {
        NEGATIVE_CLASS,
        POSITIVE_CLASS,
    }:
        raise RuntimeError(
            f"Unexpected RF classes: {classes}"
        )

    positive_index = classes.index(
        POSITIVE_CLASS
    )

    return np.asarray(
        model.predict_proba(X),
        dtype=float,
    )[:, positive_index]


# ---------------------------------------------------------------------------
# Final hyperparameter selection
# ---------------------------------------------------------------------------


def evaluate_configuration_lopo(
    df: pd.DataFrame,
    params: dict[str, Any],
) -> dict[str, float]:
    project_results: list[
        dict[str, float]
    ] = []

    for validation_project in (
        EXPECTED_PROJECTS
    ):
        train_df = df[
            df[PROJECT_COLUMN]
            != validation_project
        ]

        validation_df = df[
            df[PROJECT_COLUMN]
            == validation_project
        ]

        model = make_random_forest(
            params
        )

        model.fit(
            train_df[
                list(FEATURE_ORDER)
            ].to_numpy(dtype=float),
            train_df[
                TARGET_NAME
            ].to_numpy(dtype=int),
        )

        probabilities = positive_probability(
            model,
            validation_df[
                list(FEATURE_ORDER)
            ].to_numpy(dtype=float),
        )

        y_true = validation_df[
            TARGET_NAME
        ].to_numpy(dtype=int)

        project_results.append(
            {
                "pr_auc": float(
                    average_precision_score(
                        y_true,
                        probabilities,
                    )
                ),
                "roc_auc": float(
                    roc_auc_score(
                        y_true,
                        probabilities,
                    )
                ),
                "brier": float(
                    brier_score_loss(
                        y_true,
                        probabilities,
                    )
                ),
            }
        )

    return {
        "mean_pr_auc": float(
            np.mean(
                [
                    row["pr_auc"]
                    for row
                    in project_results
                ]
            )
        ),
        "mean_roc_auc": float(
            np.mean(
                [
                    row["roc_auc"]
                    for row
                    in project_results
                ]
            )
        ),
        "mean_brier": float(
            np.mean(
                [
                    row["brier"]
                    for row
                    in project_results
                ]
            )
        ),
    }


def select_final_parameters(
    df: pd.DataFrame,
) -> tuple[
    dict[str, Any],
    list[dict[str, Any]],
]:
    combinations = list(
        ParameterGrid(PARAM_GRID)
    )

    results: list[
        dict[str, Any]
    ] = []

    best_params: (
        dict[str, Any] | None
    ) = None

    best_pr_auc = -np.inf

    print()
    print("=" * 78)
    print(
        "FINAL PROJECT-AWARE RF "
        "HYPERPARAMETER SELECTION"
    )
    print("=" * 78)

    for index, params in enumerate(
        combinations,
        start=1,
    ):
        print(
            f"[{index:02d}/"
            f"{len(combinations)}] "
            f"{params}",
            flush=True,
        )

        metrics = (
            evaluate_configuration_lopo(
                df,
                params,
            )
        )

        row = {
            **params,
            **metrics,
        }

        results.append(row)

        if (
            metrics["mean_pr_auc"]
            > best_pr_auc
        ):
            best_pr_auc = (
                metrics["mean_pr_auc"]
            )
            best_params = params.copy()

    if best_params is None:
        raise RuntimeError(
            "No RF configuration was selected"
        )

    print()
    print("Selected final RF parameters:")
    print(
        json.dumps(
            best_params,
            indent=2,
        )
    )

    print(
        "Selection LOPO mean PR-AUC: "
        f"{best_pr_auc:.4f}"
    )

    return best_params, results


# ---------------------------------------------------------------------------
# Project-aware calibration
# ---------------------------------------------------------------------------


def generate_out_of_project_predictions(
    df: pd.DataFrame,
    params: dict[str, Any],
) -> tuple[
    np.ndarray,
    np.ndarray,
]:
    probabilities: list[
        np.ndarray
    ] = []

    labels: list[
        np.ndarray
    ] = []

    print()
    print(
        "Generating out-of-project "
        "probabilities for calibration..."
    )

    for project in EXPECTED_PROJECTS:
        train_df = df[
            df[PROJECT_COLUMN]
            != project
        ]

        held_out_df = df[
            df[PROJECT_COLUMN]
            == project
        ]

        print(
            f"  train without {project:<8} "
            f"→ predict {len(held_out_df):,} classes"
        )

        model = make_random_forest(
            params
        )

        model.fit(
            train_df[
                list(FEATURE_ORDER)
            ].to_numpy(dtype=float),
            train_df[
                TARGET_NAME
            ].to_numpy(dtype=int),
        )

        probabilities.append(
            positive_probability(
                model,
                held_out_df[
                    list(FEATURE_ORDER)
                ].to_numpy(dtype=float),
            )
        )

        labels.append(
            held_out_df[
                TARGET_NAME
            ].to_numpy(dtype=int)
        )

    return (
        np.concatenate(
            probabilities
        ),
        np.concatenate(
            labels
        ),
    )


def fit_sigmoid_calibrator(
    raw_probabilities: np.ndarray,
    labels: np.ndarray,
) -> LogisticRegression:
    calibrator = LogisticRegression(
        C=1_000_000.0,
        solver="lbfgs",
        max_iter=2_000,
        random_state=RANDOM_STATE,
    )

    calibrator.fit(
        raw_probabilities.reshape(
            -1,
            1,
        ),
        labels,
    )

    classes = set(
        int(value)
        for value
        in calibrator.classes_
    )

    if classes != {
        NEGATIVE_CLASS,
        POSITIVE_CLASS,
    }:
        raise RuntimeError(
            "Calibrator has unexpected classes"
        )

    slope = float(
        calibrator.coef_[0, 0]
    )

    if slope <= 0:
        raise RuntimeError(
            "Sigmoid calibrator produced "
            "a non-positive slope"
        )

    return calibrator


def calibrated_positive_probability(
    calibrator: LogisticRegression,
    raw_probabilities: np.ndarray,
) -> np.ndarray:
    classes = list(
        calibrator.classes_
    )

    positive_index = classes.index(
        POSITIVE_CLASS
    )

    return np.asarray(
        calibrator.predict_proba(
            raw_probabilities.reshape(
                -1,
                1,
            )
        ),
        dtype=float,
    )[:, positive_index]


# ---------------------------------------------------------------------------
# Final production model
# ---------------------------------------------------------------------------


def train_production_model(
    df: pd.DataFrame,
    params: dict[str, Any],
    calibrator: LogisticRegression,
) -> SigmoidCalibratedRiskModel:
    X = df[
        list(FEATURE_ORDER)
    ].to_numpy(dtype=float)

    y = df[
        TARGET_NAME
    ].to_numpy(dtype=int)

    print()
    print(
        f"Training final RF on all "
        f"{len(df):,} classes..."
    )

    base_model = make_random_forest(
        params
    )

    base_model.fit(
        X,
        y,
    )

    # Training can use all CPU cores, but a deployed inference request
    # should not consume the entire worker host.
    base_model.set_params(
        n_jobs=1
    )

    return SigmoidCalibratedRiskModel(
        base_model=base_model,
        calibrator=calibrator,
    )


# ---------------------------------------------------------------------------
# Artifact export
# ---------------------------------------------------------------------------


def validate_round_trip(
    artifact_path: Path,
    df: pd.DataFrame,
) -> None:
    loaded = joblib.load(
        artifact_path
    )

    if not isinstance(
        loaded,
        dict,
    ):
        raise RuntimeError(
            "Exported artifact is not a dictionary"
        )

    model = loaded["pipeline"]

    X = df[
        list(FEATURE_ORDER)
    ].head(10).to_numpy(
        dtype=float
    )

    probabilities = np.asarray(
        model.predict_proba(X),
        dtype=float,
    )

    if probabilities.shape != (
        len(X),
        2,
    ):
        raise RuntimeError(
            "Exported model returned "
            "an invalid probability shape"
        )

    if not np.isfinite(
        probabilities
    ).all():
        raise RuntimeError(
            "Exported model returned "
            "non-finite probabilities"
        )

    if (
        (probabilities < 0)
        | (probabilities > 1)
    ).any():
        raise RuntimeError(
            "Exported model returned "
            "probabilities outside [0, 1]"
        )

    if not np.allclose(
        probabilities.sum(axis=1),
        1.0,
    ):
        raise RuntimeError(
            "Exported probabilities "
            "do not sum to 1"
        )

    if set(
        int(value)
        for value
        in model.classes_
    ) != {
        NEGATIVE_CLASS,
        POSITIVE_CLASS,
    }:
        raise RuntimeError(
            "Exported model has "
            "unexpected classes"
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--dataset",
        type=Path,
        default=(
            Path(__file__).resolve()
            .parents[2]
            / "data"
            / "processed"
            / "dambros_aeeem_ml2.csv"
        ),
    )

    parser.add_argument(
        "--nested-summary",
        type=Path,
        default=(
            Path(__file__).resolve()
            .parents[2]
            / "evaluation"
            / "risk_nested_lopo_summary.json"
        ),
    )

    parser.add_argument(
        "--calibration-summary",
        type=Path,
        default=(
            Path(__file__).resolve()
            .parents[2]
            / "evaluation"
            / "risk_calibration_summary.json"
        ),
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=(
            Path(__file__).resolve()
            .parents[2]
            / "models"
            / "risk_v2.joblib"
        ),
    )

    parser.add_argument(
        "--report",
        type=Path,
        default=(
            Path(__file__).resolve()
            .parents[2]
            / "evaluation"
            / "risk_final_training_summary.json"
        ),
    )

    parser.add_argument(
        "--version",
        default="risk-2.0.0",
    )

    args = parser.parse_args()

    print("=" * 78)
    print(
        "CodeSage ML-2 Final Production Training"
    )
    print("=" * 78)

    df, dataset_sha256 = (
        load_dataset(
            args.dataset
        )
    )

    nested_summary = load_json(
        args.nested_summary
    )

    calibration_summary = load_json(
        args.calibration_summary
    )

    verify_evaluation_evidence(
        dataset_sha256=dataset_sha256,
        nested_summary=nested_summary,
        calibration_summary=(
            calibration_summary
        ),
    )

    print(
        f"Dataset: {args.dataset}"
    )
    print(
        f"SHA-256: {dataset_sha256}"
    )
    print(
        f"Classes: {len(df):,}"
    )
    print(
        f"Features: {len(FEATURE_ORDER)}"
    )

    # ---------------------------------------------------------------
    # 1. Select one final RF configuration using all five projects.
    # ---------------------------------------------------------------

    best_params, selection_results = (
        select_final_parameters(df)
    )

    # ---------------------------------------------------------------
    # 2. Generate strictly out-of-project probabilities.
    # ---------------------------------------------------------------

    raw_oop, oop_labels = (
        generate_out_of_project_predictions(
            df,
            best_params,
        )
    )

    # ---------------------------------------------------------------
    # 3. Fit one production sigmoid calibrator.
    # ---------------------------------------------------------------

    calibrator = (
        fit_sigmoid_calibrator(
            raw_oop,
            oop_labels,
        )
    )

    calibrated_oop = (
        calibrated_positive_probability(
            calibrator,
            raw_oop,
        )
    )

    raw_oop_brier = float(
        brier_score_loss(
            oop_labels,
            raw_oop,
        )
    )

    calibrated_oop_brier = float(
        brier_score_loss(
            oop_labels,
            calibrated_oop,
        )
    )

    print()
    print(
        "Production calibration fit:"
    )
    print(
        "  slope:     "
        f"{float(calibrator.coef_[0, 0]):.6f}"
    )
    print(
        "  intercept: "
        f"{float(calibrator.intercept_[0]):.6f}"
    )
    print(
        "  OOP raw Brier:        "
        f"{raw_oop_brier:.4f}"
    )
    print(
        "  OOP calibrated Brier: "
        f"{calibrated_oop_brier:.4f}"
    )

    # ---------------------------------------------------------------
    # 4. Train RF once on all five projects.
    # ---------------------------------------------------------------

    model = train_production_model(
        df,
        best_params,
        calibrator,
    )

    # ---------------------------------------------------------------
    # 5. Export self-describing artifact.
    # ---------------------------------------------------------------

    trained_at = (
        datetime.now(UTC).isoformat()
    )

    nested_metrics = (
        nested_summary["metrics"]
    )

    calibration_metrics = (
        calibration_summary["macro"]
    )

    metadata = {
        "unit": "java_class",
        "target": TARGET_NAME,
        "target_definition": (
            "defective = 1 when bugs > 0"
        ),
        "negative_class": NEGATIVE_CLASS,
        "positive_class": POSITIVE_CLASS,
        "dataset": "D'Ambros/AEEEM",
        "projects": list(
            EXPECTED_PROJECTS
        ),
        "training_instances": len(df),
        "dataset_sha256": (
            dataset_sha256
        ),
        "trained_at": trained_at,
        "sklearn_version": (
            sklearn.__version__
        ),
        "estimator": (
            "RandomForestClassifier"
        ),
        "selected_hyperparameters": (
            best_params
        ),
        "final_parameter_selection": (
            "project-aware LOPO across all five "
            "training projects; macro PR-AUC"
        ),
        "calibration": (
            "sigmoid fitted on out-of-project "
            "RF probabilities"
        ),
        "calibration_slope": float(
            calibrator.coef_[0, 0]
        ),
        "calibration_intercept": float(
            calibrator.intercept_[0]
        ),
        "production_oop_raw_brier": (
            raw_oop_brier
        ),
        "production_oop_calibrated_brier": (
            calibrated_oop_brier
        ),
        "evaluation_protocol": (
            "nested_leave_one_project_out"
        ),
        "evaluation_metrics": {
            "roc_auc": (
                nested_metrics[
                    "roc_auc"
                ]
            ),
            "pr_auc": (
                nested_metrics[
                    "pr_auc"
                ]
            ),
            "raw_brier": (
                calibration_metrics[
                    "raw_brier"
                ]
            ),
            "calibrated_brier": (
                calibration_metrics[
                    "calibrated_brier"
                ]
            ),
        },
    }

    artifact = {
        "version": args.version,
        "feature_order": list(
            FEATURE_ORDER
        ),
        "pipeline": model,
        "metadata": metadata,
    }

    args.output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    joblib.dump(
        artifact,
        args.output,
    )

    # ---------------------------------------------------------------
    # 6. Ensure the exact artifact can be loaded back and used.
    # ---------------------------------------------------------------

    validate_round_trip(
        args.output,
        df,
    )

    artifact_sha256 = sha256(
        args.output
    )

    # ---------------------------------------------------------------
    # 7. Save a human-readable final-training report.
    # ---------------------------------------------------------------

    args.report.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    report = {
        "artifact_version": (
            args.version
        ),
        "artifact_path": str(
            args.output
        ),
        "artifact_sha256": (
            artifact_sha256
        ),
        "dataset_sha256": (
            dataset_sha256
        ),
        "selected_hyperparameters": (
            best_params
        ),
        "parameter_selection_results": (
            selection_results
        ),
        "metadata": metadata,
    }

    args.report.write_text(
        json.dumps(
            report,
            indent=2,
            allow_nan=False,
        ),
        encoding="utf-8",
    )

    print()
    print("=" * 78)
    print(
        "PRODUCTION ARTIFACT CREATED"
    )
    print("=" * 78)
    print(
        f"Artifact: {args.output}"
    )
    print(
        f"Version:  {args.version}"
    )
    print(
        f"SHA-256:  {artifact_sha256}"
    )
    print(
        f"Report:   {args.report}"
    )


if __name__ == "__main__":
    main()