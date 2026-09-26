from unittest.mock import Mock, patch

from redis.exceptions import ConnectionError

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
    )


@patch("codesage_api.tasks.progress._client")
def test_read_status_reads_percent_and_stage_in_one_round_trip(client: Mock) -> None:
    pipe = client.return_value.pipeline.return_value
    pipe.execute.return_value = [
        "31",
        {"stage": "reading_code", "files_done": "120", "files_total": "1240", "typical_seconds": "130"},
    ]

    reading = progress.read_status("scan-id")

    assert reading == progress.ProgressReading(
        percent=31,
        stage="reading_code",
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
    ]

    reading = progress.read_status("scan-id")

    assert reading.percent == 0
    assert reading.stage == "cloning"
    assert reading.files_done is None


@patch("codesage_api.tasks.progress._client")
def test_entering_a_stage_without_files_drops_the_old_file_count(client: Mock) -> None:
    pipe = client.return_value.pipeline.return_value

    progress.publish_stage("scan-id", "finding_debt", 60)

    pipe.hdel.assert_called_once_with("codesage:scan:scan-id:stage", "files_done", "files_total")
    pipe.hset.assert_called_once_with(
        "codesage:scan:scan-id:stage", mapping={"stage": "finding_debt"}
    )
    pipe.set.assert_called_once_with(
        "codesage:scan:scan-id:progress", 60, ex=progress.KEY_TTL_SECONDS
    )


@patch("codesage_api.tasks.progress._client")
def test_reading_code_starts_its_file_count_at_zero(client: Mock) -> None:
    pipe = client.return_value.pipeline.return_value

    progress.publish_stage("scan-id", "reading_code", 25, files_total=1240, typical_seconds=130)

    pipe.hdel.assert_not_called()
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
