"""Convert Technogym data to openGym import CSVs — export files and/or live DB.

Two inputs, one output (see ``documentation/BRIDGE-GUIDE.md``):

- ``--input``: the ``indooractivities`` / ``biometrics`` JSON export (a
  frozen snapshot; same shape the live API returns). Yields inferred
  machine labels (treadmill / bike / rower / climb / strength) because the
  export names no machine.
- ``--db``: the Flask ``fitness.db``, holding sessions pulled live by
  ``import_data.py`` — these carry the real ``physicalActivityName`` and
  ``equipmentName``. Only sessions NEWER than the newest export-file
  session are emitted, so the frozen snapshot and the live pull never
  double-report the same training.

Writes ``opengym_workouts.csv`` (one row per session) and
``opengym_weighins.csv`` (``date,weight``) for openGym's **Settings →
Data → Import from another app**.

What the data does and does not say (verified against a real 167-session
export; see ``documentation/TECHNOGYM-PROGRAMS.md``):

- Sessions record Duration, Calories, MOVEs, distance/speed/pace, heart
  rate, power/RPM, elevation/floors, METs/VO2, compliance, a numeric
  ``Level`` and a numeric ``Profile`` code, plus per-segment summaries.
- Nothing names the program ("Hills", "Weight Loss").
- Everything useful for later program inference (Level, Profile, HR,
  segment count, machine) is kept in the ``note`` column so it survives
  the import and is visible on the session.

Usage::

    py bridge/technogym_export_to_opengym.py --input data/technogym_export --out bridge/out
    py bridge/technogym_export_to_opengym.py --input data/technogym_export --db data/fitness.db --out bridge/out

Re-running is safe: the output is a pure function of the inputs.
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


def convert_db(db_path: str | Path, after: str) -> list[dict]:
    """Convert live-pulled Flask sessions newer than ``after`` (YYYY-MM-DD).

    Reads ``workouts`` + ``workout_exercises`` (+ equipment names) with
    ``source = 'technogym'``. These rows carry the live API's real activity
    and machine names, so no metric-guessing is needed. The ``after`` cutoff
    (newest export-file session) keeps the frozen snapshot and the live
    pull from double-reporting the same training.

    Args:
        db_path: Path to the Flask ``fitness.db``.
        after: Only sessions with a date strictly after this are emitted.

    Returns:
        Workout rows in the same shape as :func:`convert_export`.
    """
    import sqlite3

    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        "SELECT w.workout_name, w.started_at, we.exercise_name, "
        "we.equipment_name, we.machine, we.resistance_type, "
        "we.duration_seconds, we.calories, we.moves, we.compliance, "
        "we.total_weight_kg, we.distance_m, we.avg_speed_kmh, "
        "we.avg_hr_bpm, we.max_hr_bpm, we.elevation_m, we.floors_climbed, "
        "we.avg_power_w, we.avg_rpm "
        "FROM workouts w JOIN workout_exercises we "
        "ON we.workout_id = w.id "
        "WHERE w.source = 'technogym' AND date(w.started_at) > date(?) "
        "ORDER BY w.started_at, we.exercise_order",
        (after,),
    ).fetchall()
    db.close()

    workouts: list[dict] = []
    skipped = 0
    for row in rows:
        # openGym needs something measured per row (duration or distance);
        # calories or a weight total alone cannot form a set there. Skipped
        # rows are counted and reported, never silently absorbed.
        if row["duration_seconds"] is None and row["distance_m"] is None:
            skipped += 1
            continue
        bits = []
        if row["machine"]:
            bits.append(str(row["machine"]))
        if row["resistance_type"]:
            bits.append(str(row["resistance_type"]))
        if row["avg_speed_kmh"] is not None:
            bits.append(f"avg {row['avg_speed_kmh']:g} km/h")
        if row["avg_hr_bpm"] is not None or row["max_hr_bpm"] is not None:
            bits.append("HR {}/{}".format(
                row["avg_hr_bpm"] if row["avg_hr_bpm"] is not None else "?",
                row["max_hr_bpm"] if row["max_hr_bpm"] is not None else "?"))
        if row["elevation_m"] is not None:
            bits.append(f"climb {row['elevation_m']:g} m")
        if row["floors_climbed"] is not None:
            bits.append(f"{row['floors_climbed']} floors")
        if row["avg_power_w"] is not None:
            bits.append(f"avg {row['avg_power_w']:g} W")
        if row["avg_rpm"] is not None:
            bits.append(f"avg {row['avg_rpm']:g} rpm")
        if row["compliance"] is not None:
            bits.append(f"compliance {row['compliance']:g}")
        if row["moves"] is not None:
            bits.append(f"Move {row['moves']:g}")
        if row["total_weight_kg"] is not None:
            bits.append(f"total {row['total_weight_kg']:g} kg")
        bits.append("source technogym-live")
        started = str(row["started_at"] or "")
        dist_km = round(row["distance_m"] / 1000, 3) if row["distance_m"] else ""
        workouts.append({
            "workout name": row["workout_name"] or "Technogym session",
            "exercise": row["exercise_name"] or "Gym (Technogym)",
            "date": started[:10],
            "start time": started[11:16] if len(started) > 16 else "",
            "duration seconds": row["duration_seconds"] or "",
            "distance km": dist_km,
            "note": "; ".join(bits),
        })
    if skipped:
        print(f"live rows skipped (nothing measurable): {skipped}")
    return workouts


def main() -> None:
    """CLI entry point: read export and/or live DB, write openGym CSVs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Technogym export folder")
    parser.add_argument("--db", default=None,
                        help="Flask fitness.db for live-pulled sessions newer than the export")
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

    if args.db:
        newest = max((str(item.get("on") or "")[:10] for item in indoor), default="")
        live = convert_db(args.db, newest)
        workouts.extend(live)
        print(f"live sessions after {newest}: {len(live)}")

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
