from __future__ import annotations

from codesage_api.scoring.enums import Source


def rule_fingerprint(rule_id: str, file_path: str, symbol: str) -> str:
    raise NotImplementedError


def satd_fingerprint(file_path: str, comment_text: str) -> str:
    raise NotImplementedError


def build(source: Source, **parts: str) -> str:
    raise NotImplementedError
