// Auto-push bridge output into openGym: GET state, merge with the app's OWN
// parser/merger, PUT back. Dry-run by default; --live writes.
//
// Auth is a password-login session (needs PASSWORD_LOGIN=1 on the server
// plus a password set on the profile) or a pairing bearer token:
//
//   node bridge/autopush.mjs --url http://localhost:8080 --user <name> --pass <pw>
//     --workouts bridge/out/opengym_combined.csv --weighins bridge/out/opengym_weighins.csv
//   node bridge/autopush.mjs --url ... --token <bearer> --workouts ... [--live]
//
// Safety: conditional write with baseRev — on a 409 (someone else wrote
// since our GET) it re-fetches, re-merges once, and retries; a second 409
// aborts loudly rather than overwriting. openGym's own merge skips days
// already present, so re-running pushes nothing twice.
import { readFileSync } from "node:fs";
import { parseWorkoutCSV, parseBodyweight, mergeImport } from "../frontend/src/lib/import-csv.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) =>
    a.startsWith("--") ? [a.slice(2), all[i + 1] ?? true] : []
  ).filter((p) => p.length)
);
const URL = (args.url || "http://localhost:8080").replace(/\/$/, "");
const LIVE = Object.hasOwn(args, "live");

async function api(path, { method = "GET", body, cookie, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: res.headers.get("set-cookie") };
}

async function login() {
  if (args.token) return { token: args.token };
  if (!args.user || !args.pass) {
    throw new Error("need --token or --user/--pass");
  }
  const r = await api("/api/login/password", {
    method: "POST",
    body: { name: args.user, password: args.pass },
  });
  if (r.status !== 200 || !r.cookie) {
    throw new Error(`login failed: HTTP ${r.status} ${JSON.stringify(r.data)}`);
  }
  return { cookie: r.cookie.split(";")[0] };
}

async function pushState(auth, state, baseRev) {
  return api("/api/data", {
    method: "PUT",
    body: { state, baseRev },
    ...auth,
  });
}

const auth = await login();
const got = await api("/api/data", auth);
if (got.status !== 200) throw new Error(`GET state failed: HTTP ${got.status}`);
let state = got.data.state;
let rev = got.data.rev;

// Merge weigh-ins first (never conflict), then workouts.
const totals = { added: 0, skipped: 0 };
if (args.weighins) {
  const parsed = parseBodyweight(readFileSync(args.weighins, "utf8"));
  const r = mergeImport(state, parsed);
  totals.added += r.added;
  totals.skipped += r.skipped;
  console.log(`weigh-ins: added ${r.added}, skipped ${r.skipped}`);
}
if (args.workouts) {
  const parsed = parseWorkoutCSV(readFileSync(args.workouts, "utf8"));
  const r = mergeImport(state, parsed);
  totals.added += r.added;
  totals.skipped += r.skipped;
  console.log(`workouts: added ${r.added}, skipped ${r.skipped}`);
}

if (!LIVE) {
  console.log(`dry-run: ${totals.added} would be added, ${totals.skipped} skipped; nothing written`);
  process.exit(0);
}

let put = await pushState(auth, state, rev);
if (put.status === 409) {
  console.log("conflict: server moved, re-merging once");
  const fresh = await api("/api/data", auth);
  state = fresh.data.state;
  rev = fresh.data.rev;
  if (args.weighins) mergeImport(state, parseBodyweight(readFileSync(args.weighins, "utf8")));
  if (args.workouts) mergeImport(state, parseWorkoutCSV(readFileSync(args.workouts, "utf8")));
  put = await pushState(auth, state, rev);
}
if (put.status !== 200) {
  console.error(`PUT failed: HTTP ${put.status} ${JSON.stringify(put.data)}`);
  process.exit(1);
}
console.log(`pushed: added ${totals.added}, skipped ${totals.skipped}, rev ${put.data.rev}`);
