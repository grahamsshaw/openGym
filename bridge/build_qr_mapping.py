"""Build the QR mapping skeleton from the equipment catalog.

Reads ``bridge/equipment_catalog.json`` and writes ``bridge/qr_mapping.json``:
one entry per machine with ``qr_payload`` null (filled after real scans —
see ``documentation/QR-PLAN.md``), suggested openGym exercise names and the
machine's program modes. Re-run after any catalog change; entries with a
recorded payload are preserved.

Usage::

    py bridge/build_qr_mapping.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    """CLI entry point: catalog in, mapping skeleton out."""
    catalog = json.loads((ROOT / "equipment_catalog.json").read_text(encoding="utf-8"))
    mapping_path = ROOT / "qr_mapping.json"
    existing = {}
    if mapping_path.is_file():
        try:
            for entry in json.loads(mapping_path.read_text(encoding="utf-8")):
                if entry.get("qr_payload"):
                    existing[entry.get("machine")] = entry
        except (ValueError, TypeError):
            pass

    mapping = []
    for machine in catalog:
        name = machine["name"]
        if name in existing:
            mapping.append(existing[name])
            continue
        mapping.append({
            "machine": name,
            "qr_payload": None,
            "opengym_exercises": [],
            "program_modes": machine.get("program_modes", []),
            "notes": "scan with a generic reader; paste raw text into qr_payload",
        })

    mapping_path.write_text(json.dumps(mapping, indent=2, ensure_ascii=False),
                            encoding="utf-8")
    filled = sum(1 for e in mapping if e["qr_payload"])
    print(f"machines: {len(mapping)}, payloads recorded: {filled}")


if __name__ == "__main__":
    main()
