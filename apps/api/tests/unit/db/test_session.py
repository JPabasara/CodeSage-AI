from unittest.mock import Mock, patch

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from codesage_api.db.session import session_scope


def test_session_preserves_timeout_when_rollback_and_close_fail() -> None:
    session = Mock()
    session.rollback.side_effect = RuntimeError("rollback failed")
    session.close.side_effect = RuntimeError("close failed")
    timeout = SoftTimeLimitExceeded()

    with (
        patch("codesage_api.db.session.SessionLocal", return_value=session),
        pytest.raises(SoftTimeLimitExceeded) as caught,
        session_scope(),
    ):
        raise timeout

    assert caught.value is timeout
    session.rollback.assert_called_once()
    session.close.assert_called_once()
    session.commit.assert_not_called()


def test_session_does_not_hide_close_failure_after_success() -> None:
    session = Mock()
    session.close.side_effect = RuntimeError("close failed")
    with (
        patch("codesage_api.db.session.SessionLocal", return_value=session),
        pytest.raises(RuntimeError, match="close failed"),
        session_scope(),
    ):
        pass
    session.commit.assert_called_once()
