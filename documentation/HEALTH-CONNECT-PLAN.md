# Health Connect plan (Android)

## Today (works now, no new code besides the inbox)

1. On the phone: **Health Data Export** app reads Health Connect on-device
   and writes `Activity.csv` / `Sleep.csv` / `Vitals.csv`.
2. In openGym (phone browser, PWA, or paired app): **Settings → Data →
   Send phone files to server**, pick the CSVs. They land in
   `data/bridge/inbox/` (`POST /api/bridge/inbox`: signed-in only, 5 MB
   cap, names sanitised, timestamped on collision).
3. The pull chain stages recognised names over the export folder and
   converts as usual — sessions import through the same path, named
   `"<type> (phone)"`, daily steps/sleep/vitals to `phone_daily.json`.

## Later (in-app import button)

- **Where**: Settings → Data, beside "Import from another app"; Android
  only (Health Connect is Android-only; iPhones keep the Apple Health
  weight path upstream already ships).
- **How it works now (personal APK read path)**: Settings → Data →
  **Read phone health data** reads the last 30 days through the native
  plugin (`HealthConnectPlugin.read`, `lib/health-read.js`), shapes the
  result as the export app's CSVs, and uploads them to the server inbox —
  the pull chain consumes them byte-identically to a manual export.
  Needs the personal APK: the official build has no native `read`, and
  the row says so instead of failing quietly. The row is compiled into
  mobile builds only (`MOBILE` flag — the web bundle tree-shakes it out,
  correctly, since browsers cannot reach Health Connect; verified
  `VITE_MOBILE=1` build contains it).
- **Enrichment direction**: phone sessions matched by timestamp against gym
  sessions enrich them (travel/errand steps around a workout stay separate
  daily aggregates; HR from the watch attaches to the session) — the same
  rule the Flask project's `health_connect.process_records` already
  implements; port the rule, not just the rows.
- **Permissions/privacy**: on-device read, no new network traffic, data
  joins the normal sync payload. Nothing leaves the phone except through
  the pairing sync you already trust.

## Custom APK build (prerequisite for the read path above)

The official APK has no native `read` — these steps produce the personal
build that has it. One time per PC:

1. Install **Android Studio** (bundles the SDK) and ensure **Java 21** for
   Gradle. Open `frontend/android` once so it provisions.
2. `cd frontend && npm run build:mobile` (bakes the bundle, `cap sync`).
3. `cd android && ./gradlew assembleRelease`, then sign with your own
   keystore (create once with `keytool`, keep it — updates must reuse it):
   `zipalign` + `apksigner` from the SDK build-tools (see upstream
   `docs/MOBILE.md` for the exact commands).
4. Our build uses applicationId suffix `.personal` (exact edit at build
   time) so it never collides with the official app: **uninstall official
   → install ours → pair again** (server data intact). Thereafter our
   builds install over each other, key unchanged.
5. The Java read method is marked UNTESTED until this compile passes —
   expect first-round fixes (upstream says the same about its own
   unsigned-IPA job).

## What stays manual until then

Copying the export folder off the phone. A Syncthing folder pair (phone
export dir ↔ PC bridge inbox) removes even that step without any code.
