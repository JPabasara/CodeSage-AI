from __future__ import annotations

from pathlib import Path
from xml.etree import ElementTree

import yaml

from codesage_api.scoring.enums import Category

_NAMESPACE = {"pmd": "http://pmd.sourceforge.net/ruleset/2.0.0"}


def enabled_rules(ruleset_directory: Path) -> set[str]:
    rules: set[str] = set()
    for filename in ("codesage-core.xml", "codesage-semantic.xml", "codesage-metrics.xml"):
        root = ElementTree.parse(ruleset_directory / filename).getroot()
        for element in root.findall("pmd:rule", _NAMESPACE):
            reference = element.attrib["ref"]
            rules.add(reference.rsplit("/", 1)[-1])
    return rules


def load_mapping(path: Path) -> dict[str, Category]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError("PMD rule mapping must be a category-to-rule mapping.")
    mapping: dict[str, Category] = {}
    for raw_category, raw_rules in payload.items():
        category = Category(str(raw_category))
        if category not in {Category.CODE_DESIGN, Category.TEST, Category.SECURITY}:
            raise ValueError(f"PMD cannot emit the {category.value} category.")
        if not isinstance(raw_rules, list):
            raise TypeError(f"PMD mapping for {category.value} must be a list.")
        for raw_rule in raw_rules:
            rule = str(raw_rule)
            if rule in mapping:
                raise ValueError(f"PMD rule {rule} has more than one category mapping.")
            mapping[rule] = category
    return mapping


def validate_mapping(ruleset_directory: Path, mapping_path: Path) -> dict[str, Category]:
    rules = enabled_rules(ruleset_directory)
    mapping = load_mapping(mapping_path)
    if missing := rules - mapping.keys():
        raise ValueError(f"Enabled PMD rules lack mappings: {sorted(missing)}")
    if disabled := mapping.keys() - rules:
        raise ValueError(f"PMD mappings refer to disabled rules: {sorted(disabled)}")
    return mapping
