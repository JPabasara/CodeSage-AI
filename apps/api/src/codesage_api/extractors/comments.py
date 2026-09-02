

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExtractedComment:
    file_path: str
    line: int
    text: str


_LICENSE_MARKERS = (
    "copyright",
    "licensed under",
    "free software",
    "redistribute",
    "without any warranty",
    "gnu general public license",
    "apache license",
)


def _is_license_header(comment_text: str, start_line: int) -> bool:

    if start_line > 50:
        return False

    normalized = comment_text.lower()
    if "spdx-license-identifier:" in normalized:
        return True
    return sum(marker in normalized for marker in _LICENSE_MARKERS) >= 2


def extract_comments_from_file(file_path: str, source_code: str) -> list[ExtractedComment]:
    if file_path.endswith(".java"):
        return extract_java_comments(file_path, source_code)
    return []


def extract_java_comments(file_path: str, source_code: str) -> list[ExtractedComment]:
    try:
        import tree_sitter_java as tsjava
        from tree_sitter import Language, Parser

        JAVA_LANGUAGE = Language(tsjava.language())
        parser = Parser(JAVA_LANGUAGE)

        tree = parser.parse(bytes(source_code, "utf8"))
        comments: list[ExtractedComment] = []

        def traverse(node):
            if "comment" in node.type:
                comment_text = source_code[node.start_byte:node.end_byte].strip()
                start_line = node.start_point[0] + 1
            
                if not (
                    (
                        node.type == "block_comment"
                        and comment_text.startswith("/**")
                    )
                    or _is_license_header(comment_text, start_line)
                ):
                    comments.append(
                        ExtractedComment(
                            file_path=file_path,
                            line=start_line,
                            text=comment_text,
                        )
                    )
            for child in node.children:
                traverse(child)

        traverse(tree.root_node)
        return comments
    except ImportError:
        return []
