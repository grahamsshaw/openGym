"""Merge bridge workout CSVs into one import file.

openGym groups imported rows by DATE (see ``import-csv.js``: ``byDate``),
but skips whole days that already hold a workout
(``mergeImport`` filters on existing dates). Importing sources as separate
files therefore drops the second source's rows on shared days — verified:
6 phone sessions lost on a day the Technogym file had already claimed.

One combined file keeps every row: same-day rows from all sources merge
into that day's workout instead of competing for it. Row order is stable
(sorted by date, Technogym rows before phone rows within a day) so the
workout takes the gym session's name.

Usage::

    py bridge/merge_workout_csvs.py --inputs opengym_workouts.csv opengym_phone_sessions.csv --out opengym_combined.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

#: The shared header every bridge workout CSV is written with.
FIELDNAMES = [
    "workout name", "exercise", "date", "start time",
    "duration seconds", "distance km", "note",
]


def main() -> None:
    """CLI entry point: concatenate CSVs, date-sorted, stable order."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", nargs="+", required=True, help="Workout CSVs in priority order")
    parser.add_argument("--out", required=True, help="Combined CSV path")
    args = parser.parse_args()

    rows: list[dict] = []
    for path in args.inputs:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            missing = [name for name in FIELDNAMES if name not in (reader.fieldnames or [])]
            if missing:
                raise SystemExit(f"{path}: missing columns {missing}")
            rows.extend(list(reader))

    rows.sort(key=lambda row: (row["date"], row["start time"] or ""))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    print(f"files: {len(args.inputs)}, rows: {len(rows)} -> {out.name}")


if __name__ == "__main__":
    main()
