from __future__ import annotations

import hashlib
from collections.abc import Sequence

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


def unique_in_file_order(items: Sequence[tuple[str, str, int]]) -> list[str]:
    """Make fingerprints unique within one snapshot, stably.

    `items` are `(fingerprint, file_path, line)`. A fingerprint names a finding
    by what it is, not where it sits, so the same SATD comment written on five
    lines of one file yields one fingerprint five times — five real findings the
    dashboard could not tell apart. Counting repeats in line order keeps the
    first occurrence's fingerprint exactly as it was (history still lines up)
    and gives each later one its own stable id. The result is aligned with
    `items`.
    """
    order = sorted(range(len(items)), key=lambda i: (items[i][1], items[i][2], i))
    seen: dict[str, int] = {}
    output = [""] * len(items)
    for index in order:
        fingerprint = items[index][0]
        occurrence = seen.get(fingerprint, 0)
        seen[fingerprint] = occurrence + 1
        output[index] = (
            fingerprint
            if occurrence == 0
            else hashlib.sha256(f"{fingerprint}\x1foccurrence={occurrence}".encode()).hexdigest()
        )
    return output
