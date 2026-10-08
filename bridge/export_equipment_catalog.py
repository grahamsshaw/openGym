"""Export the researched Technogym equipment catalog to JSON.

Reads the Flask project's SQLite database (``fitness.db``: ``equipment``
plus ``equipment_profiles``) and writes ``equipment_catalog.json``: every
machine with its program modes, muscles used and details. This is the seed
for two things in the new project:

- cardio program enrichment (a Technogym session says "20 min treadmill";
  the catalog says which programs that machine offers, grounding the
  rough program inference described in
  ``documentation/TECHNOGYM-PROGRAMS.md``);
- the QR mapping table (``qr_mapping.json``): machine → openGym exercise.

Usage::

    py bridge/export_equipment_catalog.py --db <path to fitness.db> --out bridge/
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def main() -> None:
    """CLI entry point: dump equipment + profiles to JSON."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Path to fitness.db")
    parser.add_argument("--out", required=True, help="Output folder")
    args = parser.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    machines = []
    for row in db.execute("SELECT * FROM equipment ORDER BY name"):
        profile = db.execute(
            "SELECT * FROM equipment_profiles WHERE equipment_id = ?",
            (row["id"],),
        ).fetchone()

        def _json(text):
            try:
                return json.loads(text) if text else []
            except (ValueError, TypeError):
                return []

        machines.append({
            "name": row["name"],
            "manufacturer": row["manufacturer"],
            "category": row["category"],
            "program_modes": _json(profile["program_modes"]) if profile else [],
            "muscles_used": _json(profile["muscles_used"]) if profile else [],
            "details": profile["details"] if profile else None,
        })
    db.close()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "equipment_catalog.json", "w", encoding="utf-8") as fh:
        json.dump(machines, fh, indent=2, ensure_ascii=False)
    print(f"machines: {len(machines)}")


if __name__ == "__main__":
    main()
