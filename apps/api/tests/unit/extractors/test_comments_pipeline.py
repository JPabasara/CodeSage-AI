import httpx
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


def test_tree_sitter_excludes_javadocs_but_keeps_ordinary_block_comments():
    pytest.importorskip("tree_sitter")
    pytest.importorskip("tree_sitter_java")

    java_code = """/**
 * Adds a listener.
 * @param listener must not be null
 */
public class ListenerRegistry {
    /*
     * TODO: replace this temporary listener store.
     */
    private Object listeners;

    // FIXME: make listener registration thread-safe.
    void register() {}
}
"""

    comments = extract_comments_from_file("ListenerRegistry.java", java_code)

    assert [comment.line for comment in comments] == [6, 11]
    assert comments[0].text.startswith("/*")
    assert "TODO: replace this temporary listener store" in comments[0].text
    assert comments[1].text == "// FIXME: make listener registration thread-safe."
    assert all(not comment.text.startswith("/**") for comment in comments)


@pytest.mark.parametrize(
    "legal_header",
    [
        """/* Copyright 2026 Example Authors
 * This program is free software; you can redistribute it.
 * It is provided without any warranty.
 */""",
        """/* Copyright 2026 Example Authors
 * Licensed under the Apache License, Version 2.0.
 */""",
        "// SPDX-License-Identifier: MIT",
    ],
)
def test_tree_sitter_excludes_leading_legal_headers(legal_header):
    pytest.importorskip("tree_sitter")
    pytest.importorskip("tree_sitter_java")

    java_code = f"""{legal_header}
package example;

class Example {{
    // TODO: remove this temporary implementation.
    void run() {{}}
}}
"""

    comments = extract_comments_from_file("Example.java", java_code)

    assert len(comments) == 1
    assert comments[0].text == "// TODO: remove this temporary implementation."


def test_tree_sitter_keeps_leading_technical_block_comment():
    pytest.importorskip("tree_sitter")
    pytest.importorskip("tree_sitter_java")

    java_code = """/*
 * TODO: replace this compatibility workaround after the migration.
 */
package example;
class Example {}
"""

    comments = extract_comments_from_file("Example.java", java_code)

    assert len(comments) == 1
    assert "TODO: replace this compatibility workaround" in comments[0].text


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


def test_satd_client_all_canonical_categories():
    """Verify that all 4 predictable categories are correctly mapped to Category enum."""
    comments = [
        ExtractedComment(file_path="A.java", line=1, text="// code debt"),
        ExtractedComment(file_path="B.java", line=2, text="// test debt"),
        ExtractedComment(file_path="C.java", line=3, text="// doc debt"),
        ExtractedComment(file_path="D.java", line=4, text="// req debt"),
        ExtractedComment(file_path="E.java", line=5, text="// non debt"),
    ]

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "predictions": [
            {"id": "c_0", "is_debt": True, "category": "code-design", "confidence": 0.9},
            {"id": "c_1", "is_debt": True, "category": "test", "confidence": 0.85},
            {"id": "c_2", "is_debt": True, "category": "documentation", "confidence": 0.88},
            {"id": "c_3", "is_debt": True, "category": "requirement", "confidence": 0.92},
            {"id": "c_4", "is_debt": False, "category": None, "confidence": 0.99},
        ],
        "model_version": "satd-1.0.0",
    }

    with patch("httpx.post", return_value=mock_response):
        results = classify(comments)

    assert len(results) == 5
    assert results[0].category == Category.CODE_DESIGN
    assert results[1].category == Category.TEST
    assert results[2].category == Category.DOCUMENTATION
    assert results[3].category == Category.REQUIREMENT
    assert results[4].category is None
    assert results[4].is_debt is False


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

    # Case 3: HTTP Network error (timeout/connection refusal)
    with patch("httpx.post", side_effect=httpx.ConnectError("Connection refused")):
        with pytest.raises(MLServiceUnavailable):
            classify(comments)


