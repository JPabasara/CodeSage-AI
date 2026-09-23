from unittest.mock import MagicMock, patch

import httpx
import pytest

from codesage_api.detection.risk.client import RiskClientResult, predict
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.ck_metrics import ClassMetrics
from codesage_api.extractors.process_metrics import FileProcessMetrics


def _class_metrics(
    *,
    path: str = "src/Main.java",
    class_name: str = "Main",
    class_type: str = "class",
    wmc: float = 12.0,
    cbo: float = 4.0,
    dit: float = 2.0,
    lcom: float = 1.0,
    rfc: float = 15.0,
    noc: float = 0.0,
    loc: int = 250,
    methods: int = 8,
) -> ClassMetrics:
    """Build one class-level CK observation for ML-2 tests."""
    return ClassMetrics(
        path=path,
        class_name=class_name,
        class_type=class_type,
        wmc=wmc,
        cbo=cbo,
        dit=dit,
        lcom=lcom,
        rfc=rfc,
        noc=noc,
        number_of_lines_of_code=loc,
        number_of_methods=methods,
    )


def _process_metrics(
    path: str = "src/Main.java",
) -> FileProcessMetrics:
    """Build a complete file-level process observation."""
    return FileProcessMetrics(
        path=path,
        commits_90d=7,
        number_of_versions_until=15,
        number_of_authors_until=3,
        lines_added_until=500,
        max_lines_added_until=100,
        avg_lines_added_until=33.3,
        lines_removed_until=200,
        max_lines_removed_until=50,
        avg_lines_removed_until=13.3,
        code_churn_until=300,
        max_code_churn_until=80,
        avg_code_churn_until=20.0,
        age_with_respect_to=52.0,
        weighted_age_with_respect_to=30.0,
    )


def _mock_response(
    *,
    scores: list[dict[str, object]],
    model_version: str = "risk-2.0.0",
) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {
        "scores": scores,
        "model_version": model_version,
    }
    return response


def test_risk_client_predict_success():
    """Client sends class-level 21-feature observations and returns file risk."""
    classes = [_class_metrics()]

    process = {
        "src/Main.java": _process_metrics(),
    }

    response = _mock_response(
        scores=[
            {
                "path": "src/Main.java",
                "class_name": "Main",
                "risk_score": 0.78,
            }
        ]
    )

    with patch(
        "httpx.post",
        return_value=response,
    ) as mock_post:
        result = predict(classes, process)

    assert isinstance(result, RiskClientResult)
    assert result.scores == {
        "src/Main.java": pytest.approx(0.78)
    }
    assert result.model_version == "risk-2.0.0"

    mock_post.assert_called_once()

    payload = mock_post.call_args.kwargs["json"]

    assert set(payload) == {"classes"}
    assert len(payload["classes"]) == 1

    sent_class = payload["classes"][0]

    assert sent_class["path"] == "src/Main.java"
    assert sent_class["class_name"] == "Main"

    metrics = sent_class["metrics"]

    assert len(metrics) == 21
    assert "commits_90d" not in metrics

    # Class-level CK features
    assert metrics["wmc"] == 12.0
    assert metrics["cbo"] == 4.0
    assert metrics["dit"] == 2.0
    assert metrics["lcom"] == 1.0
    assert metrics["rfc"] == 15.0
    assert metrics["noc"] == 0.0
    assert metrics["numberOfLinesOfCode"] == 250.0
    assert metrics["numberOfMethods"] == 8.0

    # File-level process features
    assert metrics["numberOfVersionsUntil"] == 15.0
    assert metrics["numberOfAuthorsUntil"] == 3.0
    assert metrics["linesAddedUntil"] == 500.0
    assert metrics["maxLinesAddedUntil"] == 100.0
    assert metrics["avgLinesAddedUntil"] == 33.3
    assert metrics["linesRemovedUntil"] == 200.0
    assert metrics["maxLinesRemovedUntil"] == 50.0
    assert metrics["avgLinesRemovedUntil"] == 13.3
    assert metrics["codeChurnUntil"] == 300.0
    assert metrics["maxCodeChurnUntil"] == 80.0
    assert metrics["avgCodeChurnUntil"] == 20.0
    assert metrics["ageWithRespectTo"] == 52.0
    assert metrics["weightedAgeWithRespectTo"] == 30.0


def test_risk_client_empty_inputs():
    """No eligible classes means no HTTP request."""
    with patch("httpx.post") as mock_post:
        result = predict([], {})

    assert result == RiskClientResult(
        scores={},
        model_version="",
    )

    mock_post.assert_not_called()


def test_risk_client_handles_network_error():
    """Network failure becomes MLServiceUnavailable."""
    classes = [
        _class_metrics(
            path="src/A.java",
            class_name="A",
        )
    ]

    with (
        patch(
            "httpx.post",
            side_effect=httpx.ConnectError(
                "Connection refused"
            ),
        ),
        pytest.raises(MLServiceUnavailable),
    ):
        predict(classes, {})


def test_risk_client_handles_malformed_json():
    """Malformed ML-service JSON becomes MLServiceUnavailable."""
    classes = [
        _class_metrics(
            path="src/A.java",
            class_name="A",
        )
    ]

    response = MagicMock()
    response.status_code = 200
    response.json.side_effect = ValueError(
        "Invalid JSON response"
    )

    with (
        patch(
            "httpx.post",
            return_value=response,
        ),
        pytest.raises(MLServiceUnavailable),
    ):
        predict(classes, {})


def test_risk_client_handles_malformed_response_schema():
    """Missing response metadata or score fields must fail."""
    classes = [
        _class_metrics(
            path="src/A.java",
            class_name="A",
        )
    ]

    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {
        "scores": [
            {
                "path": "src/A.java",
                "class_name": "A",
                "risk_score": 0.5,
            }
        ]
        # model_version intentionally absent
    }

    with (
        patch(
            "httpx.post",
            return_value=response,
        ),
        pytest.raises(MLServiceUnavailable),
    ):
        predict(classes, {})


def test_risk_client_handles_http_500_error():
    """HTTP server errors become MLServiceUnavailable."""
    classes = [
        _class_metrics(
            path="src/A.java",
            class_name="A",
        )
    ]

    response = MagicMock()
    response.status_code = 500
    response.raise_for_status.side_effect = (
        httpx.HTTPStatusError(
            "Server Error",
            request=MagicMock(),
            response=response,
        )
    )

    with (
        patch(
            "httpx.post",
            return_value=response,
        ),
        pytest.raises(MLServiceUnavailable),
    ):
        predict(classes, {})


def test_risk_client_ignores_process_only_paths():
    """Git-history entries alone are not ML-2 prediction entities."""
    process = {
        "src/Deleted.java": _process_metrics(
            "src/Deleted.java"
        ),
    }

    with patch("httpx.post") as mock_post:
        result = predict([], process)

    assert result == RiskClientResult(
        scores={},
        model_version="",
    )

    mock_post.assert_not_called()


def test_risk_client_broadcasts_file_process_metrics_to_classes():
    """Classes in one file receive the same file-level process context."""
    classes = [
        _class_metrics(
            path="src/Example.java",
            class_name="Example",
            wmc=20.0,
            loc=400,
        ),
        _class_metrics(
            path="src/Example.java",
            class_name="Helper",
            wmc=5.0,
            loc=80,
        ),
    ]

    process = {
        "src/Example.java": _process_metrics(
            "src/Example.java"
        )
    }

    response = _mock_response(
        scores=[
            {
                "path": "src/Example.java",
                "class_name": "Example",
                "risk_score": 0.6,
            },
            {
                "path": "src/Example.java",
                "class_name": "Helper",
                "risk_score": 0.3,
            },
        ]
    )

    with patch(
        "httpx.post",
        return_value=response,
    ) as mock_post:
        predict(classes, process)

    sent = mock_post.call_args.kwargs["json"]["classes"]

    assert len(sent) == 2

    by_name = {
        item["class_name"]: item
        for item in sent
    }

    # CK metrics remain class-specific.
    assert by_name["Example"]["metrics"]["wmc"] == 20.0
    assert by_name["Helper"]["metrics"]["wmc"] == 5.0

    assert (
        by_name["Example"]["metrics"]["numberOfLinesOfCode"]
        == 400.0
    )
    assert (
        by_name["Helper"]["metrics"]["numberOfLinesOfCode"]
        == 80.0
    )

    # Process metrics are intentionally identical because both classes
    # belong to the same physical source file.
    process_feature_names = (
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

    for feature in process_feature_names:
        assert (
            by_name["Example"]["metrics"][feature]
            == by_name["Helper"]["metrics"][feature]
        )


def test_risk_client_aggregates_class_probabilities_by_file():
    """Class probabilities are aggregated only after class-level inference."""
    classes = [
        _class_metrics(
            path="src/Example.java",
            class_name="Example",
        ),
        _class_metrics(
            path="src/Example.java",
            class_name="Helper",
        ),
    ]

    response = _mock_response(
        scores=[
            {
                "path": "src/Example.java",
                "class_name": "Example",
                "risk_score": 0.6,
            },
            {
                "path": "src/Example.java",
                "class_name": "Helper",
                "risk_score": 0.3,
            },
        ]
    )

    with patch(
        "httpx.post",
        return_value=response,
    ):
        result = predict(classes, {})

    # Current aggregation policy is noisy-OR:
    #
    # 1 - (1 - 0.6)(1 - 0.3)
    # = 1 - 0.28
    # = 0.72
    assert result.scores["src/Example.java"] == pytest.approx(
        0.72
    )


def test_single_class_file_preserves_probability():
    """A one-class file keeps exactly the class probability."""
    classes = [
        _class_metrics(
            path="src/A.java",
            class_name="A",
        )
    ]

    response = _mock_response(
        scores=[
            {
                "path": "src/A.java",
                "class_name": "A",
                "risk_score": 0.42,
            }
        ]
    )

    with patch(
        "httpx.post",
        return_value=response,
    ):
        result = predict(classes, {})

    assert result.scores == {
        "src/A.java": pytest.approx(0.42)
    }


def test_risk_client_sends_zero_process_metrics_without_history():
    """Missing Git history produces explicit zero process features."""
    classes = [
        _class_metrics(
            path="src/New.java",
            class_name="New",
        )
    ]

    response = _mock_response(
        scores=[
            {
                "path": "src/New.java",
                "class_name": "New",
                "risk_score": 0.2,
            }
        ]
    )

    with patch(
        "httpx.post",
        return_value=response,
    ) as mock_post:
        predict(classes, {})

    metrics = (
        mock_post.call_args.kwargs["json"]
        ["classes"][0]["metrics"]
    )

    assert len(metrics) == 21

    assert metrics["numberOfVersionsUntil"] == 0.0
    assert metrics["numberOfAuthorsUntil"] == 0.0
    assert metrics["linesAddedUntil"] == 0.0
    assert metrics["maxLinesAddedUntil"] == 0.0
    assert metrics["avgLinesAddedUntil"] == 0.0
    assert metrics["linesRemovedUntil"] == 0.0
    assert metrics["maxLinesRemovedUntil"] == 0.0
    assert metrics["avgLinesRemovedUntil"] == 0.0
    assert metrics["codeChurnUntil"] == 0.0
    assert metrics["maxCodeChurnUntil"] == 0.0
    assert metrics["avgCodeChurnUntil"] == 0.0
    assert metrics["ageWithRespectTo"] == 0.0
    assert metrics["weightedAgeWithRespectTo"] == 0.0


def test_risk_client_filters_non_class_ck_entities():
    """Inner and anonymous CK entities are not sent to ML-2."""
    classes = [
        _class_metrics(
            path="src/Main.java",
            class_name="Main",
            class_type="class",
        ),
        _class_metrics(
            path="src/Main.java",
            class_name="Main.Inner",
            class_type="innerclass",
        ),
        _class_metrics(
            path="src/Main.java",
            class_name="Main$1",
            class_type="anonymous",
        ),
    ]

    response = _mock_response(
        scores=[
            {
                "path": "src/Main.java",
                "class_name": "Main",
                "risk_score": 0.5,
            }
        ]
    )

    with patch(
        "httpx.post",
        return_value=response,
    ) as mock_post:
        result = predict(classes, {})

    sent = mock_post.call_args.kwargs["json"]["classes"]

    assert len(sent) == 1
    assert sent[0]["class_name"] == "Main"

    assert result.scores["src/Main.java"] == pytest.approx(
        0.5
    )


@pytest.mark.parametrize(
    "response_payload",
    [
        # Missing every expected class.
        {
            "scores": [],
            "model_version": "risk-2.0.0",
        },

        # Duplicate class identity.
        {
            "scores": [
                {
                    "path": "src/A.java",
                    "class_name": "A",
                    "risk_score": 0.4,
                },
                {
                    "path": "src/A.java",
                    "class_name": "A",
                    "risk_score": 0.5,
                },
            ],
            "model_version": "risk-2.0.0",
        },

        # Unexpected path.
        {
            "scores": [
                {
                    "path": "src/Other.java",
                    "class_name": "A",
                    "risk_score": 0.4,
                }
            ],
            "model_version": "risk-2.0.0",
        },

        # Unexpected class.
        {
            "scores": [
                {
                    "path": "src/A.java",
                    "class_name": "Other",
                    "risk_score": 0.4,
                }
            ],
            "model_version": "risk-2.0.0",
        },

        # Missing model version.
        {
            "scores": [
                {
                    "path": "src/A.java",
                    "class_name": "A",
                    "risk_score": 0.4,
                }
            ],
        },

        # Probability greater than one.
        {
            "scores": [
                {
                    "path": "src/A.java",
                    "class_name": "A",
                    "risk_score": 1.2,
                }
            ],
            "model_version": "risk-2.0.0",
        },

        # Negative probability.
        {
            "scores": [
                {
                    "path": "src/A.java",
                    "class_name": "A",
                    "risk_score": -0.1,
                }
            ],
            "model_version": "risk-2.0.0",
        },
    ],
)
def test_risk_client_rejects_incomplete_or_inconsistent_responses(
    response_payload: dict[str, object],
) -> None:
    classes = [
        _class_metrics(
            path="src/A.java",
            class_name="A",
        )
    ]

    response = MagicMock()
    response.status_code = 200
    response.json.return_value = response_payload

    with (
        patch(
            "httpx.post",
            return_value=response,
        ),
        pytest.raises(MLServiceUnavailable),
    ):
        predict(classes, {})
