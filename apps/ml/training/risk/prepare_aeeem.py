"""Prepare the five-project D'Ambros/AEEEM mirror for ML-2 training.

The source directory is expected to contain the semicolon-delimited Equinox,
JDT, Lucene, Mylyn, and PDE CSV files distributed by the Large Defect Prediction
Benchmark. Raw datasets remain ignored; this script makes the processed training
input and its checksum reproducible.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import pandas as pd

EXPECTED_PROJECTS = {"equinox", "jdt", "lucene", "mylyn", "pde"}
REQUIRED_COLUMNS = {
    "classname",
    "numberOfAuthorsUntil",
    "ageWithRespectTo",
    "bugs",
}


def prepare(source_dir: Path, output_path: Path) -> str:
    files = sorted(source_dir.glob("*.csv"))
    projects = {path.stem for path in files}
    if projects != EXPECTED_PROJECTS:
        raise ValueError(
            f"Expected AEEEM projects {sorted(EXPECTED_PROJECTS)}, got {sorted(projects)}"
        )

    frames: list[pd.DataFrame] = []
    for path in files:
        source = pd.read_csv(path, sep=";")
        source.columns = [str(column).strip().rstrip(":") for column in source.columns]
        missing = REQUIRED_COLUMNS - set(source.columns)
        if missing:
            raise ValueError(f"{path.name} is missing columns: {sorted(missing)}")

        frames.append(
            pd.DataFrame(
                {
                    "class_name": source["classname"].str.strip(),
                    "project_name": path.stem,
                    "author_count": pd.to_numeric(
                        source["numberOfAuthorsUntil"], errors="raise"
                    ),
                    # AEEEM defines ageWithRespectTo in weeks backward from the
                    # release. Preserve that unit explicitly in the prepared data.
                    "file_age_weeks": pd.to_numeric(
                        source["ageWithRespectTo"], errors="raise"
                    ),
                    "bugs": pd.to_numeric(source["bugs"], errors="raise"),
                }
            )
        )

    prepared = pd.concat(frames, ignore_index=True)
    if len(prepared) != 5_371:
        raise ValueError(f"Expected 5,371 AEEEM classes, got {len(prepared):,}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    prepared.to_csv(output_path, index=False)
    return hashlib.sha256(output_path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data" / "raw" / "dambros_aeeem.csv",
    )
    args = parser.parse_args()
    checksum = prepare(args.source_dir, args.output)
    print(f"Prepared {args.output} (SHA-256: {checksum})")


if __name__ == "__main__":
    main()
