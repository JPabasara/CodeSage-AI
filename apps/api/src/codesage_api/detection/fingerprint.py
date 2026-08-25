from __future__ import annotations

import hashlib

from codesage_api.scoring.enums import Source


def rule_fingerprint(rule_id: str, file_path: str, symbol: str) -> str:
    return build(Source.RULE, rule_id=rule_id, file_path=file_path, symbol=symbol)


def satd_fingerprint(file_path: str, comment_text: str) -> str:
    normalized = " ".join(comment_text.split()).casefold()
    return build(Source.SATD, file_path=file_path, comment_text=normalized)


def build(source: Source, **parts: str) -> str:
    canonical = "\x1f".join(
        [source.value, *(f"{key}={parts[key]}" for key in sorted(parts))]
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
