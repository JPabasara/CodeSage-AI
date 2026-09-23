from codesage_ml.risk.features import FEATURE_ORDER, PROCESS_FEATURES, PRODUCT_FEATURES


def test_ml_2_uses_the_complete_aeeem_feature_contract() -> None:
    assert len(PRODUCT_FEATURES) == 8
    assert len(PROCESS_FEATURES) == 13
    assert len(FEATURE_ORDER) == 21
    assert "ageWithRespectTo" in FEATURE_ORDER
    assert "weightedAgeWithRespectTo" in FEATURE_ORDER
    assert "commits_90d" not in FEATURE_ORDER
