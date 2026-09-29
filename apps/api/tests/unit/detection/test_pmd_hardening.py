from pathlib import Path
from unittest.mock import patch

from codesage_api.detection.pmd.classpath import ClasspathResult
from codesage_api.detection.pmd.config import PMDConfig
from codesage_api.detection.pmd.detector import scan
from codesage_api.detection.pmd.java_version import detect_java_version
from codesage_api.detection.pmd.runner import PMDRunOutput

PMD_DIR = Path(__file__).parents[3] / "src/codesage_api/detection/pmd"


def test_detects_maven_release(tmp_path: Path) -> None:
    (tmp_path / "pom.xml").write_text("<project><properties><maven.compiler.release>17</maven.compiler.release></properties></project>")
    result = detect_java_version(tmp_path)
    assert (result.version, result.source) == ("17", "pom.xml")


def test_detects_gradle_toolchain(tmp_path: Path) -> None:
    (tmp_path / "build.gradle.kts").write_text("languageVersion.set(JavaLanguageVersion.of(21))")
    result = detect_java_version(tmp_path)
    assert (result.version, result.source) == ("21", "build.gradle.kts")


def test_unknown_java_version_is_unresolved(tmp_path: Path) -> None:
    assert detect_java_version(tmp_path).version is None


def test_profile_selection_uses_trusted_classpath_only(tmp_path: Path) -> None:
    (tmp_path / "Main.java").write_text("class Main {}")
    binary = tmp_path / "pmd"
    binary.touch()
    base = PMDConfig(True, binary, 2, PMD_DIR / "rulesets/codesage.xml", PMD_DIR / "rule_mapping.yaml")
    seen = []

    def fake_run(_repository: Path, configured: PMDConfig) -> PMDRunOutput:
        seen.append(configured)
        return PMDRunOutput(
            '<pmd xmlns="http://pmd.sourceforge.net/report/2.0.0" version="7.27.0"></pmd>',
            "",
        )

    with patch("codesage_api.detection.pmd.detector.run", side_effect=fake_run):
        core = scan(tmp_path, config=base)
        semantic = scan(
            tmp_path,
            config=base,
            classpath_provider=lambda_provider(tmp_path / "trusted.jar"),
        )
    assert core.metadata["analysis_mode"] == "core"
    assert seen[0].ruleset.name == "codesage-core-profile.xml"
    assert semantic.metadata["analysis_mode"] == "semantic"
    assert seen[1].ruleset.name == "codesage.xml"
    assert seen[1].aux_classpath == (tmp_path / "trusted.jar",)


class lambda_provider:
    def __init__(self, entry: Path):
        self.entry = entry

    def resolve(self, repository_path: Path) -> ClasspathResult:
        del repository_path
        return ClasspathResult((self.entry,), "test")
