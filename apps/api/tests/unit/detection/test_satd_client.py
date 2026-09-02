from unittest.mock import MagicMock, patch

import httpx
import pytest

from codesage_api.detection.satd.client import SATDResult, classify
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.comments import ExtractedComment
from codesage_api.scoring.enums import Category


def test_satd_client_classify_success():
    """Verify SATD client correctly formats comment payload and maps response."""
    comments = [
        ExtractedComment("src/Main.java", 10, "TODO: refactor this method"),
        ExtractedComment("src/Main.java", 20, "Regular comment text"),
    ]

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "predictions": [
            {
                "id": "c_0",
                "is_debt": True,
                "category": "code-design",
                "confidence": 0.92,
            },
            {
                "id": "c_1",
                "is_debt": False,
                "category": None,
                "confidence": 0.98,
            },
        ],
        "model_version": "satd-1.0.0",
    }

    with patch("httpx.post", return_value=mock_response) as mock_post:
        results = classify(comments)

        assert len(results) == 2
        assert isinstance(results[0], SATDResult)
        assert results[0].is_debt is True
        assert results[0].category == Category.CODE_DESIGN
        assert results[0].confidence == 0.92

        assert results[1].is_debt is False
        assert results[1].category is None

        assert mock_post.called
        sent_payload = mock_post.call_args[1]["json"]
        assert len(sent_payload["comments"]) == 2
        assert sent_payload["comments"][0] == {"id": "c_0", "text": "TODO: refactor this method"}


def test_satd_client_empty_comments():
    """Verify empty comments list returns empty results without HTTP call."""
    with patch("httpx.post") as mock_post:
        results = classify([])
        assert results == []
        assert not mock_post.called


def test_satd_client_handles_network_error():
    """Verify client raises MLServiceUnavailable on network errors."""
    comments = [ExtractedComment("src/Main.java", 10, "TODO: fix this")]
    with patch("httpx.post", side_effect=httpx.ConnectError("Connection refused")):
        with pytest.raises(MLServiceUnavailable):
            classify(comments)


def test_satd_client_handles_http_500_error():
    """Verify client raises MLServiceUnavailable on 500 status code."""
    comments = [ExtractedComment("src/Main.java", 10, "TODO: fix this")]
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Server Error", request=MagicMock(), response=mock_response
    )

    with patch("httpx.post", return_value=mock_response):
        with pytest.raises(MLServiceUnavailable):
            classify(comments)
