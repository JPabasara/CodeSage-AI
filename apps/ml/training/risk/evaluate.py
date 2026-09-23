"""Nested LOPO evaluation for the ML-2 Random Forest bug-proneness model.

The model predicts whether a Java class is defective using the canonical
21-feature ML-2 contract.

Hyperparameters are selected using project-aware inner leave-one-project-out
validation. Generalization is then measured on an untouched outer project.

No calibration is performed here. Calibration is evaluated separately after
the uncalibrated Random Forest baseline has been established.
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
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    roc_auc_score,
)
from sklearn.model_selection import ParameterGrid


# ---------------------------------------------------------------------------
# Import the production ML-2 feature contract.
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


# ---------------------------------------------------------------------------
# Dataset contract
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


# ---------------------------------------------------------------------------
# Random Forest search space
#
# This is the same 36-configuration search used in the nested-LOPO notebook.
# ---------------------------------------------------------------------------

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

RANDOM_STATE = 42


# ---------------------------------------------------------------------------
# Dataset loading / validation
# ---------------------------------------------------------------------------


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_dataset(
    path: Path,
) -> tuple[pd.DataFrame, str]:
    if not path.is_file():
        raise FileNotFoundError(
            f"Processed ML-2 dataset was not found at {path}"
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
            "Processed ML-2 dataset does not match the canonical schema"
        )

    if len(df) != EXPECTED_TOTAL_CLASSES:
        raise ValueError(
            f"Expected {EXPECTED_TOTAL_CLASSES:,} classes, "
            f"got {len(df):,}"
        )

    projects = tuple(
        sorted(df[PROJECT_COLUMN].unique())
    )

    if projects != tuple(sorted(EXPECTED_PROJECTS)):
        raise ValueError(
            f"Expected projects {sorted(EXPECTED_PROJECTS)}, "
            f"got {list(projects)}"
        )

    for project, expected_size in EXPECTED_PROJECT_SIZES.items():
        actual_size = int(
            (df[PROJECT_COLUMN] == project).sum()
        )

        if actual_size != expected_size:
            raise ValueError(
                f"{project}: expected {expected_size} classes, "
                f"got {actual_size}"
            )

    if df[
        [PROJECT_COLUMN, CLASS_COLUMN]
    ].duplicated().any():
        raise ValueError(
            "Dataset contains duplicate project/class identities"
        )

    if df.isna().any().any():
        raise ValueError(
            "Dataset contains missing values"
        )

    feature_values = df[
        list(FEATURE_ORDER)
    ].to_numpy(dtype=float)

    if not np.isfinite(feature_values).all():
        raise ValueError(
            "Dataset contains non-finite ML-2 feature values"
        )

    targets = set(
        int(value)
        for value in df[TARGET_NAME].unique()
    )

    if targets != {0, 1}:
        raise ValueError(
            f"ML-2 target must contain {{0, 1}}, got {targets}"
        )

    # Every project must independently contain both classes so that
    # ROC-AUC and PR-AUC are meaningful in every LOPO fold.
    for project in EXPECTED_PROJECTS:
        project_targets = set(
            int(value)
            for value in df.loc[
                df[PROJECT_COLUMN] == project,
                TARGET_NAME,
            ].unique()
        )

        if project_targets != {0, 1}:
            raise ValueError(
                f"{project}: target does not contain both classes"
            )

    return df, _sha256(path)


# ---------------------------------------------------------------------------
# Model helpers
# ---------------------------------------------------------------------------


def make_random_forest(
    params: dict[str, Any],
) -> RandomForestClassifier:
    return RandomForestClassifier(
        **params,
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )


def predict_positive_probability(
    model: RandomForestClassifier,
    features: pd.DataFrame,
) -> np.ndarray:
    """Return P(defective=1) without assuming probability column ordering."""

    class_labels = list(model.classes_)

    if POSITIVE_CLASS not in class_labels:
        raise RuntimeError(
            f"Random Forest does not contain positive class "
            f"{POSITIVE_CLASS}"
        )

    positive_index = class_labels.index(
        POSITIVE_CLASS
    )

    probabilities = model.predict_proba(
        features
    )

    return probabilities[:, positive_index]


# ---------------------------------------------------------------------------
# Inner LOPO
# ---------------------------------------------------------------------------


def evaluate_inner_lopo(
    training_df: pd.DataFrame,
    params: dict[str, Any],
) -> dict[str, float]:
    """Evaluate one RF configuration on the outer-training projects.

    One whole project is held out at a time.

    Hyperparameter selection is based only on mean inner PR-AUC.
    """

    project_results: list[dict[str, float]] = []

    inner_projects = sorted(
        training_df[PROJECT_COLUMN].unique()
    )

    for validation_project in inner_projects:
        inner_train = training_df[
            training_df[PROJECT_COLUMN]
            != validation_project
        ]

        inner_validation = training_df[
            training_df[PROJECT_COLUMN]
            == validation_project
        ]

        model = make_random_forest(params)

        model.fit(
            inner_train[list(FEATURE_ORDER)],
            inner_train[TARGET_NAME],
        )

        probabilities = (
            predict_positive_probability(
                model,
                inner_validation[
                    list(FEATURE_ORDER)
                ],
            )
        )

        y_true = inner_validation[TARGET_NAME]

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
                    result["pr_auc"]
                    for result in project_results
                ]
            )
        ),
        "mean_roc_auc": float(
            np.mean(
                [
                    result["roc_auc"]
                    for result in project_results
                ]
            )
        ),
        "mean_brier": float(
            np.mean(
                [
                    result["brier"]
                    for result in project_results
                ]
            )
        ),
    }


def select_best_parameters(
    training_df: pd.DataFrame,
    *,
    outer_test_project: str,
) -> tuple[
    dict[str, Any],
    pd.DataFrame,
]:
    """Select RF hyperparameters using inner project-aware LOPO."""

    combinations = list(
        ParameterGrid(PARAM_GRID)
    )

    search_results: list[dict[str, Any]] = []

    best_params: dict[str, Any] | None = None
    best_pr_auc = -np.inf

    for index, params in enumerate(
        combinations,
        start=1,
    ):
        print(
            f"    [{index:02d}/{len(combinations)}] "
            f"{params}",
            flush=True,
        )

        inner_metrics = evaluate_inner_lopo(
            training_df,
            params,
        )

        search_results.append(
            {
                "outer_test_project": (
                    outer_test_project
                ),
                **params,
                **inner_metrics,
            }
        )

        # Hyperparameter selection is deliberately based only
        # on mean PR-AUC across the inner projects.
        if inner_metrics["mean_pr_auc"] > best_pr_auc:
            best_pr_auc = (
                inner_metrics["mean_pr_auc"]
            )
            best_params = params.copy()

    if best_params is None:
        raise RuntimeError(
            "Random Forest hyperparameter search "
            "did not produce a configuration"
        )

    return (
        best_params,
        pd.DataFrame(search_results),
    )


# ---------------------------------------------------------------------------
# Outer LOPO
# ---------------------------------------------------------------------------


def run_nested_lopo(
    df: pd.DataFrame,
) -> tuple[
    pd.DataFrame,
    pd.DataFrame,
]:
    """Run complete nested leave-one-project-out evaluation."""

    outer_results: list[dict[str, Any]] = []
    tuning_frames: list[pd.DataFrame] = []

    outer_projects = sorted(
        df[PROJECT_COLUMN].unique()
    )

    for index, test_project in enumerate(
        outer_projects,
        start=1,
    ):
        print()
        print("=" * 78)
        print(
            f"OUTER [{index}/{len(outer_projects)}] "
            f"Held-out project: {test_project}"
        )
        print("=" * 78)

        outer_train = df[
            df[PROJECT_COLUMN] != test_project
        ].copy()

        outer_test = df[
            df[PROJECT_COLUMN] == test_project
        ].copy()

        print(
            f"Training classes: {len(outer_train):,}"
        )
        print(
            f"Test classes:     {len(outer_test):,}"
        )
        print()
        print(
            "Selecting RF hyperparameters "
            "using inner LOPO..."
        )

        best_params, tuning_results = (
            select_best_parameters(
                outer_train,
                outer_test_project=test_project,
            )
        )

        tuning_frames.append(
            tuning_results
        )

        print()
        print(
            "Selected parameters:"
        )
        print(
            json.dumps(
                best_params,
                indent=2,
            )
        )

        # -------------------------------------------------------------
        # Refit using every class from all four outer-training projects.
        # -------------------------------------------------------------

        model = make_random_forest(
            best_params
        )

        model.fit(
            outer_train[list(FEATURE_ORDER)],
            outer_train[TARGET_NAME],
        )

        # -------------------------------------------------------------
        # Only now evaluate on the untouched outer project.
        # -------------------------------------------------------------

        probabilities = (
            predict_positive_probability(
                model,
                outer_test[
                    list(FEATURE_ORDER)
                ],
            )
        )

        y_true = outer_test[TARGET_NAME]

        defective = int(
            y_true.sum()
        )

        total = len(outer_test)

        result = {
            "test_project": test_project,
            "n_train": len(outer_train),
            "n_test": total,
            "defective": defective,
            "prevalence": float(
                defective / total
            ),
            "roc_auc": float(
                roc_auc_score(
                    y_true,
                    probabilities,
                )
            ),
            "pr_auc": float(
                average_precision_score(
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
            "best_inner_pr_auc": float(
                tuning_results[
                    "mean_pr_auc"
                ].max()
            ),
            **{
                f"best_{key}": value
                for key, value
                in best_params.items()
            },
        }

        outer_results.append(result)

        print()
        print(
            "OUTER RESULT  "
            f"ROC-AUC={result['roc_auc']:.4f}  "
            f"PR-AUC={result['pr_auc']:.4f}  "
            f"Brier={result['brier']:.4f}"
        )

    return (
        pd.DataFrame(outer_results),
        pd.concat(
            tuning_frames,
            ignore_index=True,
        ),
    )


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def build_summary(
    results: pd.DataFrame,
    *,
    dataset_sha256: str,
) -> dict[str, Any]:
    metrics = (
        "roc_auc",
        "pr_auc",
        "brier",
    )

    summary_metrics = {}

    for metric in metrics:
        summary_metrics[metric] = {
            "mean": float(
                results[metric].mean()
            ),
            "std": float(
                results[metric].std()
            ),
        }

    return {
        "model": "RandomForestClassifier",
        "evaluation_protocol": (
            "nested_leave_one_project_out"
        ),
        "selection_metric": (
            "macro_inner_pr_auc"
        ),
        "feature_count": len(FEATURE_ORDER),
        "target": TARGET_NAME,
        "positive_class": POSITIVE_CLASS,
        "projects": list(EXPECTED_PROJECTS),
        "classes": EXPECTED_TOTAL_CLASSES,
        "dataset_sha256": dataset_sha256,
        "parameter_grid": PARAM_GRID,
        "metrics": summary_metrics,
        "outer_results": (
            results.to_dict(
                orient="records"
            )
        ),
    }


def print_summary(
    results: pd.DataFrame,
) -> None:
    print()
    print("=" * 78)
    print("NESTED LOPO RANDOM FOREST RESULTS")
    print("=" * 78)

    display_columns = [
        "test_project",
        "n_test",
        "defective",
        "prevalence",
        "roc_auc",
        "pr_auc",
        "brier",
        "best_max_depth",
        "best_min_samples_leaf",
        "best_max_features",
        "best_class_weight",
    ]

    print(
        results[
            display_columns
        ].to_string(
            index=False,
            float_format=lambda value: (
                f"{value:.4f}"
            ),
        )
    )

    print()
    print("Macro performance")

    for metric in (
        "roc_auc",
        "pr_auc",
        "brier",
    ):
        mean = results[metric].mean()
        std = results[metric].std()

        print(
            f"  {metric:<8} "
            f"{mean:.4f} ± {std:.4f}"
        )


def write_results(
    outer_results: pd.DataFrame,
    tuning_results: pd.DataFrame,
    summary: dict[str, Any],
    output_dir: Path,
) -> None:
    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    outer_path = (
        output_dir
        / "risk_nested_lopo_outer.csv"
    )

    tuning_path = (
        output_dir
        / "risk_nested_lopo_tuning.csv"
    )

    summary_path = (
        output_dir
        / "risk_nested_lopo_summary.json"
    )

    outer_results.to_csv(
        outer_path,
        index=False,
    )

    tuning_results.to_csv(
        tuning_path,
        index=False,
    )

    summary_path.write_text(
        json.dumps(
            summary,
            indent=2,
            allow_nan=False,
        ),
        encoding="utf-8",
    )

    print()
    print("Saved evaluation outputs:")
    print(f"  {outer_path}")
    print(f"  {tuning_path}")
    print(f"  {summary_path}")


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
        "CodeSage ML-2 Random Forest "
        "Nested LOPO Evaluation"
    )
    print("=" * 78)

    df, dataset_sha256 = load_dataset(
        args.dataset
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
    print(
        f"Defective: "
        f"{int(df[TARGET_NAME].sum()):,}"
    )
    print(
        f"RF configurations per outer fold: "
        f"{len(list(ParameterGrid(PARAM_GRID)))}"
    )

    outer_results, tuning_results = (
        run_nested_lopo(df)
    )

    summary = build_summary(
        outer_results,
        dataset_sha256=dataset_sha256,
    )

    print_summary(
        outer_results
    )

    write_results(
        outer_results,
        tuning_results,
        summary,
        args.output_dir,
    )


if __name__ == "__main__":
    main()