from codesage_ml.risk.features import (
    FEATURE_ORDER,
    NEGATIVE_CLASS,
    POSITIVE_CLASS,
    PROCESS_FEATURES,
    PRODUCT_FEATURES,
    TARGET_NAME,
)


def test_ml_2_uses_complete_feature_contract() -> None:
    assert len(PRODUCT_FEATURES) == 8
    assert len(PROCESS_FEATURES) == 13
    assert len(FEATURE_ORDER) == 21

    assert FEATURE_ORDER == (
        PRODUCT_FEATURES + PROCESS_FEATURES
    )


def test_ml_2_target_contract() -> None:
    assert TARGET_NAME == "defective"
    assert NEGATIVE_CLASS == 0
    assert POSITIVE_CLASS == 1


def test_ml_2_excludes_codesage_scoring_features() -> None:
    assert "commits_90d" not in FEATURE_ORDER


def test_ml_2_contains_required_dambros_age_features() -> None:
    assert "ageWithRespectTo" in FEATURE_ORDER
    assert "weightedAgeWithRespectTo" in FEATURE_ORDER