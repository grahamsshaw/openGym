"""Convert Health Data Export CSVs (Health Connect, Android) for openGym.

Reads the ``Activity.csv`` / ``Sleep.csv`` / ``Vitals.csv`` files written by
the Health Data Export app (``com.teqxnology.healthdataexport``) and produces:

- ``opengym_phone_sessions.csv`` — one row per real exercise session
  (type with the numeric ``"NN - "`` prefix stripped, start time, duration,
  calories, distance). Imports via **Settings → Data → Import from another
  app** alongside the gym history, so phone activities sit in the same log
  and are visibly distinct by name (e.g. "Walking (phone)").
- ``phone_daily.json`` — daily step/distance/calorie aggregates, vitals
  (HR/HRV/resting) and sleep sessions. openGym's CSV import has no columns
  for these, so they are kept here — honestly separated, never fabricated
  into fake workouts — for the later schema extension (option B).

Session-vs-gym disambiguation is by source naming: phone rows carry
``(phone)`` in the exercise name, Technogym rows carry ``(Technogym)``,
so activity history shows at a glance where each entry came from.

Usage::

    py bridge/health_connect_to_opengym.py --input <export folder> --out bridge/out
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime, timedelta
from pathlib import Path


def strip_code(label: str) -> str:
    """Remove a leading Health Connect numeric type code (``"79 - Walking"``)."""
    return re.sub(r"^\d+\s*-\s*", "", (label or "").strip())


def moment(raw: str | None) -> datetime | None:
    """Parse the app's ``YYYY-MM-DD HH:MM:SS`` timestamps (naive local)."""
    if not raw or not raw.strip():
        return None
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), pattern)
        except ValueError:
            continue
    return None


def number(raw) -> float | None:
    """Parse a CSV number, None for blanks."""
    if raw is None or not str(raw).strip():
        return None
    try:
        return float(str(raw).strip())
    except ValueError:
        return None


def read_csv(path: Path) -> list[dict]:
    """Read a CSV tolerantly (BOM-safe, bad-byte-safe)."""
    if not path.is_file():
        return []
    with open(path, encoding="utf-8-sig", errors="replace", newline="") as fh:
        return list(csv.DictReader(fh))


def main() -> None:
    """CLI entry point: read the export, write sessions CSV + daily JSON."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Health Data Export folder")
    parser.add_argument("--out", required=True, help="Output folder")
    args = parser.parse_args()

    src = Path(args.input)
    activity = read_csv(src / "Activity.csv")
    sleep = read_csv(src / "Sleep.csv")
    vitals = read_csv(src / "Vitals.csv")
    if not activity and not sleep and not vitals:
        raise SystemExit(f"no CSV files in {src}")

    sessions: list[dict] = []
    daily: dict[str, dict] = {}
    for row in activity:
        day = (row.get("Date") or "").strip()
        if not day:
            continue
        entry = daily.setdefault(day, {"steps": None, "distance_m": None,
                                       "calories": None, "vitals": {}})
        if entry["steps"] is None:
            entry["steps"] = number(row.get("Steps"))
            entry["distance_m"] = number(row.get("Distance (m)"))
            entry["calories"] = number(row.get("Total Calories (kcal)"))
        name = (row.get("Exercise Name") or "").strip()
        start = moment(row.get("Start Date/Time"))
        if name and start:
            minutes = number(row.get("Duration (min)"))
            sessions.append({
                "workout name": f"{strip_code(name)} (phone)",
                "exercise": f"{strip_code(name)} (phone)",
                "date": start.strftime("%Y-%m-%d"),
                "start time": start.strftime("%H:%M"),
                "duration seconds": int(minutes * 60) if minutes else "",
                "distance km": (lambda d: round(d / 1000, 3) if d else "")(
                    number(row.get("Exercise Distance (m)"))),
                "note": (lambda c: f"{c:g} kcal; source health-connect"
                         if c else "source health-connect")(
                    number(row.get("Exercise Calories (kcal)"))),
            })

    for row in vitals:
        day = (row.get("Date") or "").strip()
        if not day or day not in daily:
            continue
        for src_key, dst_key in (
                ("Heart rate min (bpm)", "hr_min"),
                ("Heart rate max (bpm)", "hr_max"),
                ("Heart rate avg (bpm)", "hr_avg"),
                ("Resting heart rate avg (bpm)", "resting_hr")):
            value = number(row.get(src_key))
            if value is not None:
                daily[day]["vitals"][dst_key] = value

    sleeps = []
    for row in sleep:
        start = moment(row.get("Start Time"))
        if start is None:
            continue
        sleeps.append({
            "start": start.isoformat(),
            "end": (moment(row.get("End Time")) or start).isoformat(),
            "light_min": number(row.get("Light Sleep (min)")),
            "deep_min": number(row.get("Deep Sleep (min)")),
            "rem_min": number(row.get("REM Sleep (min)")),
        })

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "opengym_phone_sessions.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=[
            "workout name", "exercise", "date", "start time",
            "duration seconds", "distance km", "note",
        ])
        writer.writeheader()
        writer.writerows(sessions)
    with open(out / "phone_daily.json", "w", encoding="utf-8") as fh:
        json.dump({"days": daily, "sleep": sleeps}, fh, indent=2)

    print(f"activity rows: {len(activity)}, sessions: {len(sessions)}, "
          f"days: {len(daily)}, sleep: {len(sleeps)}")


if __name__ == "__main__":
    main()
