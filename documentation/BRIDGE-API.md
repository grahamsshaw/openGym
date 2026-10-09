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

## New server surface (personal additions, marked as such)

- `api/bridge.js` (new file): the two endpoints above, auth-gated like
  every other `/api/*` route, rate-limited, audit-logged.
- One entry each in the `routes` table in `api/server.js` (marked
  `// PERSONAL`), nothing else upstream touched.
- A `bridge` compose service (Python) that owns credentials/paths and
  does the actual pulling — the API container holds no secrets and
  spawns nothing; it writes a trigger the bridge service consumes.
  Keeps upstream's "API spawns nothing" posture intact.

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
