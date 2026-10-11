"""Export the QR mapping table for the app bundle.

Reads ``bridge/qr_mapping.json`` (machine identities decoded from gym
scans, program modes from the researched catalog) and writes
``frontend/src/lib/equipment-qr.json``: the file the in-app scanner
resolves against. The ``eq`` field names the catalogue equipment tag used
to preset the exercise picker — null where the catalogue has no such tag
(treadmills and rowers), in which case the machine sheet still offers
program modes with a free picker.

Usage::

    py bridge/export_qr.py

Run again after any qr_mapping.json edit; the output is committed so the
app (including the offline phone build) always carries it.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: Catalogue equipment tag per machine, where one exists. Treadmills and
#: rowers have no catalogue tag (verified against all 6,554 entries), so
#: those stay null and the sheet offers modes with a free picker instead
#: of a preset that would narrow to nothing.
EQ = {
    "Bike Excite Live": "stationary bike",
    "Synchro Excite Live": "elliptical machine",
    "Climb Excite Live": "stepmill machine",
}


def main() -> None:
    """CLI entry point: mapping table in, app bundle data out."""
    mapping = json.loads((ROOT / "bridge" / "qr_mapping.json").read_text(encoding="utf-8"))
    machines = []
    for entry in mapping:
        # Only identified machines ship: a model code or recorded serials.
        # Strength machines without QRs stay out of the resolver (nothing
        # could ever match them), as does the "Activities" pseudo-row.
        if not entry.get("model_code") and not entry.get("serials"):
            continue
        machines.append({
            "machine": entry["machine"],
            "model_code": entry.get("model_code"),
            "serials": entry.get("serials", []),
            "eq": EQ.get(entry["machine"]),
            "program_modes": entry.get("program_modes", []),
            "console_routines": entry.get("console_routines", []),
        })
    out = ROOT / "frontend" / "src" / "lib" / "equipment-qr.json"
    # One entry per model code: "Run Excite Live" and "Treadmill" describe
    # the same hardware, so the fuller program list wins and the scanner
    # never offers the same machine twice.
    by_model: dict = {}
    for machine in machines:
        key = machine["model_code"] or machine["machine"]
        if key not in by_model or len(machine["program_modes"]) > len(by_model[key]["program_modes"]):
            by_model[key] = machine
    machines = list(by_model.values())
    out.write_text(json.dumps({"version": 1, "machines": machines},
                              indent=2, ensure_ascii=False),
                   encoding="utf-8")
    print(f"machines: {len(machines)} -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
