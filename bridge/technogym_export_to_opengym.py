"""Convert a Technogym export folder to openGym import CSVs.

Reads the ``indooractivities`` / ``biometrics`` JSON files produced by the
Mywellness export (same shape the live API returns) and writes two files
openGym's **Settings → Data → Import from another app** accepts directly:

- ``opengym_workouts.csv`` — one row per cardio/strength session. openGym
  matches the ``exercise`` column against its library; unrecognised names
  become your own exercises, so nothing is dropped.
- ``opengym_weighins.csv`` — one row per weigh-in (``date,weight``), from
  the biometrics file plus ``UserWeight`` entries inside sessions.

What the export does and does not say (verified against a real 167-session
export; see ``documentation/TECHNOGYM-PROGRAMS.md``):

- It records Duration, Calories, MOVEs, distance/speed/pace, heart rate,
  power/RPM, elevation/floors, METs/VO2, compliance, a numeric ``Level``
  and a numeric ``Profile`` code, plus per-segment summaries.
- It does NOT name the program ("Hills", "Weight Loss") or the machine.
  The ``exercise`` column below is therefore an *inferred* label from the
  metrics present (treadmill / bike / rower / climb / strength). Rows
  imported from the live API (which carries ``physicalActivityName`` and
  ``equipmentName``) should prefer those names — see ``--live-json``.
- Everything useful for later program inference (Level, Profile, HR,
  segment count) is kept in the ``note`` column so it survives the import
  and is visible on the session.

Usage::

    py bridge/technogym_export_to_opengym.py --input data/technogym_export --out bridge/out

Re-running is safe: the output is a pure function of the input files.
openGym itself skips days that already hold a workout, so importing twice
never duplicates anything.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def _metrics(item: dict) -> dict:
    """Flatten a session's ``performedData.pr`` list to name → value."""
    out: dict = {}
    performed = item.get("performedData", {}) or {}
    for entry in performed.get("pr", []) or []:
        name = entry.get("n")
        if name is not None:
            out[name] = entry.get("v")
    return out


def _segments(item: dict) -> list:
    """Return the per-segment summaries (may be empty)."""
    performed = item.get("performedData", {}) or {}
    return performed.get("st", []) or []


def infer_exercise(metrics: dict) -> str:
    """Guess a machine label from which metrics are present.

    Args:
        metrics: Flattened ``pr`` metrics for one session.

    Returns:
        A human label. Deliberately coarse — the live API names replace
        these wherever available (see ``--live-json``).
    """
    if "RowingDistance" in metrics:
        return "Rower (Technogym)"
    if "AvgRpm" in metrics or "AvgSpeedRpm" in metrics:
        return "Bike (Technogym)"
    if "Floors" in metrics:
        return "Climb (Technogym)"
    if "HDistance" in metrics or "Pace" in metrics:
        return "Treadmill (Technogym)"
    if "TotalIsoWeight" in metrics or "Rm1" in metrics:
        return "Strength (Technogym)"
    return "Cardio (Technogym)"


def _num(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def session_note(metrics: dict, n_segments: int) -> str:
    """Pack program-inference material into openGym's note column."""
    bits = []
    level = _num(metrics.get("Level"))
    if level is not None:
        bits.append(f"level {level:g}")
    profile = _num(metrics.get("Profile"))
    if profile is not None:
        bits.append(f"profile {profile:g}")
    for key in ("AvgHr", "MaxHr", "Move", "MetsMin", "ExerciseCompliance"):
        value = _num(metrics.get(key))
        if value is not None:
            bits.append(f"{key} {value:g}")
    if n_segments:
        bits.append(f"{n_segments} segments")
    bits.append("source technogym")
    return "; ".join(bits)


def convert_export(indoor: list, biometrics: list) -> tuple[list[dict], list[dict]]:
    """Convert parsed export data to openGym-shaped rows.

    Args:
        indoor: Sessions from the ``indooractivities`` file.
        biometrics: Entries from the ``biometrics`` file.

    Returns:
        ``(workout_rows, weighin_rows)`` with openGym's accepted headers.
    """
    workouts: list[dict] = []
    for item in indoor:
        metrics = _metrics(item)
        duration_s = _num(metrics.get("Duration"))
        if duration_s is None:
            continue
        on = (item.get("on") or "")[:10]
        dist_m = _num(metrics.get("HDistance"))
        if dist_m is None:
            dist_m = _num(metrics.get("RowingDistance"))
        workouts.append({
            "workout name": "Technogym session",
            "exercise": infer_exercise(metrics),
            "date": on,
            "start time": "",
            "duration seconds": int(duration_s),
            "distance km": round(dist_m / 1000, 3) if dist_m else "",
            "note": session_note(metrics, len(_segments(item))),
        })

    weighins: list[dict] = []
    for entry in biometrics:
        if str(entry.get("name", "")).lower() != "weight":
            continue
        weighins.append({
            "date": str(entry.get("measuredOn", ""))[:10],
            "weight": entry.get("value"),
        })
    for item in indoor:
        user_weight = _num(_metrics(item).get("UserWeight"))
        if user_weight is not None:
            weighins.append({
                "date": (item.get("on") or "")[:10],
                "weight": user_weight,
            })
    return workouts, weighins


def main() -> None:
    """CLI entry point: read export, write openGym CSVs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Technogym export folder")
    parser.add_argument("--out", required=True, help="Output folder for CSVs")
    args = parser.parse_args()

    src = Path(args.input)
    indoor_files = sorted(src.glob("indooractivities-*.json"))
    bio_files = sorted(src.glob("biometrics-*.json"))
    if not indoor_files:
        raise SystemExit(f"no indooractivities file in {src}")

    indoor: list = []
    for path in indoor_files:
        indoor.extend(json.loads(path.read_text(encoding="utf-8")))
    biometrics: list = []
    for path in bio_files:
        bio = json.loads(path.read_text(encoding="utf-8"))
        biometrics.extend(bio if isinstance(bio, list) else [])

    workouts, weighins = convert_export(indoor, biometrics)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "opengym_workouts.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=[
            "workout name", "exercise", "date", "start time",
            "duration seconds", "distance km", "note",
        ])
        writer.writeheader()
        writer.writerows(workouts)
    with open(out / "opengym_weighins.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["date", "weight"])
        writer.writeheader()
        writer.writerows(weighins)

    # Same-day disagreements are reported, never silently resolved:
    # openGym keeps the LAST row per day, so a stray bad reading (another
    # person on the gym scale, a partial measurement) would win by position
    # alone. Check any listed day and delete the bad row from your working
    # copy before importing.
    by_day: dict[str, list[float]] = {}
    for row in weighins:
        try:
            by_day.setdefault(row["date"], []).append(float(row["weight"]))
        except (TypeError, ValueError):
            continue
    for day in sorted(by_day):
        values = by_day[day]
        if len(values) > 1 and max(values) - min(values) > 2.0:
            print(f"CONFLICT {day}: {sorted(values)} kg — resolve before importing")

    print(f"sessions: {len(indoor)}, workout rows: {len(workouts)}, "
          f"weigh-ins: {len(weighins)}")


if __name__ == "__main__":
    main()
