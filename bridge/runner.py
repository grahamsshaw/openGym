"""Bridge runner: hears the phone/PC pull button, runs the import chain.

Polls DATA_DIR/bridge/jobs/ for pending jobs (written by POST
/api/bridge/pull) plus a nightly full run, then executes, in order:

1. ``technogym_fetch.py`` (Technogym live API) into bridge/data/technogym.db —
   failures are logged, never fatal; the chain continues with whatever is
   present.
2. Stage recognised inbox files over the Health Connect export folder.
3. The three bridge converters + the combined-file merge.
4. ``autopush.mjs --live`` (merge with openGym's own importer, conditional
   PUT — conflicts abort, your edits always win).

Writes DATA_DIR/bridge/runner.json heartbeat every poll (the status
endpoint reports "runner watching" from it) and result.json after each
run. Successful jobs are deleted; failed ones stay for inspection.

Environment (see bridge/.env.example):

- BRIDGE_DIR: this project's bridge/ folder (converters, autopush).
- BRIDGE_DATA_DIR: source data this bridge owns — technogym.db (live pull),
  technogym_export/, wii_fit/, health_data_export/. Default /bridge/data.
- DATA_DIR: openGym data dir (default /data) — jobs + heartbeat live here.
- OG_URL: openGym base URL (default http://host.docker.internal:8080,
  i.e. this PC's published web port, reachable from inside Docker).
- OG_USER / OG_PASS: password-login profile for autopush (never in git).
- MYWELLNESS_EMAIL / MYWELLNESS_PASSWORD: Technogym cloud login (never in git).
- POLL_SECONDS (default 60), FULL_EVERY_HOURS (default 20).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path


def log(msg: str) -> None:
    """Timestamped stdout (Docker picks it up as container logs)."""
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}", flush=True)


def env(name: str, default: str = "") -> str:
    """Read a setting, defaulting when unset or blank."""
    return (os.environ.get(name) or "").strip() or default


def run(cmd: list[str], **kwargs) -> tuple[int, str]:
    """Run one step, capturing output; never raises."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=1800, **kwargs)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except Exception as exc:  # noqa: BLE001 - a step must never kill the loop
        return 1, f"could not start {' '.join(cmd)}: {exc}"


def bridge_dir() -> Path:
    """Data dir holding jobs/, inbox/, runner.json, result.json."""
    return Path(env("DATA_DIR", "/data")) / "bridge"


def pending_jobs() -> list[Path]:
    """Job files still awaiting a run, oldest first."""
    jobs = bridge_dir() / "jobs"
    if not jobs.is_dir():
        return []
    found = []
    for path in sorted(jobs.glob("job-*.json")):
        try:
            if json.loads(path.read_text(encoding="utf-8")).get("status") == "pending":
                found.append(path)
        except (ValueError, OSError):
            continue
    return found


def heartbeat() -> None:
    """Tell the status endpoint a runner is watching."""
    try:
        (bridge_dir()).mkdir(parents=True, exist_ok=True)
        (bridge_dir() / "runner.json").write_text(
            json.dumps({"at": datetime.now(timezone.utc).isoformat(),
                        "mode": "bridge-service"}),
            encoding="utf-8")
    except OSError:
        pass


def stage_inbox(flask_data: Path, notes: list[str]) -> None:
    """Copy the newest of each recognised inbox file over the export folder."""
    inbox = bridge_dir() / "inbox"
    if not inbox.is_dir():
        return
    for name in ("Activity", "Sleep", "Vitals"):
        candidates = sorted(inbox.glob(f"*{name}.csv"),
                            key=lambda p: p.stat().st_mtime, reverse=True)
        # Skip timestamped names that are really another file type.
        candidates = [p for p in candidates if p.suffix.lower() == ".csv"]
        if not candidates:
            continue
        try:
            shutil.copyfile(candidates[0], flask_data / "health_data_export" / f"{name}.csv")
            notes.append(f"staged inbox {candidates[0].name}")
        except OSError as exc:
            notes.append(f"inbox stage failed for {name}: {exc}")


def run_chain(sources: list[str]) -> dict:
    """Execute pull → convert → merge → push. Returns a result summary."""
    bridge = Path(env("BRIDGE_DIR", "/bridge"))
    # Source data this bridge owns. It used to live in the old Flask project;
    # bringing it in here is what lets the home server run with nothing but
    # openGym cloned.
    src = Path(env("BRIDGE_DATA_DIR", str(bridge / "data")))
    out = bridge / "out"
    out.mkdir(parents=True, exist_ok=True)
    notes: list[str] = []
    added = skipped = 0

    db_path = src / "technogym.db"
    code, text = run([sys.executable, str(bridge / "technogym_fetch.py"),
                      "--db", str(db_path), "--days", "30"])
    notes.append(f"technogym fetch exit {code}")
    if code != 0:
        notes.append(text.strip().splitlines()[-1] if text.strip() else "no output")

    stage_inbox(src, notes)

    converters = [
        ([sys.executable, str(bridge / "technogym_export_to_opengym.py"),
          "--input", str(src / "technogym_export"),
          "--db", str(db_path),
          "--out", str(out)], "technogym"),
        ([sys.executable, str(bridge / "wii_to_opengym.py"),
          "--input", str(src / "wii_fit"),
          "--out", str(out)], "wii"),
        ([sys.executable, str(bridge / "health_connect_to_opengym.py"),
          "--input", str(src / "health_data_export"),
          "--out", str(out)], "health-connect"),
    ]
    for cmd, label in converters:
        code, text = run(cmd)
        last = text.strip().splitlines()[-1] if text.strip() else "no output"
        notes.append(f"{label}: exit {code} ({last})")

    code, text = run([sys.executable, str(bridge / "merge_workout_csvs.py"),
                      "--inputs", str(out / "opengym_workouts.csv"),
                      str(out / "opengym_phone_sessions.csv"),
                      "--out", str(out / "opengym_combined.csv")])
    if code != 0:
        return {"ok": False, "added": 0, "skipped": 0,
                "notes": notes + ["merge failed, push skipped"]}

    node = env("NODE_BIN", "node")
    code, text = run(
        [node, str(bridge / "autopush.mjs"),
         "--url", env("OG_URL", "http://host.docker.internal:8080"),
         "--user", env("OG_USER"), "--pass", env("OG_PASS"),
         "--workouts", str(out / "opengym_combined.csv"),
         "--weighins", str(out / "opengym_weighins.csv"),
         "--live"],
        # The password must not land in logs: autopush only prints counts.
    )
    for line in text.strip().splitlines():
        if "added" in line and "skipped" in line:
            try:
                parts = line.replace(",", "").split()
                added = int(parts[parts.index("added") + 1])
                skipped = int(parts[parts.index("skipped") + 1])
            except (ValueError, IndexError):
                pass
    notes.append(f"push exit {code}")
    return {"ok": code == 0, "added": added, "skipped": skipped, "notes": notes}


def finish_job(path: Path, result: dict) -> None:
    """Record the result; successful jobs leave the queue, failures stay."""
    try:
        (bridge_dir() / "result.json").write_text(
            json.dumps({**result,
                        "at": datetime.now(timezone.utc).isoformat()}),
            encoding="utf-8")
        if result.get("ok"):
            path.unlink()
        else:
            job = json.loads(path.read_text(encoding="utf-8"))
            job["status"] = "failed"
            path.write_text(json.dumps(job), encoding="utf-8")
    except OSError:
        pass


def main() -> None:
    """Poll forever: queued jobs immediately, full run when one is due."""
    poll = int(env("POLL_SECONDS", "60") or 60)
    full_every = float(env("FULL_EVERY_HOURS", "20") or 20) * 3600
    last_full = 0.0
    log(f"bridge runner up (poll {poll}s, full every {full_every / 3600:g}h)")
    while True:
        try:
            heartbeat()
            jobs = pending_jobs()
            if jobs:
                log(f"{len(jobs)} job(s) pending")
            for path in jobs:
                try:
                    wanted = json.loads(path.read_text(encoding="utf-8")).get("sources") or []
                except (ValueError, OSError):
                    wanted = []
                log(f"running job {path.name} (sources: {wanted or 'all'})")
                finish_job(path, run_chain(wanted if isinstance(wanted, list) else []))
            if not jobs and time.time() - last_full >= full_every:
                log("scheduled full run")
                result = run_chain([])
                try:
                    (bridge_dir() / "result.json").write_text(
                        json.dumps({**result, "scheduled": True,
                                    "at": datetime.now(timezone.utc).isoformat()}),
                        encoding="utf-8")
                except OSError:
                    pass
                last_full = time.time()
        except Exception:  # noqa: BLE001 - the loop itself must never die
            log("runner loop error:\n" + traceback.format_exc())
        time.sleep(poll)


if __name__ == "__main__":
    main()
