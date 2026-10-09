# Phone button + server trigger: design

## The one architectural fact

A button on the phone **cannot run scripts on the server directly** —
it can only *ask* the server to run them (an API call), and *send* the
server data the phone alone can reach (Health Connect lives on the
device; no server can fetch it). So the button does two jobs:

1. **"Pull gym + Wii"** → `POST /api/bridge/pull` (authenticated, same
   sign-in as everything else). The server runs the pull chain itself —
   Technogym login, Shield folder, converters, merge, push into state —
   where the credentials and paths already live. Nothing secret ever sits
   on the phone. The button then reports added/skipped, exactly like the
   desktop `pull_all.bat` log.
2. **"Send phone data"** → the app reads Health Connect on-device (last
   N days, bounded), shows what it found, and `POST`s it to
   `/api/bridge/phone` (same shapes as `health_connect_to_opengym.py`
   produces). The server merges it into state through the same
   `mergeImport` path. A local file copy stays on the phone too, so the
   transfer is inspectable, not magic.

As built: phone files travel through **`POST /api/bridge/inbox`** (a
file dropbox under `data/bridge/inbox/`, consumed by the pull chain)
plus a **Send phone files to server** row in Settings → Data that works
in the browser, the PWA and the paired phone app alike. Direct
Health-Connect-to-state upload stays a custom-APK feature
(`HEALTH-CONNECT-PLAN.md`); the inbox covers every device today.

## New server surface (personal additions, marked as such) — BUILT

- `api/bridge.js` (new file): filesystem job queue under `DATA_DIR/bridge/`.
  `requestPull` coalesces impatient repeats onto the pending job and refuses
  unknown sources; `pullStatus` reports runner freshness (heartbeat
  `runner.json` < 10 min), pending jobs and the last result.
- `api/server.js`: one import line, two `routes` entries and two
  `THROTTLED` entries, every line marked `PERSONAL-BRIDGE`. Upstream's
  "API spawns nothing" posture is unchanged — the endpoints only queue.
- `api/Dockerfile`: `bridge.js` added to the explicit `COPY` list (the
  file's own comment demands it; without this the built image fails at
  boot — verified by reading the Dockerfile, not by breaking it).
- `api/test/bridge.test.js`: boots the real server in a child with a temp
  data dir — 401s without a session, queue + coalesce + status with one,
  400 on unknown sources.
- Verified: new test passes; boot/routing/auth/password/data-rev suites
  pass 36/37 with the single failure (a Coach debrief test) proven
  pre-existing on the clean tree (Windows-environment, unrelated).

## Phone UI (new code,Capacitor app + PWA alike)

- Settings → Data: **"Pull gym + Wii data"** and **"Send phone health
  data"** buttons with last-run time + result line (added/skipped).
- Health Connect permission request on first use (`READ_STEPS`,
  `READ_EXERCISE`, `READ_SLEEP`, `READ_HEART_RATE`); graceful "not
  available" on devices without it.
- Day-window picker (default: since last successful send — the server
  tells the phone what it already holds, so repeats send nothing twice).

## Ordering with the rest

1. Server endpoints + bridge service (testable from this PC today).
2. Phone buttons against the local server (same Wi-Fi).
3. Pairing/HTTPS story unchanged: buttons ride the existing session.
