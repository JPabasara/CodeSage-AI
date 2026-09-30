from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from codesage_api.config import get_settings

logger = logging.getLogger(__name__)
_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional session for worker code. Request handlers use `deps.get_db`."""
    session = SessionLocal()
    failed = False
    try:
        yield session
        session.commit()
    except Exception:
        failed = True
        try:
            session.rollback()
        except Exception:
            logger.exception("Session rollback failed; preserving original exception")
        raise
    finally:
        try:
            session.close()
        except Exception:
            if not failed:
                raise
            logger.exception("Session close failed; preserving original exception")
