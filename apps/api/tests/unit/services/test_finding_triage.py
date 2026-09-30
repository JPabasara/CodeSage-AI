from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from codesage_api.errors import NotFound, ValidationFailed
from codesage_api.services import audit, finding_triage


def _session(*, finding_exists: bool = True, stored_status: str | None = None) -> MagicMock:
    session = MagicMock(spec=Session)
    session.scalar.side_effect = [uuid.uuid4() if finding_exists else None, stored_status]
    return session


def _set(session: MagicMock, status: str) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    workspace_id, snapshot_id, user_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    finding_triage.set_status(
        session,
        workspace_id=workspace_id,
        snapshot_id=snapshot_id,
        fingerprint="abc123",
        status=status,
        actor_user_id=user_id,
    )
    return workspace_id, snapshot_id, user_id


@pytest.mark.parametrize("status", ["accepted", "resolved", "false-positive", "DONE", ""])
def test_only_open_and_done_can_be_set(status: str) -> None:
    session = _session()

    with pytest.raises(ValidationFailed):
        _set(session, status)

    session.scalar.assert_not_called()
    session.execute.assert_not_called()


def test_an_unknown_finding_is_not_found() -> None:
    session = _session(finding_exists=False)

    with pytest.raises(NotFound):
        _set(session, "done")

    session.execute.assert_not_called()


def test_marking_done_upserts_and_audits(monkeypatch) -> None:
    session = _session()
    record = MagicMock()
    monkeypatch.setattr(audit, "record", record)

    workspace_id, snapshot_id, user_id = _set(session, "done")

    statement = session.execute.call_args.args[0]
    compiled = statement.compile(dialect=postgresql.dialect())
    assert "ON CONFLICT (snapshot_id, fingerprint) DO UPDATE" in str(compiled)
    assert compiled.params["status"] == "done"
    assert compiled.params["updated_by_user_id"] == user_id
    record.assert_called_once_with(
        session,
        event_type="finding_status_changed",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=user_id,
        resource_type="finding",
        resource_id=f"{snapshot_id}:abc123",
        detail={"from": "open", "to": "done"},
    )


def test_reopening_records_the_previous_status(monkeypatch) -> None:
    session = _session(stored_status="done")
    record = MagicMock()
    monkeypatch.setattr(audit, "record", record)

    _set(session, "open")

    session.execute.assert_called_once()
    assert record.call_args.kwargs["detail"] == {"from": "done", "to": "open"}


@pytest.mark.parametrize(("stored", "requested"), [(None, "open"), ("done", "done")])
def test_an_unchanged_status_writes_nothing(monkeypatch, stored, requested) -> None:
    session = _session(stored_status=stored)
    record = MagicMock()
    monkeypatch.setattr(audit, "record", record)

    _set(session, requested)

    session.execute.assert_not_called()
    record.assert_not_called()


def test_statuses_for_snapshot_maps_fingerprints() -> None:
    session = MagicMock(spec=Session)
    session.execute.return_value.all.return_value = [("a", "done"), ("b", "done")]

    assert finding_triage.statuses_for_snapshot(session, uuid.uuid4()) == {
        "a": "done",
        "b": "done",
    }
