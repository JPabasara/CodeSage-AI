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
    )
