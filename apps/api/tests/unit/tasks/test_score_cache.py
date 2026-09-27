from __future__ import annotations

import uuid
from contextlib import contextmanager
from unittest.mock import MagicMock

from sqlalchemy.orm import Session

from codesage_api.tasks import score_cache


def test_score_worker_sets_tenant_context_before_reading_cache(monkeypatch) -> None:
    workspace_id = uuid.uuid4()
    session = MagicMock(spec=Session)
    tenant_is_bound = False

    def bind_tenant(_session: Session, requested_workspace: uuid.UUID) -> None:
        nonlocal tenant_is_bound
        assert _session is session
        assert requested_workspace == workspace_id
        tenant_is_bound = True

    def tenant_filtered_get(_model, _cache_id):
        assert tenant_is_bound, "worker queried before applying tenant RLS context"
        # This is how PostgreSQL/RLS presents a cache owned by another tenant.

    @contextmanager
    def scoped_session():
        yield session

    session.get.side_effect = tenant_filtered_get
    monkeypatch.setattr(score_cache, "set_workspace_context", bind_tenant)
    monkeypatch.setattr(score_cache, "session_scope", scoped_session)
    calculate = MagicMock()
    monkeypatch.setattr(score_cache.dashboard, "calculate_snapshot_score", calculate)

    score_cache.score_snapshot.run(
        str(uuid.uuid4()),
        str(workspace_id),
        {"weights": {}, "trust": 0.5, "name": "Balanced"},
    )

    assert tenant_is_bound is True
    calculate.assert_not_called()


def test_warming_a_new_snapshot_never_hydrates_it(monkeypatch) -> None:
    """The prepare step reads the snapshot row alone. Hydrating every fact of a
    large repository here took ~40 s on apache/dubbo, before scoring began."""
    session = MagicMock(spec=Session)
    snapshot = MagicMock(id=uuid.uuid4())

    @contextmanager
    def scoped_session():
        yield session

    monkeypatch.setattr(score_cache, "set_workspace_context", MagicMock())
    monkeypatch.setattr(score_cache, "session_scope", scoped_session)
    hydrate = MagicMock()
    monkeypatch.setattr(score_cache.dashboard_repository, "get_snapshot_for_scoring", hydrate)
    monkeypatch.setattr(
        score_cache.dashboard_repository, "find_done_snapshot", MagicMock(return_value=snapshot)
    )
    monkeypatch.setattr(
        score_cache.dashboard_repository,
        "repository_id_for_snapshot",
        MagicMock(return_value=uuid.uuid4()),
    )
    monkeypatch.setattr(score_cache.profiles, "resolve_effective", MagicMock())
    monkeypatch.setattr(score_cache, "profile_payload", MagicMock(return_value={}))
    cached = MagicMock(id=uuid.uuid4(), status="pending", started_at=None)
    monkeypatch.setattr(
        score_cache.dashboard, "prepare_snapshot_score", MagicMock(return_value=(cached, True))
    )
    monkeypatch.setattr(score_cache.dashboard.progress, "claim_score_enqueue", lambda _id: True)
    delay = MagicMock()
    monkeypatch.setattr(score_cache.score_snapshot, "delay", delay)

    score_cache.warm_snapshot_score.run(str(snapshot.id), str(uuid.uuid4()))

    hydrate.assert_not_called()
    delay.assert_called_once()


def test_a_profile_change_queues_the_newest_snapshot_first(monkeypatch) -> None:
    """One scoring worker takes jobs in queue order, ~38 s each on a large
    repository. Queued oldest first, the snapshot the dashboard shows waited
    behind every old one and the dashboard gave up."""
    from types import SimpleNamespace

    session = MagicMock(spec=Session)
    workspace_id = uuid.uuid4()
    repository = SimpleNamespace(
        id=uuid.uuid4(), branches=[SimpleNamespace(name="main", is_default=True)]
    )
    session.scalars.return_value.all.return_value = [repository]
    # The repository layer answers oldest first.
    oldest, middle, newest = (SimpleNamespace(id=uuid.uuid4()) for _ in range(3))

    @contextmanager
    def scoped_session():
        yield session

    monkeypatch.setattr(score_cache, "set_workspace_context", MagicMock())
    monkeypatch.setattr(score_cache, "session_scope", scoped_session)
    monkeypatch.setattr(score_cache.profiles, "load_pool", MagicMock())
    monkeypatch.setattr(score_cache.profiles, "to_scoring_profile", MagicMock())
    monkeypatch.setattr(score_cache, "profile_payload", MagicMock(return_value={}))
    monkeypatch.setattr(
        score_cache.dashboard_repository,
        "list_completed_snapshot_refs",
        MagicMock(return_value=[oldest, middle, newest]),
    )
    monkeypatch.setattr(
        score_cache.dashboard,
        "prepare_snapshot_score",
        lambda _session, ref, _profile: (SimpleNamespace(id=ref.id), True),
    )
    monkeypatch.setattr(score_cache.dashboard, "needs_enqueue", lambda cached, created: True)

    jobs = score_cache._warm(workspace_id, None)

    assert [cache_id for cache_id, _ in jobs] == [
        str(newest.id),
        str(middle.id),
        str(oldest.id),
    ]

    # And the task sends them to the worker in that same order.
    delay = MagicMock()
    monkeypatch.setattr(score_cache.score_snapshot, "delay", delay)
    score_cache.warm_workspace_scores.run(str(workspace_id))
    assert [call.args[0] for call in delay.call_args_list] == [
        str(newest.id),
        str(middle.id),
        str(oldest.id),
    ]
