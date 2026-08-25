from __future__ import annotations
from codesage_api.scoring import formula
from codesage_api.scoring.enums import Category
from codesage_api.scoring.floor import apply_visibility_floor
from codesage_api.scoring.models import (
    CategoryBreakdownItem,
    FileFacts,
    Profile,
    ScoredFile,
    ScoredFinding,
    ScoringFinding,
    ScoringResult
)


def score(
    findings: list[ScoringFinding],
    file_facts: dict[str, FileFacts],
    profile: Profile,
    kloc: float,
) -> ScoringResult:
    debt_by_file: dict[str, float] = {
        file_path: 0.0 for file_path in file_facts
    }

    debt_by_category: dict[Category, float] = {
        category: 0.0 for category in Category
    }

    count_by_category: dict[Category, int] = {
        category: 0 for category in Category
    }

    scored_findings: list[ScoredFinding] = []

    for finding in findings:
        facts = file_facts[finding.file]

        priority = formula.finding_priority(
            finding=finding,
            facts=facts,
            profile=profile,
        )

        scored_findings.append(
            ScoredFinding(
                finding= finding,
                priority= priority
            )
        )


        debt_by_file[finding.file] += priority
        debt_by_category[finding.category] += priority
        count_by_category[finding.category] += 1


        scored_findings.sort(
        key=lambda item: (
            -item.priority,
            item.finding.fingerprint,
        )
    )
    scored_findings = apply_visibility_floor(scored_findings)

    scored_files: list[ScoredFile] = []

    for file_path, facts in sorted(file_facts.items()):
        debt_score = debt_by_file[file_path]
        file_kloc = facts.loc / 1000.0

        file_health = formula.repo_health(
            total_debt=debt_score,
            kloc=file_kloc,
        )

        scored_files.append(
            ScoredFile(
                file=file_path,
                debt_score=debt_score,
                risk_score=facts.risk_score,
                health_score=file_health,
            )
        )

    category_breakdown = [
          CategoryBreakdownItem(
              category=category,
              count=count_by_category[category],
              debt=debt_by_category[category],
          )
          for category in Category
      ]

    total_debt = sum(debt_by_file.values())
    health_score = formula.repo_health(
          total_debt=total_debt,
          kloc=kloc,
      )
    health_grade = formula.grade(health_score)

    return ScoringResult(
          findings=tuple(scored_findings),
          files=tuple(scored_files),
          breakdown=tuple(category_breakdown),
          health_score=health_score,
          grade=health_grade.value,
      )


def aggregate_subtree(
    files: list[str],
    result: ScoringResult,
) -> float:
    selected_files = set(files)

    return sum(
        scored_file.debt_score
        for scored_file in result.files
        if scored_file.file in selected_files
    )
