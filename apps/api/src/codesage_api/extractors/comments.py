"""Source-comment extraction via Tree-sitter (SRS FR-7).

Feeds ML-1. Every comment is read from the **working tree at the scanned SHA**, and
that scoping is the whole reason SATD detection works as a health signal: delete
the `// TODO`, the next scan does not see it, the finding vanishes, health rises.
That is exactly the behaviour the trend chart exists to make visible.

Contrast with commit-message SATD, which FR-7.1 excludes: a commit message has no
`file:line` to point at, history only grows so such findings would accumulate
forever with no removal event, and a message proves debt existed at one past
instant with no way to tell whether it was later paid off.

Tree-sitter rather than a regex because comment syntax is genuinely a parsing
problem: `// not a comment` inside a string literal, block comments containing
`*/` in a nested string, Javadoc spanning many lines. A regex gets these wrong in
ways that produce findings at line numbers where nothing is.

⚠️ DBR-27: comments are transient here. Only the comment that actually produced a
SATD finding is persisted, as evidence on that finding. Unrelated comments are
never written to the database.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ExtractedComment:
    """One comment, anchored where the user can open it."""

    file_path: str
    start_line: int
    end_line: int
    text: str
    # Adjacent single-line comments are merged into one block before classification:
    # a three-line `// TODO: …` explanation is one admission of debt, not three.
    is_block: bool


def extract(clone_dir: Path, language: str = "java") -> list[ExtractedComment]:
    """Parse every source file at the scanned revision and return its comments.

    v1.0 handles Java only, matching the CK constraint (SRS §2.4). The `language`
    parameter exists because Tree-sitter itself is language-agnostic — adding a
    grammar is what PORT-02 means by "new parsers can be integrated" — and because
    the SATD model is the most portable ML component: comments are English
    regardless of the programming language, so a model trained on one language's
    comments reads another's fine. Only the comment *syntax* is language-specific,
    and that is precisely what Tree-sitter abstracts.
    """
    raise NotImplementedError
