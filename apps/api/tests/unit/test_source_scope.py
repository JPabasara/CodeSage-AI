from codesage_api.source_scope import classify_source_scope


def test_classifies_standard_java_test_path():
    assert (
        classify_source_scope("module/src/test/java/com/acme/ThingTest.java")
        == "test"
    )


def test_production_override_wins_over_test_pattern():
    path = "module/src/testFixtures/java/com/acme/Fixture.java"
    assert (
        classify_source_scope(
            path,
            ["**/src/testFixtures/**"],
            ["**/src/testFixtures/**"],
        )
        == "production"
    )


def test_preserves_other_source_scopes():
    assert classify_source_scope("src/main/java/com/acme/App.java") == "production"
    assert classify_source_scope("target/generated/Foo.java") == "generated"
    assert classify_source_scope("examples/Foo.java") == "example"
    assert classify_source_scope("misc/Foo.java") == "unknown"
