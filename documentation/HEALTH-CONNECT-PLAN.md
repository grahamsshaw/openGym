# Health Connect plan (Android)

## Today (works now, no new code)

1. On the phone: **Health Data Export** app (Play Store) reads Health
   Connect on-device and writes `Activity.csv` / `Sleep.csv` / `Vitals.csv`.
2. Copy the export folder to the PC (USB, Syncthing, whatever is handy).
3. `py bridge/health_connect_to_opengym.py --input <folder> --out bridge/out`
4. Import `opengym_phone_sessions.csv` via **Settings → Data → Import from
   another app**. Sessions land as `"<type> (phone)"` next to `(Technogym)`
   gym rows. Steps/sleep/vitals land in `phone_daily.json` (no CSV columns
   exist for them — kept honestly separate, never faked into workouts).

## Later (in-app import button)

- **Where**: Settings → Data, beside "Import from another app"; Android
  only (Health Connect is Android-only; iPhones keep the Apple Health
  weight path upstream already ships).
- **How**: the Capacitor app reads Health Connect directly (Capacitor
  Health Connect plugin; `READ_STEPS`, `READ_EXERCISE`, `READ_SLEEP`,
  `READ_HEART_RATE` permissions on first use), shapes records exactly like
  the converter above (same field mapping, same `(phone)` naming, same
  `hcsess:`/`hcday:` stable ids for dedup), and writes them into the
  profile state — the code path the CSV import takes after parsing.
- **Enrichment direction**: phone sessions matched by timestamp against gym
  sessions enrich them (travel/errand steps around a workout stay separate
  daily aggregates; HR from the watch attaches to the session) — the same
  rule the Flask project's `health_connect.process_records` already
  implements; port the rule, not just the rows.
- **Permissions/privacy**: on-device read, no new network traffic, data
  joins the normal sync payload. Nothing leaves the phone except through
  the pairing sync you already trust.

## What stays manual until then

Copying the export folder off the phone. A Syncthing folder pair (phone
export dir ↔ PC bridge inbox) removes even that step without any code.
