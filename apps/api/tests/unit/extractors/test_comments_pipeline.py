import pytest
from unittest.mock import patch, MagicMock

from codesage_api.extractors.comments import extract_comments_from_file, ExtractedComment
from codesage_api.detection.satd.client import classify, SATDResult
from codesage_api.scoring.enums import Category


def test_tree_sitter_comment_extraction():
    """Test extracting comments from a Java source file using Tree-sitter."""
    pytest.importorskip("tree_sitter")
    pytest.importorskip("tree_sitter_java")

    java_code = """
    package com.example;

    // TODO: Need to refactor this class to handle async processing
    public class PaymentProcessor {
        private String endpoint = "http://api.example.com//v1"; // False positive check!

        /*
         * FIXME: Temporary workaround for null pointer exception
         */
        public void processPayment(String userId) {
            if (userId == null) {
                return; // Return early
            }
        }
    }
    """

    comments = extract_comments_from_file("PaymentProcessor.java", java_code)

    # Non-java files should return []
    py_comments = extract_comments_from_file("script.py", "# TODO: python comment")
    assert py_comments == []

    # Check extracted comments from Java
    assert len(comments) >= 2
    comment_texts = [c.text for c in comments]
    assert any("TODO: Need to refactor" in text for text in comment_texts)
    assert any("FIXME: Temporary workaround" in text for text in comment_texts)


def test_end_to_end_comment_extraction_to_classification():
    """Test full pipeline: comments -> SATD Client -> Classification."""
    comments = [
        ExtractedComment(file_path="Account.java", line=2, text="// TODO: fix memory leak when closing socket")
    ]

    # Mock HTTP call to ML inference container returning canonical category
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "predictions": [
            {
                "id": "c_0",
                "is_debt": True,
                "category": "code-design",
                "confidence": 0.95,
            }
        ],
        "model_version": "satd-1.0.0",
    }

    with patch("httpx.post", return_value=mock_response):
        results = classify(comments)

    # Verify final SATDResult mapping
    assert len(results) == 1
    assert isinstance(results[0], SATDResult)
    assert results[0].comment == comments[0]
    assert results[0].is_debt is True
    assert results[0].category == Category.CODE_DESIGN
    assert results[0].confidence == 0.95


def test_satd_client_handles_malformed_response_gracefully():
    """Verify client raises MLServiceUnavailable on malformed JSON or payload."""
    from codesage_api.errors import MLServiceUnavailable

    comments = [
        ExtractedComment(file_path="Account.java", line=2, text="// TODO: fix memory leak")
    ]

    # Case 1: Malformed JSON that raises ValueError / JSONDecodeError
    mock_bad_json = MagicMock()
    mock_bad_json.status_code = 200
    mock_bad_json.json.side_effect = ValueError("Invalid JSON")

    with patch("httpx.post", return_value=mock_bad_json):
        with pytest.raises(MLServiceUnavailable):
            classify(comments)

    # Case 2: Missing expected fields in prediction object
    mock_bad_schema = MagicMock()
    mock_bad_schema.status_code = 200
    mock_bad_schema.json.return_value = {
        "predictions": [{"malformed_key": 123}]
    }

    with patch("httpx.post", return_value=mock_bad_schema):
        with pytest.raises(MLServiceUnavailable):
            classify(comments)

