// Dry-run openGym's REAL importer over the combined CSV into empty state.
// Usage: node bridge/dryrun.mjs <combined.csv>
// Asserts every source row survives as a set (same-day cross-source rows
// must merge into one workout, not drop).
import { readFileSync } from "node:fs";
import { parseWorkoutCSV, mergeImport } from "../frontend/src/lib/import-csv.js";

const text = readFileSync(process.argv[2], "utf8");
const parsed = parseWorkoutCSV(text);
const S = { workouts: [], bodyweight: [], customEx: [], exWeights: {} };
const result = mergeImport(S, parsed);

let sets = 0;
for (const w of S.workouts) for (const e of w.entries) sets += e.sets.length;
const rows = text.trim().split("\n").length - 1;
console.log(`rows: ${rows}, workouts: ${S.workouts.length}, sets: ${sets}`);
console.log(`added: ${result.added}, skipped: ${result.skipped}`);
if (sets !== rows) {
  console.error(`LOSS: ${rows - sets} rows did not survive`);
  process.exit(1);
}
console.log("OK: every row survived as a set");
