# Auto-pull: gym + phone + Wii into openGym, unattended

Yes — the pull half already exists: the Flask project's
`scripts/import_data.py --source all` fetches Technogym (live API),
Wii Fit (Shield folder) and Health Connect CSVs, idempotently
(`ImportLog`/`source_id` dedup). What was missing was the last mile into
openGym. This page closes it: pull → convert → push, all idempotent, all
logged, conflicts aborting loudly instead of overwriting.

## The chain (`bridge/pull_all.bat`)

1. **Pull** — `import_data.py` refreshes the Flask SQLite hub.
2. **Convert** — the three bridge converters + `merge_workout_csvs.py`
   regenerate one combined workouts CSV and the weigh-ins CSVs.
3. **Push** — `bridge/autopush.mjs` (Node, no deps) logs in, `GET`s your
   state, merges with openGym's **own** `parseWorkoutCSV`/`parseBodyweight`
   + `mergeImport`, and `PUT`s back with `baseRev`. Dry-run by default;
   `--live` writes.
4. **Log** — everything appends to `log/pull.log`.

## Auth: password login, not a passkey

A script cannot do a passkey ceremony, so the pusher uses password login:

1. In `OpenGym-Personal/.env`, set `PASSWORD_LOGIN=1`, then
   `docker compose up -d` (config change needs up, not restart).
2. In the app: **Settings → Account → Password** → set one (confirm with
   your passkey). Personal instance, LAN-only: appropriate trade-off,
   documented in `PHONE-ACCESS.md`.
3. Put `OG_USER` (profile name) + `OG_PASS` in the Task Scheduler job's
   environment — never in the repo (`.env` files stay out of git).

Tokens stay valid through use (90-day rolling renewal); a wrong password
pauses that account's password login per upstream throttling, so a typo'd
scheduled job locks itself out loudly rather than hammering.

## Conflict behaviour

- **Server moved since our GET** (you edited on the phone mid-run): the
  `PUT` returns 409 with the current document; the script re-merges once
  and retries, then aborts. Your edits always win over the script.
- **Same-day weigh-in disagreements** (the gym scale's stray 70.0 kg
  readings next to your 105s): the converter prints `CONFLICT` lines —
  resolve by deleting the bad row from the working copy, as with the
  2026-09-26 case. openGym keeps the last row per day, so unreviewed
  conflicts would corrupt history silently; hence the noise.
- **Already-imported days**: skipped by `mergeImport`, reported, never
  duplicated.

## Scheduling (Windows, this PC)

Task Scheduler → Create Task: trigger daily (e.g. 03:00), action
`bridge\pull_all.bat`, "run whether logged on or not" + stored `OG_USER` /
`OG_PASS`. Keep Docker Desktop running (or start it in the task before the
push step). On the Pi later: the same chain under cron/systemd — the Flask
half already runs there; only paths change.

## What stays manual (for now)

- **Phone export**: tapping Export in the Health Data Export app (then the
  folder syncs to the PC). Fully automatic only with the in-app Health
  Connect integration (`HEALTH-CONNECT-PLAN.md`).
- **Wii saves**: change only when the Shield syncs; the scheduled pull
  picks them up when reachable, reports absence otherwise.
- **Technogym credentials**: live in the Flask `.env`, untouched by this
  chain.
