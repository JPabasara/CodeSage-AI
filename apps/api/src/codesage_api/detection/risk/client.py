"""ML-2 client: class-level metrics in, per-file bug-risk score out.

The ML model predicts bug-proneness for individual Java classes using
class-specific CK metrics and file-level process metrics.

Class probabilities are aggregated into one file-level probability before
being returned to the scan pipeline.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from math import prod

import httpx

from codesage_api.config import get_settings
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.ck_metrics import ClassMetrics
from codesage_api.extractors.process_metrics import FileProcessMetrics


@dataclass(frozen=True, slots=True)
class RiskClientResult:
    # Final file-level probabilities consumed by the scan/scoring pipeline.
    scores: dict[str, float]

    model_version: str


# These names form the wire contract between the API and ML service.
#
# They intentionally match the D'Ambros/AEEEM training feature names.
RISK_FEATURES = (
    # Class-level CK metrics
    "wmc",
    "cbo",
    "dit",
    "lcom",
    "rfc",
    "noc",
    "numberOfLinesOfCode",
    "numberOfMethods",

    # File-level process metrics
    "numberOfVersionsUntil",
    "numberOfAuthorsUntil",
    "linesAddedUntil",
    "maxLinesAddedUntil",
    "avgLinesAddedUntil",
    "linesRemovedUntil",
    "maxLinesRemovedUntil",
    "avgLinesRemovedUntil",
    "codeChurnUntil",
    "maxCodeChurnUntil",
    "avgCodeChurnUntil",
    "ageWithRespectTo",
    "weightedAgeWithRespectTo",
)


def _is_ml_eligible_class(metrics: ClassMetrics) -> bool:
    """
    Return whether a CK class row is eligible for ML-2 prediction.

    D'Ambros-style prediction operates on classes rather than CK's synthetic
    inner/anonymous entities. For v1 we predict ordinary top-level classes.
    """
    return metrics.class_type.lower() == "class"


def _build_metrics(
    class_metrics: ClassMetrics,
    process_metrics: FileProcessMetrics | None,
) -> dict[str, float]:
    """
    Build one class-level ML-2 observation.

    CK features vary by class. Process features describe the containing file
    and are therefore intentionally shared by all classes in that file.
    """
    metrics = dict.fromkeys(RISK_FEATURES, 0.0)

    # -------------------------------------------------------------
    # Class-level CK metrics
    # -------------------------------------------------------------

    metrics["wmc"] = float(class_metrics.wmc)
    metrics["cbo"] = float(class_metrics.cbo)
    metrics["dit"] = float(class_metrics.dit)
    metrics["lcom"] = float(class_metrics.lcom)
    metrics["rfc"] = float(class_metrics.rfc)
    metrics["noc"] = float(class_metrics.noc)

    metrics["numberOfLinesOfCode"] = float(
        class_metrics.number_of_lines_of_code
    )
    metrics["numberOfMethods"] = float(
        class_metrics.number_of_methods
    )

    # -------------------------------------------------------------
    # File-level process metrics
    # -------------------------------------------------------------

    if process_metrics is not None:
        metrics["numberOfVersionsUntil"] = float(
            process_metrics.number_of_versions_until
        )
        metrics["numberOfAuthorsUntil"] = float(
            process_metrics.number_of_authors_until
        )

        metrics["linesAddedUntil"] = float(
            process_metrics.lines_added_until
        )
        metrics["maxLinesAddedUntil"] = float(
            process_metrics.max_lines_added_until
        )
        metrics["avgLinesAddedUntil"] = float(
            process_metrics.avg_lines_added_until
        )

        metrics["linesRemovedUntil"] = float(
            process_metrics.lines_removed_until
        )
        metrics["maxLinesRemovedUntil"] = float(
            process_metrics.max_lines_removed_until
        )
        metrics["avgLinesRemovedUntil"] = float(
            process_metrics.avg_lines_removed_until
        )

        metrics["codeChurnUntil"] = float(
            process_metrics.code_churn_until
        )
        metrics["maxCodeChurnUntil"] = float(
            process_metrics.max_code_churn_until
        )
        metrics["avgCodeChurnUntil"] = float(
            process_metrics.avg_code_churn_until
        )

        metrics["ageWithRespectTo"] = float(
            process_metrics.age_with_respect_to
        )
        metrics["weightedAgeWithRespectTo"] = float(
            process_metrics.weighted_age_with_respect_to
        )

    return metrics


def _aggregate_file_scores(
    class_scores: dict[str, list[float]],
) -> dict[str, float]:
    """
    Aggregate class probabilities into one file-level probability.

    Uses noisy-OR:

        P(file defective) = 1 - Π(1 - P(class defective))

    For a file containing one predicted class, its file probability is
    therefore exactly that class probability.
    """
    return {
        path: 1.0 - prod(1.0 - score for score in scores)
        for path, scores in class_scores.items()
        if scores
    }


def predict(
    classes: list[ClassMetrics],
    process: dict[str, FileProcessMetrics],
) -> RiskClientResult:
    """
    Batch-predict class-level bug-proneness and return per-file risk.

    Each ML observation represents one Java class.

    File-level process metrics are joined to each class using the class's
    source-file path. The returned class probabilities are then aggregated
    into one probability per file.
    """
    eligible_classes = [
        metrics
        for metrics in classes
        if _is_ml_eligible_class(metrics)
    ]

    if not eligible_classes:
        return RiskClientResult(
            scores={},
            model_version="",
        )

    settings = get_settings()
    url = f"{settings.ml_service_url.rstrip('/')}/risk"

    # A class identity must be unique within the request.
    expected_classes: set[tuple[str, str]] = set()

    payload_classes = []

    for class_metrics in sorted(
        eligible_classes,
        key=lambda item: (item.path, item.class_name),
    ):
        identity = (
            class_metrics.path,
            class_metrics.class_name,
        )

        if identity in expected_classes:
            raise MLServiceUnavailable(
                "Duplicate ML-2 class identity encountered: "
                f"{class_metrics.path}:{class_metrics.class_name}"
            )

        expected_classes.add(identity)

        process_metrics = process.get(
            class_metrics.path
        )

        payload_classes.append(
            {
                "path": class_metrics.path,
                "class_name": class_metrics.class_name,
                "metrics": _build_metrics(
                    class_metrics,
                    process_metrics,
                ),
            }
        )

    payload = {
        "classes": payload_classes,
    }

    try:
        response = httpx.post(
            url,
            json=payload,
            timeout=settings.ml_timeout_seconds,
        )

        response.raise_for_status()
        data = response.json()

        model_version = data.get("model_version")
        raw_scores = data.get("scores")

        if (
            not isinstance(model_version, str)
            or not model_version.strip()
        ):
            raise ValueError(
                "Risk response is missing model_version"
            )

        if not isinstance(raw_scores, list):
            raise TypeError(
                "Risk response scores must be a list"
            )

        received_classes: set[tuple[str, str]] = set()

        class_scores_by_file: dict[
            str,
            list[float],
        ] = defaultdict(list)

        for item in raw_scores:
            path = str(item["path"])
            class_name = str(item["class_name"])

            identity = (
                path,
                class_name,
            )

            if identity not in expected_classes:
                raise ValueError(
                    "Risk response contains unexpected class "
                    f"{path}:{class_name}"
                )

            if identity in received_classes:
                raise ValueError(
                    "Risk response contains duplicate class "
                    f"{path}:{class_name}"
                )

            score = float(item["risk_score"])

            if not 0.0 <= score <= 1.0:
                raise ValueError(
                    f"Risk score {score} out of bounds "
                    "[0.0, 1.0]"
                )

            received_classes.add(identity)

            class_scores_by_file[path].append(
                score
            )

        missing_classes = (
            expected_classes - received_classes
        )

        if missing_classes:
            formatted = ", ".join(
                f"{path}:{class_name}"
                for path, class_name
                in sorted(missing_classes)
            )

            raise ValueError(
                "Risk response is missing classes: "
                f"{formatted}"
            )

        file_scores = _aggregate_file_scores(
            class_scores_by_file
        )

        return RiskClientResult(
            scores=file_scores,
            model_version=model_version.strip(),
        )

    except MLServiceUnavailable:
        raise

    except Exception as exc:
        raise MLServiceUnavailable(
            "Failed to communicate with ML risk service: "
            f"{exc}"
        ) from exc