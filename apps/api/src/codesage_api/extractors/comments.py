"""One comment pulled out of a source file.

`text` is what the classifier reads. `line` is what the finding points at, so a
user can click straight to it.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExtractedComment:
    file_path: str
    line: int
    text: str


def extract_comments_from_file(file_path: str, source_code: str) -> list[ExtractedComment]:
    """Extract comments from source code based on file extension.

    Supports extension matching to dispatch to the appropriate Tree-sitter parser.
    For v1.0, ships tree-sitter-java for .java files.
    """
    if file_path.endswith(".java"):
        return extract_java_comments(file_path, source_code)

    # Future language extensions (.py, .js, .ts) will be added here
    return []


def extract_java_comments(file_path: str, source_code: str) -> list[ExtractedComment]:
    """Extract comments from Java source code using Tree-sitter."""
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
                comments.append(
                    ExtractedComment(
                        file_path=file_path,
                        line=node.start_point[0] + 1,
                        text=comment_text,
                    )
                )
            for child in node.children:
                traverse(child)

        traverse(tree.root_node)
        return comments
    except ImportError:
        return []