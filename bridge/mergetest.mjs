// Offline merge test: merge sample CSVs into a COPY of the live server
// state. Everything is already imported, so expect 0 added / all skipped.
// Proves the autopush merge path without touching the server.
import { readFileSync, copyFileSync } from "node:fs";
import { parseWorkoutCSV, parseBodyweight, mergeImport } from "../frontend/src/lib/import-csv.js";

const root = "C:/Users/Graham/Desktop/OpenGym-Personal";
copyFileSync(`${root}/data/state-ZUgGtmRtpQobC65G.json`, `${root}/bridge/out-test-state.json`);
const state = JSON.parse(readFileSync(`${root}/bridge/out-test-state.json`, "utf8"));

const w = mergeImport(state, parseWorkoutCSV(readFileSync(`${root}/bridge/samples/opengym_combined.csv`, "utf8")));
const b = mergeImport(state, parseBodyweight(readFileSync(`${root}/bridge/samples/opengym_weighins.csv`, "utf8")));
console.log(`workouts: added ${w.added}, skipped ${w.skipped}`);
console.log(`weigh-ins: added ${b.added}, skipped ${b.skipped}`);
// The one known gap is deliberate, not drift: 2026-09-26 carries two 105.0
// readings plus a 70.0 outlier (someone else on the gym scale), and the
// importer keeps the last row per day — so it stays unpushed until a human
// deletes the bad row (see the CONFLICT report in technogym_export_to_opengym.py).
// This test runs against the raw samples, so it must always show exactly
// that: 0 new workouts, at most the 1 known-conflict weigh-in.
if (w.added !== 0) {
  console.error("DRIFT: unexpected new workouts appeared");
  process.exit(1);
}
if (b.added > 1) {
  console.error("DRIFT: unexpected new weigh-ins appeared");
  process.exit(1);
}
console.log("OK: idempotent apart from the known 2026-09-26 conflict");
