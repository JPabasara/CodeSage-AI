"""Seed the explicit PMD 7.27.0 CodeSage allowlist."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260929_0020"
down_revision: str | None = "20260928_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CODE_DESIGN_RULES = (
    "AvoidPrintStackTrace",
    "AvoidUsingHardCodedIP",
    "DoubleBraceInitialization",
    "NonExhaustiveSwitch",
    "PreserveStackTrace",
    "UnusedAssignment",
    "UnusedLocalVariable",
    "UnusedPrivateField",
    "UnusedPrivateMethod",
    "ExceptionAsFlowControl",
    "UselessOverridingMethod",
    "AssignmentInOperand",
    "AvoidDecimalLiteralsInBigDecimalConstructor",
    "BrokenNullCheck",
    "DoNotThrowExceptionInFinally",
    "EmptyCatchBlock",
    "EqualsNull",
    "IdenticalConditionalBranches",
    "ImplicitSwitchFallThrough",
    "JumbledIncrementer",
    "MisplacedNullCheck",
    "OverrideBothEqualsAndHashcode",
    "ReturnFromFinallyBlock",
    "UnconditionalIfStatement",
    "UnusedNullCheckInEquals",
    "UseEqualsToCompareStrings",
    "UseLocaleWithCaseConversions",
    "DontCallThreadRun",
    "DoubleCheckedLocking",
    "UseNotifyAllInsteadOfNotify",
    "ArrayIsStoredDirectly",
    "AvoidMessageDigestField",
    "CheckResultSet",
    "MethodReturnsInternalArray",
    "RelianceOnDefaultCharset",
    "UseTryWithResources",
    "AssignmentToNonFinalStatic",
    "ClassCastExceptionWithToArray",
    "CloseResource",
    "CollectionTypeMismatch",
    "ComparisonWithNaN",
    "ConstructorCallsOverridableMethod",
    "InvalidLogMessageFormat",
    "ReturnEmptyCollectionRatherThanNull",
    "UnusedReturnValue",
    "UseCorrectExceptionLogging",
    "UnsupportedJdkApiUsage",
    "NonThreadSafeSingleton",
    "UnsynchronizedStaticFormatter",
    "CognitiveComplexity",
    "ExcessiveParameterList",
    "GodClass",
    "NPathComplexity",
)
TEST_RULES = (
    "AssertStatementInTest",
    "UnitTestShouldIncludeAssert",
    "JUnitJupiterTestNoPrivateModifier",
    "WrongTestAnnotation",
    "TestClassWithoutTestCases",
)
SECURITY_RULES = ("HardCodedCryptoKey", "InsecureCryptoIv")
HIGH_RULES = frozenset(
    {
        "PreserveStackTrace",
        "BrokenNullCheck",
        "DoNotThrowExceptionInFinally",
        "EqualsNull",
        "JumbledIncrementer",
        "MisplacedNullCheck",
        "OverrideBothEqualsAndHashcode",
        "ReturnFromFinallyBlock",
        "UnusedNullCheckInEquals",
        "UseEqualsToCompareStrings",
        "DontCallThreadRun",
        "DoubleCheckedLocking",
        "AvoidMessageDigestField",
        "CheckResultSet",
        "AssignmentToNonFinalStatic",
        "ClassCastExceptionWithToArray",
        "CloseResource",
        "CollectionTypeMismatch",
        "ComparisonWithNaN",
        "ConstructorCallsOverridableMethod",
        "InvalidLogMessageFormat",
        "NonThreadSafeSingleton",
        "UnsynchronizedStaticFormatter",
        "WrongTestAnnotation",
        "HardCodedCryptoKey",
        "InsecureCryptoIv",
    }
)
LOW_RULES = frozenset({"UnusedPrivateField", "UnusedPrivateMethod"})
LEGACY_RULES = {
    "UnusedLocalVariable": "low",
    "EmptyCatchBlock": "medium",
    "ExcessiveParameterList": "medium",
}


def _severity(rule: str) -> str:
    if rule in HIGH_RULES:
        return "high"
    if rule in LOW_RULES:
        return "low"
    return "medium"


def upgrade() -> None:
    bind = op.get_bind()
    for category, rules in (
        ("code-design", CODE_DESIGN_RULES),
        ("test", TEST_RULES),
        ("security", SECURITY_RULES),
    ):
        for rule in rules:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO rule_definition
                        (rule_id, category_id, threshold, severity, message_template)
                    VALUES (:rule_id, :category, 0, :severity, :message)
                    ON CONFLICT (rule_id) DO UPDATE SET
                        category_id = EXCLUDED.category_id,
                        severity = EXCLUDED.severity,
                        message_template = EXCLUDED.message_template
                    """
                ),
                {
                    "rule_id": f"pmd:{rule}",
                    "category": category,
                    "severity": _severity(rule),
                    "message": f"{rule} detected by PMD.",
                },
            )


def downgrade() -> None:
    bind = op.get_bind()
    all_rules = (*CODE_DESIGN_RULES, *TEST_RULES, *SECURITY_RULES)
    new_rule_ids = [f"pmd:{rule}" for rule in all_rules if rule not in LEGACY_RULES]
    bind.execute(
        sa.text("DELETE FROM rule_definition WHERE rule_id = ANY(:rule_ids)"),
        {"rule_ids": new_rule_ids},
    )
    for rule, severity in LEGACY_RULES.items():
        bind.execute(
            sa.text(
                """
                UPDATE rule_definition
                SET category_id = 'code-design', severity = :severity,
                    message_template = :message
                WHERE rule_id = :rule_id
                """
            ),
            {
                "rule_id": f"pmd:{rule}",
                "severity": severity,
                "message": f"{rule} detected by PMD.",
            },
        )
