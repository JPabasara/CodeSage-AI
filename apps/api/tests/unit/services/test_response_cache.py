from __future__ import annotations

from codesage_api.schemas import FindingPageOut, HealthReportOut
from codesage_api.services.response_cache import ResponseCache, etag_for, matches


def test_least_recently_used_bytes_go_first() -> None:
    cache = ResponseCache(max_bytes=40)
    cache.put("a", b"x" * 10)
    cache.put("b", b"x" * 10)
    cache.put("c", b"x" * 10)
    assert cache.get("a") is not None  # now the most recent

    cache.put("d", b"x" * 10)
    cache.put("e", b"x" * 10)

    assert cache.get("b") is None
    assert cache.get("a") is not None
    assert cache.size <= 40


def test_one_response_cannot_take_more_than_a_quarter() -> None:
    cache = ResponseCache(max_bytes=40)
    cache.put("big", b"x" * 11)

    assert cache.get("big") is None
    assert cache.size == 0


def test_replacing_a_key_keeps_the_size_honest() -> None:
    cache = ResponseCache(max_bytes=100)
    cache.put("a", b"x" * 20)
    cache.put("a", b"x" * 5)

    assert cache.size == 5


def test_a_zero_sized_cache_stores_nothing() -> None:
    cache = ResponseCache(max_bytes=0)
    cache.put("a", b"x")

    assert cache.get("a") is None


def test_etag_depends_on_every_part_and_on_the_response_shape() -> None:
    base = etag_for(HealthReportOut, ["cache-1", 3])

    assert base == etag_for(HealthReportOut, ["cache-1", 3])
    assert base != etag_for(HealthReportOut, ["cache-1", 4])
    assert base != etag_for(FindingPageOut, ["cache-1", 3])
    assert base.startswith('"') and base.endswith('"')


def test_if_none_match_handles_lists_weak_tags_and_star() -> None:
    etag = '"abc"'

    assert matches('"abc"', etag)
    assert matches('"zzz", "abc"', etag)
    assert matches('W/"abc"', etag)
    assert matches("*", etag)
    assert not matches('"zzz"', etag)
    assert not matches(None, etag)
    assert not matches("", etag)
