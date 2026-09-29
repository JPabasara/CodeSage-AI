"""Trace findings between immutable snapshots using their stable fingerprints."""

from __future__ import annotations

from dataclasses import dataclass

from codesage_api.db.models import Snapshot


@dataclass(frozen=True, slots=True)
class FindingDiff:
    new: frozenset[str]
    unchanged: frozenset[str]
    resolved: frozenset[str]


def _fingerprints(snapshot: Snapshot | None) -> frozenset[str]:
    if snapshot is None:
        return frozenset()
    return frozenset(
        finding.fingerprint
        for source_file in snapshot.source_files
        for location in source_file.source_locations
        for finding in location.findings
    )


def diff_snapshots(current: Snapshot, previous: Snapshot | None) -> FindingDiff:
    """Return set-based traceability; a first scan contains only new findings."""
    current_set = _fingerprints(current)
    previous_set = _fingerprints(previous)
    return FindingDiff(
        new=current_set - previous_set,
        unchanged=current_set & previous_set,
        resolved=previous_set - current_set,
    )
