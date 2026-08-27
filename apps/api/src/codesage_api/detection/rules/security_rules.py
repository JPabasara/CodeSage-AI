"""Java security-pattern detectors required by SRS FR-8.

Tree-sitter keeps matches inside executable Java syntax, so credentials or SQL
shown in comments and documentation cannot become findings. Secret values are
used only in memory to calculate entropy and are never returned or logged.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import tree_sitter_java
from tree_sitter import Language, Node, Parser, Tree


@dataclass(frozen=True, slots=True)
class SecurityMatch:
    line: int
    symbol: str
    evidence: str
    measured_value: float | None = None
    threshold: float | None = None


_JAVA = Language(tree_sitter_java.language())
_CREDENTIAL_NAME = re.compile(
    r"(?i)(?:password|passwd|pwd|secret|api_?key|access_?token|auth_?token|"
    r"client_?secret|private_?key)$"
)
_PROVIDER_SECRET = re.compile(
    r"(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|"
    r"sk-(?:live|test)-[A-Za-z0-9]{16,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)"
)
_SQL_START = re.compile(r"(?is)^\s*(?:select|insert|update|delete)\b")
_ENTROPY_THRESHOLD = 3.0
_MIN_SECRET_LENGTH = 8


def _parse(source: bytes) -> Tree:
    return Parser(_JAVA).parse(source)


def _walk(node: Node) -> Iterator[Node]:
    yield node
    for child in node.children:
        yield from _walk(child)


def _text(node: Node, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _string_value(node: Node, source: bytes) -> str | None:
    if node.type != "string_literal":
        return None
    raw = _text(node, source)
    return raw[1:-1] if len(raw) >= 2 else ""


def _entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def _credential_assignment(node: Node) -> tuple[Node, Node] | None:
    if node.type == "variable_declarator":
        name = node.child_by_field_name("name")
        value = node.child_by_field_name("value")
    elif node.type == "assignment_expression":
        name = node.child_by_field_name("left")
        value = node.child_by_field_name("right")
    else:
        return None
    if name is None or value is None:
        return None
    return name, value


def detect_hardcoded_secret(file_path: Path, source: str) -> list[SecurityMatch]:
    """Find credential-named assignments to sufficiently secret-like literals."""
    del file_path  # Retained in the detector interface for future language packs.
    encoded = source.encode("utf-8")
    findings: list[SecurityMatch] = []
    for node in _walk(_parse(encoded).root_node):
        assignment = _credential_assignment(node)
        if assignment is None:
            continue
        name_node, value_node = assignment
        symbol = _text(name_node, encoded).split(".")[-1]
        value = _string_value(value_node, encoded)
        if value is None or len(value) < _MIN_SECRET_LENGTH:
            continue
        provider_match = _PROVIDER_SECRET.search(value)
        if _CREDENTIAL_NAME.search(symbol) is None and provider_match is None:
            continue
        entropy = _entropy(value)
        if entropy < _ENTROPY_THRESHOLD and provider_match is None:
            continue
        findings.append(
            SecurityMatch(
                line=node.start_point[0] + 1,
                symbol=symbol,
                evidence=f"credential-like literal; entropy={entropy:.2f}",
                measured_value=entropy,
                threshold=_ENTROPY_THRESHOLD,
            )
        )
    return findings


def _plus_operands(node: Node) -> list[Node]:
    if node.type != "binary_expression":
        return [node]
    operator = node.child_by_field_name("operator")
    if operator is None or operator.type != "+":
        return [node]
    left = node.child_by_field_name("left")
    right = node.child_by_field_name("right")
    if left is None or right is None:
        return [node]
    return _plus_operands(left) + _plus_operands(right)


def _enclosing_symbol(node: Node, file_path: Path, source: bytes) -> str:
    current = node.parent
    while current is not None:
        if current.type in {"method_declaration", "constructor_declaration"}:
            name = current.child_by_field_name("name")
            if name is not None:
                return _text(name, source)
        current = current.parent
    return file_path.stem


def detect_sql_concat(file_path: Path, source: str) -> list[SecurityMatch]:
    """Find SQL literals concatenated with a runtime Java expression."""
    encoded = source.encode("utf-8")
    findings: list[SecurityMatch] = []
    for node in _walk(_parse(encoded).root_node):
        if node.type != "binary_expression":
            continue
        # Inspect only the root of one concatenation chain to avoid duplicates.
        if node.parent is not None and node.parent.type == "binary_expression":
            parent_operator = node.parent.child_by_field_name("operator")
            if parent_operator is not None and parent_operator.type == "+":
                continue
        operands = _plus_operands(node)
        literals = [
            value
            for item in operands
            if (value := _string_value(item, encoded)) is not None
        ]
        if not any(_SQL_START.search(value) for value in literals):
            continue
        dynamic_count = sum(item.type != "string_literal" for item in operands)
        if dynamic_count == 0:
            continue
        findings.append(
            SecurityMatch(
                line=node.start_point[0] + 1,
                symbol=_enclosing_symbol(node, file_path, encoded),
                evidence=f"SQL concatenated with {dynamic_count} runtime expression(s)",
                measured_value=float(dynamic_count),
                threshold=0.0,
            )
        )
    return findings
