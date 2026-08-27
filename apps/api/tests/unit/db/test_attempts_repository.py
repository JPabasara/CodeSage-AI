from __future__ import annotations

from unittest.mock import MagicMock

from codesage_api.db.repositories.attempts import (
    ENGINE_TOOL_VERSIONS,
    ENGINE_VERSION_IDENTIFIER,
    get_or_create_engine_version,
)


def test_new_engine_version_records_reproducible_extraction_toolchain() -> None:
    session = MagicMock()
    session.scalar.return_value = None

    version = get_or_create_engine_version(session)

    assert version.version_identifier == ENGINE_VERSION_IDENTIFIER == "codesage-v2"
    assert version.tool_versions == {"ck": "0.7.0", "pydriller": "2.10"}
    assert version.extraction_logic_version == "v2"
    session.add.assert_called_once_with(version)
    session.flush.assert_called_once_with()


def test_existing_engine_version_is_reused() -> None:
    session = MagicMock()
    existing = object()
    session.scalar.return_value = existing

    assert get_or_create_engine_version(session) is existing
    session.add.assert_not_called()
    session.flush.assert_not_called()


def test_engine_tool_versions_are_copied_into_each_record() -> None:
    session = MagicMock()
    session.scalar.return_value = None

    version = get_or_create_engine_version(session)
    version.tool_versions["ck"] = "changed"

    assert ENGINE_TOOL_VERSIONS["ck"] == "0.7.0"
