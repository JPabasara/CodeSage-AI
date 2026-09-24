from __future__ import annotations

from codesage_api.detection.fingerprint import satd_fingerprint, unique_in_file_order


def test_unique_fingerprints_leave_distinct_ones_alone() -> None:
    items = [("a", "A.java", 1), ("b", "A.java", 2), ("c", "B.java", 1)]
    assert unique_in_file_order(items) == ["a", "b", "c"]


def test_a_repeated_comment_gets_one_id_per_line_and_the_first_keeps_its_own() -> None:
    same = satd_fingerprint("A.java", "// Unused type parameter for test")
    items = [(same, "A.java", line) for line in (107, 112, 117, 122, 127)]

    unique = unique_in_file_order(items)

    assert len(set(unique)) == 5
    # The first occurrence is unchanged, so history across scans still lines up.
    assert unique[0] == same


def test_the_ids_follow_line_order_not_input_order() -> None:
    same = satd_fingerprint("A.java", "// TODO")
    in_order = unique_in_file_order([(same, "A.java", 10), (same, "A.java", 20)])
    reversed_input = unique_in_file_order([(same, "A.java", 20), (same, "A.java", 10)])

    # The line-10 comment gets the same id however the findings arrive.
    assert reversed_input == [in_order[1], in_order[0]]
    assert unique_in_file_order([(same, "A.java", 10), (same, "A.java", 20)]) == in_order
