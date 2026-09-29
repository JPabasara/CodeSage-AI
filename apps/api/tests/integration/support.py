"""Helpers shared by the real-PostgreSQL tests."""

from __future__ import annotations

import hashlib
import secrets
import uuid

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

# Every foreign key in the public schema, one row per constraint column pair.
_FOREIGN_KEYS = text(
    """
    SELECT c.conname,
           c.conrelid::regclass::text  AS child,
           c.confrelid::regclass::text AS parent,
           array_agg(ca.attname ORDER BY k.ord) AS child_columns,
           array_agg(pa.attname ORDER BY k.ord) AS parent_columns
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(child_col, parent_col, ord)
    JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.child_col
    JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.parent_col
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
    GROUP BY c.conname, c.conrelid, c.confrelid
    ORDER BY child, c.conname
    """
)


def token_hash(raw_token: str) -> bytes:
    return hashlib.sha256(raw_token.encode("utf-8")).digest()


def new_session_token() -> tuple[str, bytes]:
    """A raw cookie value and the digest the session row stores."""
    raw = secrets.token_urlsafe(32)
    return raw, token_hash(raw)


def session_cookie(engine: Engine, session_id: uuid.UUID) -> str:
    """Give an existing session a known token and return the cookie for it.

    The raw token exists only in the sign-in response, so tests that hold a
    session id mint a fresh one (DBR-29). The old token stops working.
    """
    raw, digest = new_session_token()
    with engine.begin() as db:
        updated = db.execute(
            text("UPDATE session SET token_hash = :digest WHERE id = :id"),
            {"digest": digest, "id": session_id},
        ).rowcount
    assert updated == 1, f"no session {session_id}"
    return raw


def orphan_counts(db: Connection) -> dict[str, int]:
    """Rows whose non-null foreign key points at nothing, per constraint."""
    counts: dict[str, int] = {}
    for fk in db.execute(_FOREIGN_KEYS):
        joined = " AND ".join(
            f'p."{parent}" = c."{child}"'
            for child, parent in zip(fk.child_columns, fk.parent_columns, strict=True)
        )
        present = " AND ".join(f'c."{child}" IS NOT NULL' for child in fk.child_columns)
        counts[f"{fk.child}.{fk.conname}"] = db.scalar(
            text(
                f"SELECT count(*) FROM {fk.child} c LEFT JOIN {fk.parent} p ON {joined} "
                f'WHERE {present} AND p."{fk.parent_columns[0]}" IS NULL'
            )
        )
    return counts


def assert_no_orphans(db: Connection) -> None:
    """Fail if any foreign key anywhere is dangling (DBR-28).

    PostgreSQL enforces foreign keys, so this can only fail if one is disabled,
    deferred past commit, or missing a cascade that a trigger was meant to do.
    Run it as a superuser: row-level security would hide parents otherwise.
    """
    orphans = {name: count for name, count in orphan_counts(db).items() if count}
    assert not orphans, f"dangling references: {orphans}"


def table_row_counts(db: Connection, tables: list[str] | None = None) -> dict[str, int]:
    names = tables or list(
        db.scalars(
            text(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                "ORDER BY tablename"
            )
        )
    )
    return {name: db.scalar(text(f'SELECT count(*) FROM "{name}"')) for name in names}


def table_checksum(db: Connection, table: str) -> str:
    """Order-independent digest of a table's full contents."""
    return db.scalar(
        text(
            f'SELECT md5(coalesce(string_agg(t::text, \'|\' ORDER BY t::text), \'\')) '
            f'FROM "{table}" t'
        )
    )
