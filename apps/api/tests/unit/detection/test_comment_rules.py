import uuid
from unittest.mock import Mock, patch

import pytest
from pydantic import ValidationError

from codesage_api.detection import comment_rules
from codesage_api.errors import ValidationFailed
from codesage_api.extractors.comments import ExtractedComment
from codesage_api.schemas.rules import CommentPatternIn, CommentRule, UpdateCommentRulesIn


def rule(**values):
    return CommentRule(
        id=uuid.uuid4(),
        name="Security TODO",
        match_type="keyword",
        pattern="SECURITY-TODO",
        category="security",
        severity="high",
        **values,
    )


@pytest.mark.parametrize(
    ("text", "matched"),
    [
        ("// security-todo: fix authentication", True),
        ("// XSECURITY-TODO: harmless substring", False),
        ("// SECURITY-TODOS: another token", False),
        ("// Something else", False),
    ],
)
def test_keyword_matching_uses_case_insensitive_token_boundaries(text, matched):
    assert comment_rules.test_pattern(rule(), text) is matched


def test_case_sensitive_regex_matches_multiline_comments():
    spec = CommentPatternIn(
        match_type="regex", pattern=r"(?m)^\s*\*\s*TEST-DEBT\b", case_sensitive=True
    )
    assert comment_rules.test_pattern(spec, "/*\n * TEST-DEBT: cover cancellation\n */")
    assert not comment_rules.test_pattern(spec, "/*\n * test-debt: cover cancellation\n */")


def test_first_enabled_match_wins_and_unmatched_comments_remain_for_ml():
    first = rule()
    second = CommentRule.model_validate(
        {**first.model_dump(), "id": uuid.uuid4(), "category": "documentation"}
    )
    matching = ExtractedComment("A.java", 8, "// SECURITY-TODO: fix this\n// More detail")
    other = ExtractedComment("B.java", 3, "// This workaround is fragile")
    findings, unmatched = comment_rules.match_comments(
        [matching, other], [first.model_dump(mode="json"), second.model_dump(mode="json")]
    )
    assert len(findings) == 1
    finding = findings[0]
    assert finding.category.value == "security"
    assert finding.severity.value == "high"
    assert finding.rule_id == "comment-pattern"
    assert (finding.line, finding.end_line) == (8, 9)
    assert finding.evidence == matching.text
    assert first.name in finding.description
    assert unmatched == [other]
    first.enabled = False
    disabled_findings, _ = comment_rules.match_comments([matching], [first.model_dump(mode="json")])
    assert disabled_findings == []


def test_invalid_regex_is_rejected():
    with pytest.raises(ValidationFailed, match="Invalid comment pattern"):
        comment_rules.test_pattern(CommentPatternIn(match_type="regex", pattern="["), "sample")


def test_timed_out_patterns_do_not_drop_comments_or_stop_ml_fallback():
    slow = Mock()
    slow.search.side_effect = TimeoutError
    comments = [ExtractedComment("A.java", n, "// SECURITY-TODO") for n in (1, 2)]
    with patch.object(comment_rules, "compile_pattern", return_value=slow):
        findings, unmatched = comment_rules.match_comments(
            comments, [rule().model_dump(mode="json")]
        )
    assert findings == []
    assert unmatched == comments
    slow.search.assert_called_once()  # Suspend the rule for the rest of this scan.


def test_sample_regex_timeout_is_reported():
    slow = Mock()
    slow.search.side_effect = TimeoutError
    with (
        patch.object(comment_rules, "compile_pattern", return_value=slow),
        pytest.raises(ValidationFailed, match="too long"),
    ):
        comment_rules.test_pattern(rule(), "sample")


def test_invalid_rule_lists_are_rejected():
    item = rule().model_dump(mode="json")
    with pytest.raises(ValidationError):
        UpdateCommentRulesIn(comment_rules=[item, item])
    with pytest.raises(ValidationError):
        CommentPatternIn(match_type="regex", pattern="  ")


def test_fingerprint_follows_rule_and_comment_across_line_changes():
    config = rule().model_dump(mode="json")
    first, _ = comment_rules.match_comments(
        [ExtractedComment("A.java", 1, "// SECURITY-TODO")], [config]
    )
    moved, _ = comment_rules.match_comments(
        [ExtractedComment("A.java", 20, "// SECURITY-TODO")], [config]
    )
    assert first[0].fingerprint == moved[0].fingerprint
