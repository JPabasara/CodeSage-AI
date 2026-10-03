from __future__ import annotations

from pathlib import Path, PurePosixPath
from xml.etree import ElementTree

from codesage_api.detection.pmd.models import PMDViolation


class PMDReportError(ValueError):
    pass


def normalize_path(raw_path: str, repository_path: Path) -> str:
    """Return a stable repository-relative POSIX path without allowing escape."""
    path = Path(raw_path)
    if not path.is_absolute():
        normalized = PurePosixPath(raw_path.replace("\\", "/"))
        if ".." not in normalized.parts:
            return normalized.as_posix().lstrip("./")
    try:
        return path.resolve().relative_to(repository_path.resolve()).as_posix()
    except ValueError as exc:
        raise PMDReportError(
            f"PMD reported a path outside the repository: {raw_path}"
        ) from exc


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _optional_attribute(element: ElementTree.Element, name: str) -> str | None:
    value = element.get(name)
    return value if value else None


def parse(report: str, repository_path: Path) -> list[PMDViolation]:
    try:
        root = ElementTree.fromstring(report)
    except ElementTree.ParseError as exc:
        raise PMDReportError("PMD produced an invalid XML report.") from exc

    if any(_local_name(element.tag) == "configerror" for element in root.iter()):
        raise PMDReportError("PMD report contains configuration errors.")

    violations: list[PMDViolation] = []
    for file_element in root.iter():
        if _local_name(file_element.tag) != "file":
            continue
        file_path = normalize_path(file_element.get("name", ""), repository_path)
        for item in file_element:
            if _local_name(item.tag) != "violation":
                continue
            begin_line = max(1, int(item.get("beginline", "1")))
            violations.append(
                PMDViolation(
                    rule=item.get("rule", ""),
                    ruleset=item.get("ruleset", ""),
                    priority=int(item.get("priority", "5")),
                    message="".join(item.itertext()).strip() or "PMD violation",
                    file_path=file_path,
                    begin_line=begin_line,
                    end_line=max(1, int(item.get("endline", str(begin_line)))),
                    begin_column=max(0, int(item.get("begincolumn", "0"))),
                    end_column=max(0, int(item.get("endcolumn", "0"))),
                    package_name=_optional_attribute(item, "package"),
                    class_name=_optional_attribute(item, "class"),
                    method_name=_optional_attribute(item, "method"),
                    variable_name=_optional_attribute(item, "variable"),
                )
            )
    return violations
