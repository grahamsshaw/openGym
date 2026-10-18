"""Convert Technogym data to openGym import CSVs — export files and/or live DB.

Two inputs, one output (see ``documentation/BRIDGE-GUIDE.md``):

- ``--input``: the ``indooractivities`` / ``biometrics`` JSON export (a
  frozen snapshot; same shape the live API returns). Yields inferred
  machine labels (treadmill / bike / rower / climb / strength) because the
  export names no machine.
- ``--db``: the live-pull database this bridge owns
  (``bridge/data/technogym.db``, written by ``technogym_fetch.py``) — these
  sessions carry the real ``physicalActivityName`` and ``equipmentName``.
  Only sessions NEWER than the newest export-file
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

    py bridge/technogym_export_to_opengym.py --input bridge/data/technogym_export --out bridge/out
    py bridge/technogym_export_to_opengym.py --input bridge/data/technogym_export \
       --db bridge/data/technogym.db --out bridge/out

Re-running is safe: the output is a pure function of the inputs.
openGym itself skips days that already hold a workout, so importing twice
never duplicates anything.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from program_infer import format_guess, infer_program, load_menus


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


def session_note(metrics: dict, n_segments: int, menus: dict | None = None) -> str:
    """Pack program-inference material into openGym's note column.

    Raw material first (level, profile, HR, segments), then the v1 program
    guess when the numbers support one (see program_infer). The guess
    rides along visibly — "likely Hills (7/10)" — never silently.
    """
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
    if menus:
        guess = format_guess(infer_program(
            machine="", level=level, elevation_m=_num(metrics.get("Elevation")),
            duration_s=_num(metrics.get("Duration")),
            avg_hr=_num(metrics.get("AvgHr")), max_hr=_num(metrics.get("MaxHr")),
            menus=menus))
        if guess:
            bits.append(guess)
    bits.append("source technogym")
    return "; ".join(bits)


def convert_export(indoor: list, biometrics: list, menus: dict | None = None) -> tuple[list[dict], list[dict]]:
    """Convert parsed export data to openGym-shaped rows.

    Args:
        indoor: Sessions from the ``indooractivities`` file.
        biometrics: Entries from the ``biometrics`` file.
        menus: Program menus for inference (see program_infer); loaded
            from the catalog files when omitted.

    Returns:
        ``(workout_rows, weighin_rows)`` with openGym's accepted headers.
    """
    if menus is None:
        try:
            menus = load_menus()
        except (ValueError, OSError):
            menus = {}
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
            "note": session_note(metrics, len(_segments(item)), menus=menus),
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
        db_path: Path to the live-pull database (``data/technogym.db``).
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


# Readings closer together than this are the same weight measured twice; real
# weight does not move by a kilo or more inside one weigh-in.
SAME_READING_KG = 2.0


def _agreeing_groups(values: list[float], tol: float = SAME_READING_KG) -> list[list[float]]:
    """Group a day's readings into runs that agree, nearest neighbour first."""
    groups: list[list[float]] = []
    for value in sorted(values):
        for group in groups:
            if abs(value - group[-1]) <= tol:
                group.append(value)
                break
        else:
            groups.append([value])
    return groups


def resolve_conflicts(weighins: list[dict]) -> tuple[list[dict], list, list]:
    """Drop weigh-in readings that the rest of the same day contradicts.

    The gym's scale reports a fault reading now and then — always the same
    value, about half the real one — and a day can then hold both. openGym
    keeps the last row for a day, so position alone decides, which is how the
    fault reading won.

    A day is only touched when the readings themselves settle it: those that
    agree form the larger group, and the ones standing alone go. A day with a
    single reading, or one that splits evenly, is left exactly as found — there
    is no evidence there, and guessing is how real weight gets lost.

    Returns ``(kept, dropped, unresolved)``, the last two being
    ``(date, values)`` pairs for the report.
    """
    by_day: dict[str, list[tuple[float, dict]]] = {}
    for row in weighins:
        try:
            by_day.setdefault(row["date"], []).append((float(row["weight"]), row))
        except (KeyError, TypeError, ValueError):
            continue

    # Everything starts kept, including any row whose weight will not parse: this
    # function exists to drop strays the day contradicts, and a row it cannot
    # read is not a stray, it is simply not this function's business.
    keep = {id(row) for row in weighins}
    dropped: list[tuple[str, list[float]]] = []
    unresolved: list[tuple[str, list[float]]] = []

    for day in sorted(by_day):
        entries = by_day[day]
        values = [v for v, _ in entries]
        # One reading, or readings that all agree: nothing to decide.
        if len(values) < 2 or max(values) - min(values) <= SAME_READING_KG:
            continue

        groups = _agreeing_groups(values)
        biggest = max(len(g) for g in groups)
        winners = [g for g in groups if len(g) == biggest]
        # A clear majority, and more than one reading behind it, is a verdict.
        if len(winners) == 1 and len(winners[0]) > 1:
            for value, row in entries:
                if value not in winners[0]:
                    keep.discard(id(row))
                    dropped.append((day, [value]))
        else:
            unresolved.append((day, values))

    return [row for row in weighins if id(row) in keep], dropped, unresolved


def main() -> None:
    """CLI entry point: read export and/or live DB, write openGym CSVs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Technogym export folder")
    parser.add_argument("--db", default=None,
                        help="live-pull database (technogym.db) for sessions newer than the export")
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

    # Same-day disagreements: the gym's scale occasionally returns a fault
    # reading (another person steps on, the cell reads low), and a day can then
    # hold both the real weight and the stray. openGym keeps the LAST row per
    # day, so a stray that lands last wins by position alone — which is how a
    # 70 kg reading came to stand in for a 105 kg one.
    #
    # Where the day itself gives a verdict, use it: the readings that agree win,
    # the ones standing alone are dropped. 105/105/70 resolves to 105. It has to
    # be resolved here, because this CSV is regenerated on every pull — an
    # earlier hand-edit of the file was wiped the next time the bridge ran.
    #
    # Where a day splits evenly and nothing corroborates either reading, there
    # is no evidence to decide with, so everything is kept and the day reported.
    # A lone reading is never touched.
    kept, dropped, conflicts = resolve_conflicts(weighins)

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
        writer.writerows(kept)

    for day, values in dropped:
        print(f"DROPPED {day}: {values} kg — the rest of that day agreed")
    for day, values in conflicts:
        print(f"CONFLICT {day}: {sorted(values)} kg — split evenly, kept all")
    if dropped:
        print(f"weigh-ins: dropped {len(dropped)} stray reading(s)")

    print(f"sessions: {len(indoor)}, workout rows: {len(workouts)}, "
          f"weigh-ins: {len(weighins)}")


if __name__ == "__main__":
    main()
