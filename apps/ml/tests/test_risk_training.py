from __future__ import annotations

import pandas as pd
from training.risk.train import build_feature_matrix

from codesage_ml.risk.features import FEATURE_ORDER


def test_aeeem_file_age_weeks_are_converted_to_production_days() -> None:
    frame = pd.DataFrame(
        [
            {
                "author_count": 2,
                "file_age_weeks": 3,
                "bugs": 1,
                "project_name": "equinox",
            }
        ]
    )

    features, labels, groups = build_feature_matrix(frame)

    assert features[0, FEATURE_ORDER.index("file_age_days")] == 21.0
    assert labels.tolist() == [1]
    assert groups.tolist() == ["equinox"]
