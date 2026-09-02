from codesage_ml.risk.features import aeeem_age_weeks_to_days


def test_aeeem_file_age_weeks_are_converted_to_production_days() -> None:
    assert aeeem_age_weeks_to_days(3) == 21.0
