# Architecture: fork + bridge

## The two halves

- **openGym (this repo's root: `api/`, `frontend/`, `web/`)** — the app of
  record. SvelteKit frontend + Node API, data in `./data/db.json`, Docker
  Compose (`web` + `api`). Phone app (Capacitor, Android) pairs to the
  server and syncs. Upstream code is never edited in place for personal
  features; personal changes go in clearly-marked new files so upstream
  merges stay manageable.
- **Bridge (`bridge/`)** — Python converters (stdlib only) that turn the
  existing data sources into files openGym imports natively. Ported from
  our own Flask-project importers (our code, free to reuse). The Flask
  project itself stays untouched as the reference lab and history archive.

## Data flow (option A: bridge, current)

```text
Technogym export JSON ──┐
Wii Fit .dat ───────────┼──▶ bridge/*.py ──▶ openGym CSV/JSON ──▶ Settings → Data → Import
Health Connect CSV ─────┘         │                     ▲
                                  │                     │ sync/pairing
Equipment catalog ────────────────┘              phone app ◀──▶ server (./data/db.json)
QR mapping table ──▶ (future scanner feature, see QR-PLAN.md)
```

- **Into the app:** converters write openGym's generic CSV shape (one row
  per set/session: workout name, exercise, date, weight/reps/time/distance,
  note) plus weigh-ins CSVs. openGym matches exercise names to its library,
  turns unknowns into your own exercises, and skips days that already hold
  a workout — re-importing is safe.
- **Source identity:** every row carries its origin in the name or note
  (`(Technogym)`, `(phone)`, `source technogym/health-connect`) so gym vs
  phone activity is distinguishable in history, and phone rows enrich
  rather than overwrite gym sessions.
- **Things with no CSV column** (daily steps, vitals, sleep, program
  Level/Profile detail beyond the note) go to `phone_daily.json` /
  stay in notes — honestly separated, never fabricated into workouts.

## Later (option B): schema extension

When the app itself must *understand* the extra fields (per-machine
programs, conflict flags, sleep), extend openGym's synced state schema and
the Coach payload allowlist (`api/coach/payload.js` — the AI sees only
what that file copies by name). Deliberately deferred until the bridge has
proven what fields earn their keep.
