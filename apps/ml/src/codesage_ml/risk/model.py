"""Runtime model composition for ML-2 bug-proneness prediction."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from codesage_ml.risk.features import (
    NEGATIVE_CLASS,
    POSITIVE_CLASS,
)


@dataclass(slots=True)
class SigmoidCalibratedRiskModel:
    """Random Forest followed by a learned sigmoid probability calibrator.

    The base model produces the raw probability of the positive class.
    The calibrator maps that raw probability to the final defect probability.

    Both components are trained offline. Runtime inference only performs
    prediction.
    """

    base_model: Any
    calibrator: Any

    @property
    def classes_(self) -> np.ndarray:
        return np.asarray(
            [NEGATIVE_CLASS, POSITIVE_CLASS]
        )

    def predict_proba(
        self,
        features: Any,
    ) -> np.ndarray:
        base_classes = list(
            self.base_model.classes_
        )

        if set(base_classes) != {
            NEGATIVE_CLASS,
            POSITIVE_CLASS,
        }:
            raise RuntimeError(
                "ML-2 base model has unexpected class labels"
            )

        positive_index = base_classes.index(
            POSITIVE_CLASS
        )

        raw_probabilities = np.asarray(
            self.base_model.predict_proba(features),
            dtype=float,
        )[:, positive_index]

        calibration_classes = list(
            self.calibrator.classes_
        )

        if set(calibration_classes) != {
            NEGATIVE_CLASS,
            POSITIVE_CLASS,
        }:
            raise RuntimeError(
                "ML-2 calibrator has unexpected class labels"
            )

        calibration_positive_index = (
            calibration_classes.index(
                POSITIVE_CLASS
            )
        )

        calibrated_positive = np.asarray(
            self.calibrator.predict_proba(
                raw_probabilities.reshape(-1, 1)
            ),
            dtype=float,
        )[:, calibration_positive_index]

        return np.column_stack(
            (
                1.0 - calibrated_positive,
                calibrated_positive,
            )
        )

    def predict(
        self,
        features: Any,
    ) -> np.ndarray:
        probabilities = self.predict_proba(
            features
        )

        indexes = np.argmax(
            probabilities,
            axis=1,
        )

        return self.classes_[indexes]