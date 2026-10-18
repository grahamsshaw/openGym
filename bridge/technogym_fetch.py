"""Fetch recent Technogym sessions straight from the gym's cloud API.

Replaces the old Flask project's ``scripts/import_data.py``, which existed to
do exactly this one job (login, list sessions, pull each one's details) and
nothing else that openGym still uses. Keeping the login inside this repository
is what lets the home server run the bridge with nothing but openGym cloned.

What it talks to, all POSTs, all JSON:

    core.mywellness.com/v2/enduser/authentication/login   -> token + user id
    services.mywellness.com/Training/User/{id}/ActivityHistory
    services.mywellness.com/Training/User/{id}/GetPerformedWorkoutSessionByIdCr

Everything lands in a small SQLite database with the exact shape
``technogym_export_to_opengym.py --db`` reads: a workout row per session and
one row per machine used, carrying every metric the gym reports (see
``_METRIC_KEYS``). Re-running is safe -- a session already stored is skipped by
its idCr, so this costs one login and a handful of reads.

Usage
-----
    py bridge/technogym_fetch.py --db bridge/data/technogym.db --days 30
    py bridge/technogym_fetch.py --db ... --days 7 --dry-run

Credentials come from MYWELLNESS_EMAIL / MYWELLNESS_PASSWORD (bridge/.env), or
from the environment. Never printed, never logged.

Exit codes: 0 fetched or nothing new, 1 could not log in or nothing reached.
"""

from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

import httpx

LOGIN_URL = "https://core.mywellness.com/v2/enduser/authentication/login"
SERVICES_URL = "https://services.mywellness.com"

# The gym's own web client identifies itself with these; the API rejects
# requests without them.
API_HEADERS = {
    "Content-Type": "application/json",
    "X-MWAPPS-APPID": "EC1D38D7-D359-48D0-A60C-D8C0B8FB9DF9",
    "X-MWAPPS-CLIENT": "enduserweb",
}

SOURCE = "technogym"

# Gym metric name -> column. Dropping a key here is how treadmill runs once
# arrived with no distance at all, so every key the gym sends is kept.
METRIC_KEYS = {
    "resistance_type": "ExecutionMode",
    "duration_seconds": "Duration",
    "calories": "Calories",
    "moves": "Move",
    "compliance": "ExerciseCompliance",
    "total_weight_kg": "TotalIsoWeight",
    "avg_speed_kmh": "AvgSpeed",
    "avg_hr_bpm": "AvgHr",
    "max_hr_bpm": "MaxHr",
    "elevation_m": "Elevation",
    "floors_climbed": "Floors",
    "avg_power_w": "AvgPower",
    "avg_rpm": "AvgRpm",
}
# Distance has two names depending on the machine, so it is resolved separately.
DISTANCE_KEYS = ("HDistance", "RowingDistance")

SCHEMA = """
CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_name TEXT,
    started_at TEXT,
    source TEXT,
    source_id TEXT,
    UNIQUE (source, source_id)
);
CREATE TABLE IF NOT EXISTS workout_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL,
    exercise_name TEXT,
    equipment_name TEXT,
    machine TEXT,
    resistance_type TEXT,
    duration_seconds INTEGER,
    calories REAL,
    moves INTEGER,
    compliance REAL,
    total_weight_kg REAL,
    exercise_order INTEGER,
    distance_m REAL,
    avg_speed_kmh REAL,
    avg_hr_bpm REAL,
    max_hr_bpm REAL,
    elevation_m REAL,
    floors_climbed INTEGER,
    avg_power_w REAL,
    avg_rpm REAL,
    UNIQUE (workout_id, exercise_order)
);
CREATE TABLE IF NOT EXISTS fetch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT,
    sessions_found INTEGER,
    sessions_stored INTEGER,
    detail TEXT
);
"""


# ---------------------------------------------------------------- parsing


def first_number(value) -> float | None:
    """First number in a formatted metric ("6.5 km/h" -> 6.5), else None."""
    if value is None or value == "":
        return None
    match = re.search(r"(\d+(?:\.\d+)?)", str(value))
    return float(match.group(1)) if match else None


def duration_seconds(value) -> int | None:
    """Exact seconds from a gym clock ("20:00 min" -> 1200, "00:47 min" -> 47).

    Plain minutes ("49 minutes") read as minutes. None when blank, so the row is
    skipped downstream rather than stored as a zero-length set.
    """
    if not value:
        return None
    clock = re.search(r"(\d+):(\d+)", str(value))
    if clock:
        return int(clock.group(1)) * 60 + int(clock.group(2))
    number = first_number(value)
    return int(number) * 60 if number is not None else None


def whole_number(value) -> int | None:
    """First whole number ("816 MOVEs" -> 816), else None."""
    number = first_number(value)
    return int(number) if number is not None else None


def distance_m(value) -> float | None:
    """Metres from a distance string ("2.16 km" -> 2160.0)."""
    number = first_number(value)
    if number is None:
        return None
    return number * 1000.0 if "km" in str(value).lower() else float(number)


def metrics_of(activity: dict) -> dict[str, str]:
    """Flatten one exercise's ``physicalProperty`` list into name -> value."""
    performed = activity.get("performedPhysicalActivity") or {}
    data = (performed.get("data") or {}).get("data") or []
    return {d.get("physicalProperty"): d.get("formattedValue", "")
            for d in data if isinstance(d, dict)}


# ------------------------------------------------------------------- api


class Client:
    """Thin wrapper over the three calls, holding the bearer token."""

    def __init__(self, email: str, password: str):
        self._email = email
        self._password = password
        self._http = httpx.Client(timeout=60.0,
                                  headers={"User-Agent": "opengym-bridge"})
        self._user_id: str | None = None
        self._token: str | None = None

    def close(self) -> None:
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _auth_headers(self) -> dict[str, str]:
        return {**API_HEADERS, "Authorization": f"Bearer {self._token}"}

    def _absorb_token(self, data: dict) -> dict:
        """Keep the token fresh; the API rotates it on some responses."""
        if data.get("token"):
            self._token = data["token"]
        return data

    def login(self) -> str:
        response = self._http.post(LOGIN_URL, headers=API_HEADERS, json={
            "username": self._email,
            "password": self._password,
            "keepMeLoggedIn": True,
        })
        response.raise_for_status()
        data = response.json()
        user_id = (data.get("userContext") or {}).get("id")
        token = data.get("token")
        if not user_id:
            raise RuntimeError("login succeeded but no user id came back")
        if not token:
            raise RuntimeError("login succeeded but no token came back")
        self._user_id, self._token = user_id, token
        return str(user_id)

    def activity_history(self) -> list[dict]:
        response = self._http.post(
            f"{SERVICES_URL}/Training/User/{self._user_id}/ActivityHistory",
            headers=self._auth_headers(), json={})
        response.raise_for_status()
        data = self._absorb_token(response.json())
        return (data.get("data") or {}).get("items", [])

    def session(self, id_cr, partition_date) -> dict:
        response = self._http.post(
            f"{SERVICES_URL}/Training/User/"
            f"{self._user_id}/GetPerformedWorkoutSessionByIdCr",
            headers=self._auth_headers(),
            json={"idCr": id_cr, "partitionDate": partition_date})
        response.raise_for_status()
        return self._absorb_token(response.json()).get("data") or {}


# --------------------------------------------------------------- storage


def open_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.executescript(SCHEMA)
    db.commit()
    return db


def stored_ids(db: sqlite3.Connection) -> set[str]:
    return {row[0] for row in db.execute(
        "SELECT source_id FROM workouts WHERE source = ?", (SOURCE,))}


def store_session(db: sqlite3.Connection, id_cr, started: str,
                  session: dict, dry_run: bool) -> int:
    """Write one session plus its machines. Returns rows written."""
    minutes = duration_seconds(session.get("displayDurationDone", ""))
    moves = whole_number(session.get("displayMoveDoneShort", ""))

    activities = session.get("physicalActivities") or []
    rows: list[tuple] = []
    for order, activity in enumerate(activities):
        name = activity.get("physicalActivityName") or ""
        if not name:
            continue
        machine = activity.get("equipmentName") or ""
        values = metrics_of(activity)
        distance = next((distance_m(values[k]) for k in DISTANCE_KEYS
                         if values.get(k)), None)
        speed = first_number(values.get("AvgSpeed"))
        rows.append((
            name, machine, machine,
            values.get("ExecutionMode", ""),
            duration_seconds(values.get("Duration")),
            first_number(values.get("Calories")),
            whole_number(values.get("Move")),
            first_number(values.get("ExerciseCompliance")),
            first_number(values.get("TotalIsoWeight")),
            order, distance, speed,
            first_number(values.get("AvgHr")),
            first_number(values.get("MaxHr")),
            first_number(values.get("Elevation")),
            whole_number(values.get("Floors")),
            first_number(values.get("AvgPower")),
            first_number(values.get("AvgRpm")),
        ))

    if dry_run:
        return len(rows)

    cursor = db.execute(
        "INSERT OR IGNORE INTO workouts (workout_name, started_at, source, source_id) "
        "VALUES (?, ?, ?, ?)",
        (session.get("displayName") or "Workout", started, SOURCE, str(id_cr)))
    if cursor.lastrowid is None:
        return 0
    workout_id = cursor.lastrowid
    for row in rows:
        db.execute(
            "INSERT OR IGNORE INTO workout_exercises ("
            "  workout_id, exercise_name, equipment_name, machine, resistance_type,"
            "  duration_seconds, calories, moves, compliance, total_weight_kg,"
            "  exercise_order, distance_m, avg_speed_kmh, avg_hr_bpm, max_hr_bpm,"
            "  elevation_m, floors_climbed, avg_power_w, avg_rpm)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (workout_id, *row))
    _ = (minutes, moves)  # session-level totals; the bridge reads per-exercise rows
    return len(rows)


def load_dotenv(path: Path) -> None:
    """Fill MYWELLNESS_* from a .env file when not already set.

    Deliberately not python-dotenv: the bridge image already has it, but this
    script should also run straight from a checkout on a laptop.
    """
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        os.environ.setdefault(key, value)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="SQLite database to write")
    parser.add_argument("--days", type=int, default=30,
                        help="how far back to look (default 30)")
    parser.add_argument("--env", default=None,
                        help="path to a .env holding MYWELLNESS_* (default bridge/.env)")
    parser.add_argument("--dry-run", action="store_true",
                        help="talk to the gym but write nothing")
    args = parser.parse_args()

    default_env = Path(__file__).resolve().parent / ".env"
    load_dotenv(Path(args.env) if args.env else default_env)

    email = os.environ.get("MYWELLNESS_EMAIL", "").strip()
    password = os.environ.get("MYWELLNESS_PASSWORD", "").strip()
    if not email or not password:
        print("MYWELLNESS_EMAIL / MYWELLNESS_PASSWORD not set "
              "(put them in bridge/.env)", file=sys.stderr)
        return 1

    today = date.today()
    from_date = today - timedelta(days=max(1, args.days))
    db = open_db(Path(args.db))
    known = stored_ids(db)
    stored = rows = 0
    found = wanted = 0
    user_id = "?"

    # The client stays open for the whole run: it holds the bearer token every
    # session call needs, and leaving the context manager closes it. Closing it
    # early is why the first draft fetched the list and then failed on each
    # session with "the client has been closed".
    try:
        with Client(email, password) as client:
            user_id = client.login()
            items = client.activity_history()
            found = len(items)

            for item in items:
                raw = item.get("partitionDate")
                if not raw or not item.get("idCr"):
                    continue
                try:
                    started = date.fromisoformat(
                        f"{str(raw)[0:4]}-{str(raw)[4:6]}-{str(raw)[6:8]}")
                except ValueError:
                    continue
                if not (from_date <= started <= today):
                    continue
                wanted += 1
                if str(item["idCr"]) in known:
                    continue
                try:
                    session = client.session(item["idCr"], str(raw))
                except Exception as exc:  # noqa: BLE001 - one bad session is not fatal
                    print(f"technogym: session {item['idCr']} failed: {exc}",
                          file=sys.stderr)
                    continue
                rows += store_session(db, item["idCr"], started.isoformat(),
                                      session, args.dry_run)
                stored += 1
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        db.close()
        print(f"technogym: could not reach the gym API: {exc}", file=sys.stderr)
        return 1

    db.commit()
    db.close()

    verb = "would store" if args.dry_run else "stored"
    print(f"technogym: user {user_id}, {found} sessions listed, "
          f"{wanted} in the last {args.days} days, {stored} new "
          f"({verb} {rows} machine rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())