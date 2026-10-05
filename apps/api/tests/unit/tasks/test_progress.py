from unittest.mock import Mock, patch

from redis.exceptions import ConnectionError, RedisError

from codesage_api.tasks import progress


@patch("codesage_api.tasks.progress._client")
def test_read_progress_returns_zero_when_redis_is_unavailable(client: Mock) -> None:
    client.return_value.get.side_effect = ConnectionError

    assert progress.read_progress("scan-id") == 0


@patch("codesage_api.tasks.progress._client")
def test_publish_progress_clamps_and_expires_value(client: Mock) -> None:
    progress.publish_progress("scan-id", 140)

    client.return_value.set.assert_called_once_with(
        "codesage:scan:scan-id:progress",
        100,
        ex=progress.KEY_TTL_SECONDS,
    )


@patch("codesage_api.tasks.progress._client")
def test_cancel_flag_is_written_read_and_cleared(client: Mock) -> None:
    client.return_value.get.return_value = "1"

    progress.request_cancel("scan-id")
    assert progress.is_cancel_requested("scan-id") is True
    progress.clear("scan-id")

    client.return_value.set.assert_called_once_with(
        "codesage:scan:scan-id:cancel",
        "1",
        ex=progress.KEY_TTL_SECONDS,
    )
    client.return_value.delete.assert_called_once_with(
        "codesage:scan:scan-id:progress",
        "codesage:scan:scan-id:cancel",
        "codesage:scan:scan-id:stage",
        "codesage:scan:scan-id:waiting",
        "codesage:scan:scan-id:grace",
    )


@patch("codesage_api.tasks.progress._client")
def test_read_status_reads_percent_and_stage_in_one_round_trip(client: Mock) -> None:
    pipe = client.return_value.pipeline.return_value
    pipe.execute.return_value = [
        "31",
        {"stage": "reading_code", "files_done": "120", "files_total": "1240", "typical_seconds": "130"},
        None,  # no Stop pressed
    ]

    reading = progress.read_status("scan-id")

    assert reading == progress.ProgressReading(
        percent=31,
        stage="reading_code",
        step=None,
        files_done=120,
        files_total=1240,
        typical_seconds=130,
    )
    pipe.execute.assert_called_once()


@patch("codesage_api.tasks.progress._client")
def test_read_status_is_empty_not_an_error_when_redis_is_down(client: Mock) -> None:
    client.return_value.pipeline.return_value.execute.side_effect = ConnectionError

    assert progress.read_status("scan-id") == progress.ProgressReading()


@patch("codesage_api.tasks.progress._client")
def test_read_status_ignores_garbage_values(client: Mock) -> None:
    client.return_value.pipeline.return_value.execute.return_value = [
        "not-a-number",
        {"stage": "cloning", "files_done": "x"},
        "garbage",
    ]

    reading = progress.read_status("scan-id")

    assert reading.percent == 0
    assert reading.stage == "cloning"
    assert reading.files_done is None
    assert reading.cancel_requested is False


@patch("codesage_api.tasks.progress._client")
def test_entering_a_stage_without_files_drops_the_old_file_count(client: Mock) -> None:
    pipe = client.return_value.pipeline.return_value

    progress.publish_stage("scan-id", "finding_debt", 60)

    pipe.hdel.assert_called_once_with(
        "codesage:scan:scan-id:stage",
        "step",
        "commits_done",
        "commits_total",
        "files_done",
        "files_total",
    )
    pipe.hset.assert_called_once_with(
        "codesage:scan:scan-id:stage", mapping={"stage": "finding_debt"}
    )
    pipe.set.assert_called_once_with(
        "codesage:scan:scan-id:progress", 60, ex=progress.KEY_TTL_SECONDS
    )


@patch("codesage_api.tasks.progress._client")
def test_a_stage_with_a_file_total_starts_its_count_at_zero(client: Mock) -> None:
    pipe = client.return_value.pipeline.return_value

    progress.publish_stage("scan-id", "reading_code", 25, files_total=1240, typical_seconds=130)

    pipe.hdel.assert_called_once_with(
        "codesage:scan:scan-id:stage", "step", "commits_done", "commits_total"
    )
    pipe.hset.assert_called_once_with(
        "codesage:scan:scan-id:stage",
        mapping={
            "stage": "reading_code",
            "files_total": 1240,
            "files_done": 0,
            "typical_seconds": 130,
        },
    )


@patch("codesage_api.tasks.progress._client")
def test_publishing_a_stage_never_raises_when_redis_is_down(client: Mock) -> None:
    client.return_value.pipeline.return_value.execute.side_effect = ConnectionError

    progress.publish_stage("scan-id", "cloning", 5)
    progress.publish_files_done("scan-id", 3)


@patch("codesage_api.tasks.progress._client")
def test_a_step_with_a_commit_total_drops_the_file_count_in_one_round_trip(
    client: Mock,
) -> None:
    pipe = client.return_value.pipeline.return_value

    progress.publish_step("scan-id", "reading_history", 37, commits_total=1212)

    client.return_value.pipeline.assert_called_once_with(transaction=False)
    pipe.hdel.assert_called_once_with("codesage:scan:scan-id:stage", "files_done", "files_total")
    pipe.hset.assert_called_once_with(
        "codesage:scan:scan-id:stage",
        mapping={"step": "reading_history", "commits_total": 1212, "commits_done": 0},
    )
    pipe.set.assert_called_once_with(
        "codesage:scan:scan-id:progress", 37, ex=progress.KEY_TTL_SECONDS
    )
    pipe.execute.assert_called_once()


@patch("codesage_api.tasks.progress._client")
def test_a_step_without_totals_drops_every_counter(client: Mock) -> None:
    pipe = client.return_value.pipeline.return_value

    progress.publish_step("scan-id", "measuring_code", 25)

    pipe.hdel.assert_called_once_with(
        "codesage:scan:scan-id:stage",
        "commits_done",
        "commits_total",
        "files_done",
        "files_total",
    )
    pipe.hset.assert_called_once_with(
        "codesage:scan:scan-id:stage", mapping={"step": "measuring_code"}
    )


@patch("codesage_api.tasks.progress._client")
def test_publishing_a_step_or_a_count_never_raises_when_redis_is_down(client: Mock) -> None:
    client.return_value.pipeline.return_value.execute.side_effect = ConnectionError
    client.return_value.hset.side_effect = ConnectionError

    progress.publish_step("scan-id", "reading_comments", 52, files_total=10)
    progress.publish_commits_done("scan-id", 3)
    progress.publish_files_done("scan-id", 3)


class _FakeRedis:
    """Just enough of a `decode_responses=True` Redis for a publish/read round trip."""

    def __init__(self) -> None:
        self.strings: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.lists: dict[str, list[str]] = {}

    def pipeline(self, transaction: bool = True) -> "_FakePipeline":
        return _FakePipeline(self)

    def get(self, key: str) -> str | None:
        return self.strings.get(key)

    def set(
        self, key: str, value: object, ex: int | None = None, nx: bool = False
    ) -> bool | None:
        if nx and key in self.strings:
            return None
        self.strings[key] = str(value)
        return True

    def exists(self, *keys: str) -> int:
        return sum(key in self.strings for key in keys)

    def delete(self, *keys: str) -> int:
        gone = 0
        for key in keys:
            gone += self.strings.pop(key, None) is not None
            gone += self.hashes.pop(key, None) is not None
        return gone

    def lrem(self, key: str, count: int, value: str) -> int:
        items = self.lists.get(key, [])
        kept = [item for item in items if item != value]
        self.lists[key] = kept
        return len(items) - len(kept)

    def rpush(self, key: str, *values: str) -> int:
        self.lists.setdefault(key, []).extend(values)
        return len(self.lists[key])

    def hset(
        self,
        key: str,
        field: str | None = None,
        value: object = None,
        mapping: dict[str, object] | None = None,
    ) -> int:
        stored = self.hashes.setdefault(key, {})
        if field is not None:
            stored[field] = str(value)
        for name, item in (mapping or {}).items():
            stored[name] = str(item)
        return 1

    def hdel(self, key: str, *fields: str) -> int:
        stored = self.hashes.get(key, {})
        return sum(stored.pop(name, None) is not None for name in fields)

    def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

    def expire(self, key: str, seconds: int) -> bool:
        return True


class _FakePipeline:
    def __init__(self, redis: _FakeRedis) -> None:
        self._redis = redis
        self._queued: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, name: str):
        def queue(*args, **kwargs):
            self._queued.append((name, args, kwargs))
            return self

        return queue

    def execute(self) -> list:
        queued, self._queued = self._queued, []
        return [getattr(self._redis, name)(*args, **kwargs) for name, args, kwargs in queued]


def test_each_step_reads_back_with_only_its_own_count() -> None:
    """The whole `reading_code` stage, published and read back through one fake
    Redis: each count shows in its own step and nowhere else."""
    fake = _FakeRedis()
    with patch("codesage_api.tasks.progress._client", return_value=fake):
        progress.publish_stage("scan-id", "reading_code", 25, typical_seconds=130)
        progress.publish_step("scan-id", "measuring_code", 25)
        measuring = progress.read_status("scan-id")

        progress.publish_step("scan-id", "reading_history", 37, commits_total=1212)
        progress.publish_commits_done("scan-id", 340)
        history = progress.read_status("scan-id")

        progress.publish_step("scan-id", "reading_comments", 52, files_total=329)
        progress.publish_files_done("scan-id", 214)
        comments = progress.read_status("scan-id")

        progress.publish_stage("scan-id", "finding_debt", 60)
        debt = progress.read_status("scan-id")

    assert measuring == progress.ProgressReading(
        percent=25, stage="reading_code", step="measuring_code", typical_seconds=130
    )
    assert history == progress.ProgressReading(
        percent=37,
        stage="reading_code",
        step="reading_history",
        commits_done=340,
        commits_total=1212,
        typical_seconds=130,
    )
    assert comments == progress.ProgressReading(
        percent=52,
        stage="reading_code",
        step="reading_comments",
        files_done=214,
        files_total=329,
        typical_seconds=130,
    )
    assert debt == progress.ProgressReading(percent=60, stage="finding_debt", typical_seconds=130)


def test_an_uncounted_history_reads_back_without_commit_counts() -> None:
    fake = _FakeRedis()
    with patch("codesage_api.tasks.progress._client", return_value=fake):
        progress.publish_step("scan-id", "reading_history", 37, commits_total=None)
        reading = progress.read_status("scan-id")

    assert reading.step == "reading_history"
    assert (reading.commits_done, reading.commits_total) == (None, None)


@patch("codesage_api.tasks.progress._client")
def test_a_score_is_claimed_for_queueing_once(client: Mock) -> None:
    client.return_value.set.side_effect = [True, None]

    assert progress.claim_score_enqueue("cache-1") is True
    assert progress.claim_score_enqueue("cache-1") is False
    client.return_value.set.assert_called_with(
        "codesage:score:cache-1:queued",
        "1",
        nx=True,
        ex=progress.SCORE_QUEUED_TTL_SECONDS,
    )


@patch("codesage_api.tasks.progress._client")
def test_without_redis_a_score_is_still_queued(client: Mock) -> None:
    client.return_value.set.side_effect = ConnectionError

    assert progress.claim_score_enqueue("cache-1") is True


# ── queued scans: the waiting mark, the grace, and the scan demand ──────────


def test_a_marked_scan_is_waiting_and_an_unmarked_one_is_not() -> None:
    fake = _FakeRedis()
    with patch("codesage_api.tasks.progress._client", return_value=fake):
        progress.mark_waiting("held", 120)

        assert progress.is_waiting("held") is True
        assert progress.is_waiting("dropped") is False


@patch("codesage_api.tasks.progress._client")
def test_unknown_is_never_read_as_lost(client: Mock) -> None:
    """Redis down must not end every queued scan in the workspace."""
    client.return_value.exists.side_effect = RedisError("down")

    assert progress.is_waiting("scan") is None
    assert progress.is_lost("scan", 120) is False


def test_a_missing_mark_gets_one_heartbeat_of_grace_before_the_scan_is_lost() -> None:
    """A deploy or a Redis restart drops marks while workers still hold their
    scans; the first sighting re-marks it, and only a second one ends it."""
    fake = _FakeRedis()
    with patch("codesage_api.tasks.progress._client", return_value=fake):
        assert progress.is_lost("scan", 120) is False
        # The grace put the mark back: a worker has a heartbeat to renew it.
        assert progress.is_waiting("scan") is True

        fake.strings.pop(progress.WAITING_KEY.format(attempt_id="scan"))
        assert progress.is_lost("scan", 120) is True


def test_a_scan_a_worker_keeps_marking_is_never_lost() -> None:
    fake = _FakeRedis()
    with patch("codesage_api.tasks.progress._client", return_value=fake):
        for _ in range(5):
            progress.mark_waiting("scan", 120)
            assert progress.is_lost("scan", 120) is False


def test_clearing_an_attempt_drops_its_waiting_mark_and_grace() -> None:
    fake = _FakeRedis()
    with patch("codesage_api.tasks.progress._client", return_value=fake):
        progress.mark_waiting("scan", 120)
        progress.is_lost("scan", 120)
        progress.clear("scan")

    assert fake.strings == {}


def test_the_scan_demand_holds_each_workspace_as_many_times_as_it_has_slots() -> None:
    fake = _FakeRedis()
    with patch("codesage_api.tasks.progress._client", return_value=fake):
        progress.sync_scan_demand("ws-a", 1)
        progress.sync_scan_demand("ws-b", 2)
        progress.sync_scan_demand("ws-a", 1)  # again: replaced, not added

        assert sorted(fake.lists[progress.SCAN_DEMAND_KEY]) == ["ws-a", "ws-b", "ws-b"]

        progress.sync_scan_demand("ws-b", 0)

    assert fake.lists[progress.SCAN_DEMAND_KEY] == ["ws-a"]


def test_a_stop_flag_reads_back_with_the_status() -> None:
    fake = _FakeRedis()
    with patch("codesage_api.tasks.progress._client", return_value=fake):
        progress.publish_stage("scan", "reading_code", 25)
        before = progress.read_status("scan")
        progress.request_cancel("scan")
        after = progress.read_status("scan")

    assert before.cancel_requested is False
    assert after.cancel_requested is True
