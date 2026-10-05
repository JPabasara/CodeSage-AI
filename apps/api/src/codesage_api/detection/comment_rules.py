"""Deterministic comment findings; unmatched comments remain eligible for ML."""

from time import perf_counter

import regex

from codesage_api.detection.fingerprint import build
from codesage_api.detection.rules.engine import DetectedFinding
from codesage_api.errors import ValidationFailed
from codesage_api.extractors.comments import ExtractedComment
from codesage_api.logging import get_logger
from codesage_api.schemas.rules import CommentPatternIn, CommentRule
from codesage_api.scoring.enums import Source

logger = get_logger(__name__)
MATCH_TIMEOUT_SECONDS = 0.01
RULE_BUDGET_SECONDS = 0.5
COMMENT_RULE_ID = "comment-pattern"


def compile_pattern(spec: CommentPatternIn):
    pattern = (
        spec.pattern
        if spec.match_type == "regex"
        else r"(?<!\w)" + regex.escape(spec.pattern.strip()) + r"(?!\w)"
    )
    try:
        return regex.compile(
            pattern, flags=regex.VERSION1 | (0 if spec.case_sensitive else regex.IGNORECASE)
        )
    except regex.error as exc:
        raise ValidationFailed(f"Invalid comment pattern: {exc}") from exc


def test_pattern(spec: CommentPatternIn, text: str) -> bool:
    try:
        return compile_pattern(spec).search(text, timeout=MATCH_TIMEOUT_SECONDS) is not None
    except TimeoutError as exc:
        raise ValidationFailed(
            "This pattern took too long to match. Simplify it and try again."
        ) from exc


def match_comments(
    comments: list[ExtractedComment], configs: list[dict]
) -> tuple[list[DetectedFinding], list[ExtractedComment]]:
    compiled = [
        (rule, compile_pattern(rule))
        for config in configs
        if (rule := CommentRule.model_validate(config)).enabled
    ]
    findings = []
    unmatched = []
    spent: dict[str, float] = {}
    suspended: set[str] = set()
    for comment in comments:
        for rule, pattern in compiled:
            key = str(rule.id)
            if key in suspended:
                continue
            started = perf_counter()
            try:
                match = pattern.search(comment.text, timeout=MATCH_TIMEOUT_SECONDS)
            except TimeoutError:
                suspended.add(key)
                logger.warning(
                    "Comment pattern timed out; unmatched comments still go to ML",
                    extra={"comment_rule_id": key},
                )
                continue
            spent[key] = spent.get(key, 0) + perf_counter() - started
            if spent[key] >= RULE_BUDGET_SECONDS:
                suspended.add(key)
                logger.warning(
                    "Comment pattern reached its scan budget", extra={"comment_rule_id": key}
                )
            if match is None:
                continue
            findings.append(
                DetectedFinding(
                    file_path=comment.file_path,
                    line=comment.line,
                    end_line=comment.line + comment.text.count("\n"),
                    symbol="comment",
                    rule_id=COMMENT_RULE_ID,
                    category=rule.category,
                    severity=rule.severity,
                    description=f'Comment rule "{rule.name}" matched this comment.',
                    evidence=comment.text,
                    measured_value=None,
                    threshold=None,
                    fingerprint=build(
                        Source.RULE,
                        rule_id=f"comment:{key}",
                        file_path=comment.file_path,
                        comment_text=" ".join(comment.text.split()).casefold(),
                    ),
                )
            )
            break
        else:
            unmatched.append(comment)
    return findings, unmatched
