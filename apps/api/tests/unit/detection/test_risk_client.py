from unittest.mock import MagicMock, patch

import httpx
import pytest

from codesage_api.detection.risk.client import RiskClientResult, predict
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.ck_metrics import FileMetrics
from codesage_api.extractors.process_metrics import FileProcessMetrics


def test_risk_client_predict_success():
    """Verify risk client correctly formats metrics and returns per-file risk scores."""
    static_files = [
        FileMetrics(
            path="src/Main.java",
            loc=250,
            cyclomatic_complexity=12.0,
            max_nesting_depth=3,
            method_count=8,
            longest_method_lines=45,
            cbo=4.0,
            dit=2.0,
            lcom=1.0,
            rfc=15.0,
            noc=0.0,
        )
    ]
    process_metrics = {
        "src/Main.java": FileProcessMetrics(
            path="src/Main.java",
            commits_90d=15,
            author_count=3,
            file_age_days=180.0,
            recency_days=2.0,
        )
    }

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "scores": [{"path": "src/Main.java", "risk_score": 0.78}],
        "model_version": "risk-1.0.0",
        "model_kind": "trained",
    }

    with patch("httpx.post", return_value=mock_response) as mock_post:
        result = predict(static_files, process_metrics)

        assert isinstance(result, RiskClientResult)
        assert result.scores == {"src/Main.java": 0.78}
        assert result.model_version == "risk-1.0.0"
        assert result.model_kind == "trained"
        assert mock_post.called
        sent_payload = mock_post.call_args[1]["json"]
        assert len(sent_payload["files"]) == 1
        assert sent_payload["files"][0]["path"] == "src/Main.java"
        assert sent_payload["files"][0]["metrics"]["loc"] == 250.0
        assert sent_payload["files"][0]["metrics"]["wmc"] == 12.0
        assert sent_payload["files"][0]["metrics"]["cbo"] == 4.0
        assert sent_payload["files"][0]["metrics"]["commits_90d"] == 15.0
        assert sent_payload["files"][0]["metrics"]["comment_ratio"] == 0.0
        assert len(sent_payload["files"][0]["metrics"]) == 13


def test_risk_client_empty_inputs():
    """Verify risk client returns empty RiskClientResult when no files are provided without making HTTP call."""
    with patch("httpx.post") as mock_post:
        result = predict([], {})
        assert isinstance(result, RiskClientResult)
        assert result.scores == {}
        assert result.model_version == ""
        assert result.model_kind == ""
        assert not mock_post.called


def test_risk_client_handles_network_error():
    """Verify risk client raises MLServiceUnavailable on network errors for graceful degradation."""
    static_files = [FileMetrics("src/A.java", 100, 5.0, 2, 4, 20, 1.0, 1.0, 0.0, 5.0, 0.0)]

    with patch(
        "httpx.post", side_effect=httpx.ConnectError("Connection refused")
    ), pytest.raises(MLServiceUnavailable):
        predict(static_files, {})


def test_risk_client_handles_malformed_response():
    """Verify risk client raises MLServiceUnavailable on malformed JSON or payload."""
    static_files = [FileMetrics("src/A.java", 100, 5.0, 2, 4, 20, 1.0, 1.0, 0.0, 5.0, 0.0)]

    # Case 1: Malformed JSON
    mock_bad_json = MagicMock()
    mock_bad_json.status_code = 200
    mock_bad_json.json.side_effect = ValueError("Invalid JSON response")

    with patch("httpx.post", return_value=mock_bad_json), pytest.raises(MLServiceUnavailable):
        predict(static_files, {})

    # Case 2: Missing expected keys
    mock_bad_schema = MagicMock()
    mock_bad_schema.status_code = 200
    mock_bad_schema.json.return_value = {"scores": [{"missing_path_key": 0.5}]}

    with patch("httpx.post", return_value=mock_bad_schema), pytest.raises(MLServiceUnavailable):
        predict(static_files, {})


def test_risk_client_handles_http_500_error():
    """Verify risk client raises MLServiceUnavailable on HTTP 500 server errors."""
    static_files = [FileMetrics("src/A.java", 100, 5.0, 2, 4, 20, 1.0, 1.0, 0.0, 5.0, 0.0)]

    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Server Error", request=MagicMock(), response=mock_response
    )

    with patch("httpx.post", return_value=mock_response), pytest.raises(MLServiceUnavailable):
        predict(static_files, {})


def test_risk_client_handles_process_only_metrics():
    """Process-only and non-Java history entries are not valid ML-2 entities."""
    process_metrics = {
        "src/DeletedOrNonJava.txt": FileProcessMetrics(
            path="src/DeletedOrNonJava.txt",
            commits_90d=5,
            author_count=2,
            file_age_days=60.0,
            recency_days=5.0,
        )
    }

    with patch("httpx.post") as mock_post:
        result = predict([], process_metrics)
    assert result == RiskClientResult(scores={}, model_version="", model_kind="")
    mock_post.assert_not_called()


@pytest.mark.parametrize(
    "response_payload",
    [
        {"scores": [], "model_version": "risk-1.0.0", "model_kind": "trained"},
        {
            "scores": [
                {"path": "src/A.java", "risk_score": 0.4},
                {"path": "src/A.java", "risk_score": 0.5},
            ],
            "model_version": "risk-1.0.0",
            "model_kind": "trained",
        },
        {
            "scores": [{"path": "src/Other.java", "risk_score": 0.4}],
            "model_version": "risk-1.0.0",
            "model_kind": "trained",
        },
        {
            "scores": [{"path": "src/A.java", "risk_score": 0.4}],
            "model_kind": "trained",
        },
    ],
)
def test_risk_client_rejects_incomplete_or_inconsistent_responses(
    response_payload: dict[str, object],
) -> None:
    static_files = [FileMetrics("src/A.java", 100, 5.0, 2, 4, 20, 1.0, 1.0, 0.0, 5.0, 0.0)]
    response = MagicMock()
    response.json.return_value = response_payload

    with patch("httpx.post", return_value=response), pytest.raises(MLServiceUnavailable):
        predict(static_files, {})


def test_risk_client_sends_zero_history_metrics_for_new_file() -> None:
    """Every request uses the complete 13-field contract, even without Git history."""
    static_files = [
        FileMetrics("src/New.java", 20, 2.0, 1, 1, 10, 0.0, 0.0, 0.0, 1.0, 0.0)
    ]
    response = MagicMock()
    response.json.return_value = {
        "scores": [{"path": "src/New.java", "risk_score": 0.2}],
        "model_version": "risk-1.0.0",
        "model_kind": "trained",
    }

    with patch("httpx.post", return_value=response) as post:
        predict(static_files, {})

    metrics = post.call_args.kwargs["json"]["files"][0]["metrics"]
    assert len(metrics) == 13
    assert metrics["commits_90d"] == 0.0
    assert metrics["author_count"] == 0.0
    assert metrics["file_age_days"] == 0.0
    assert metrics["recency_days"] == 0.0
