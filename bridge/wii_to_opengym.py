"""Convert Wii Fit Plus save files to an openGym weigh-ins CSV.

Reads decrypted ``FitPlus*.dat`` profile files and writes one
``opengym_weighins.csv`` (``date,weight``) per Body Test entry. openGym
keeps one weigh-in per day on import, so exporting every entry is safe.

Binary layout (ported from the Flask project's
``fitness_app/importers/wii_fit.py`` — our own code, documented there
against real save files; only the database calls were left behind):

- 8-byte ``RPHE`` signature, then fixed 0x9281-byte Mii/profile records.
- Body Test entries at +0x38A1, 21 bytes each: packed date (year at bits
  20-30, month 0-based at bits 16-19), weight kg x10, BMI x100, balance.
- Entries end at the first zero year. ``FitPlus2.dat`` (``RFP`` signature)
  holds no profiles and is skipped with a note, not an error.

Usage::

    py bridge/wii_to_opengym.py --input <folder with FitPlus*.dat> --out bridge/out
"""

from __future__ import annotations

import argparse
import csv
import struct
from datetime import datetime
from pathlib import Path

RECORD_LENGTH = 0x9281
BODY_TEST_OFFSET = 0x38A1
ROW_LENGTH = 21
MAX_BODY_TEST_ENTRIES = 256


def parse_date(packed: int) -> datetime | None:
    """Unpack a Wii Body Test date bitfield (see module docstring)."""
    year = (packed >> 20) & 0x7FF
    month = ((packed >> 16) & 0xF) + 1
    day = (packed >> 11) & 0x1F
    hour = (packed >> 6) & 0x1F
    minute = packed & 0x3F
    if year == 0:
        return None
    try:
        return datetime(year, month, day, hour, minute)
    except ValueError:
        return None


def parse_file(path: Path) -> list[dict]:
    """Return ``{"date", "weight", "bmi"}`` rows from one .dat file."""
    rows: list[dict] = []
    size = path.stat().st_size
    with open(path, "rb") as fh:
        header = fh.read(8)
        if header[:4] != b"RPHE":
            if header[:3] == b"RFP":
                return []  # non-profile block, nothing to export
            raise ValueError(f"not a Wii Fit save file: {path.name}")
        slots = size // RECORD_LENGTH + 1
        for index in range(slots):
            start = index * RECORD_LENGTH
            if start + BODY_TEST_OFFSET >= size:
                break
            fh.seek(start + BODY_TEST_OFFSET)
            for _ in range(MAX_BODY_TEST_ENTRIES):
                row = fh.read(ROW_LENGTH)
                if len(row) < 10:
                    break
                packed, weight_raw, _bmi_raw, _bal = struct.unpack(">i3H", row[0:10])
                measured = parse_date(packed)
                if measured is None:
                    break
                rows.append({
                    "date": measured.strftime("%Y-%m-%d"),
                    "weight": weight_raw / 10.0,
                })
    return rows


def main() -> None:
    """CLI entry point: read .dat files, write the weigh-ins CSV."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Folder with FitPlus*.dat")
    parser.add_argument("--out", required=True, help="Output folder for CSVs")
    args = parser.parse_args()

    src = Path(args.input)
    files = sorted(src.glob("FitPlus*.dat"))
    if not files:
        raise SystemExit(f"no FitPlus*.dat in {src}")

    rows: list[dict] = []
    for path in files:
        try:
            rows.extend(parse_file(path))
        except ValueError as exc:
            print(f"skip: {exc}")

    # One weigh-in per day is what openGym keeps; keep the first per date.
    seen: dict[str, dict] = {}
    for row in rows:
        seen.setdefault(row["date"], row)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "opengym_wii_weighins.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["date", "weight"])
        writer.writeheader()
        writer.writerows(seen[day] for day in sorted(seen))

    print(f"files: {len(files)}, entries: {len(rows)}, days: {len(seen)}")


if __name__ == "__main__":
    main()
