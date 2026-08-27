from pathlib import Path

from codesage_api.detection.rules.security_rules import (
    detect_hardcoded_secret,
    detect_sql_concat,
)


def test_hardcoded_secret_uses_name_and_entropy_without_returning_value() -> None:
    source = '''
class Credentials {
    String password = "correct-horse-battery-staple";
    String ordinaryLabel = "correct-horse-battery-staple";
    String apiKey = System.getenv("API_KEY");
}
'''

    findings = detect_hardcoded_secret(Path("Credentials.java"), source)

    assert len(findings) == 1
    assert findings[0].line == 3
    assert findings[0].symbol == "password"
    assert findings[0].measured_value is not None
    assert findings[0].measured_value >= 3.0
    assert "correct-horse" not in findings[0].evidence


def test_hardcoded_secret_ignores_comments_and_low_entropy_placeholders() -> None:
    source = '''
class Credentials {
    // String password = "real-looking-secret-value";
    String password = "aaaaaaaa";
}
'''

    assert detect_hardcoded_secret(Path("Credentials.java"), source) == []


def test_hardcoded_secret_detects_assignment_after_declaration() -> None:
    source = '''
class Credentials {
    void configure() {
        this.clientSecret = "N7v!p2Qz9Lm4";
    }
}
'''

    findings = detect_hardcoded_secret(Path("Credentials.java"), source)

    assert [(item.line, item.symbol) for item in findings] == [(4, "clientSecret")]


def test_hardcoded_secret_recognizes_provider_key_in_neutral_variable() -> None:
    source = 'class Credentials { String value = "AKIAIOSFODNN7EXAMPLE"; }'

    findings = detect_hardcoded_secret(Path("Credentials.java"), source)

    assert len(findings) == 1
    assert findings[0].symbol == "value"


def test_sql_concat_detects_multiline_runtime_expression_and_method() -> None:
    source = '''
class Users {
    String find(String userId) {
        return "SELECT * FROM users "
            + "WHERE id = "
            + userId;
    }
}
'''

    findings = detect_sql_concat(Path("Users.java"), source)

    assert len(findings) == 1
    assert findings[0].line == 4
    assert findings[0].symbol == "find"
    assert findings[0].measured_value == 1.0
    assert findings[0].threshold == 0.0


def test_sql_concat_ignores_comments_and_literal_only_concatenation() -> None:
    source = '''
class Users {
    // String unsafe = "SELECT * FROM users WHERE id=" + userId;
    String safe = "SELECT * " + "FROM users";
}
'''

    assert detect_sql_concat(Path("Users.java"), source) == []


def test_sql_concat_covers_all_srs_statement_verbs() -> None:
    source = '''
class Queries {
    void run(String value) {
        String a = "INSERT INTO audit VALUES (" + value;
        String b = "UPDATE users SET name=" + value;
        String c = "DELETE FROM users WHERE name=" + value;
    }
}
'''

    findings = detect_sql_concat(Path("Queries.java"), source)

    assert [item.line for item in findings] == [4, 5, 6]
    assert {item.symbol for item in findings} == {"run"}
