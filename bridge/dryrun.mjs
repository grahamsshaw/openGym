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

// PERSONAL-MOVES: how much of the Technogym activity survived the import as a
// number. A drop here means notes are being cut before the "Move N" token, or
// the extraction silently stopped matching \u2014 either way the Home card would
// quietly lose history, which is invisible without this line.
const noteEntries = S.workouts.flatMap(w => w.entries).filter(e => e.note);
const withMoves = S.workouts.flatMap(w => w.entries).filter(e => typeof e.moves === "number");
const saysMove = noteEntries.filter(e => /move\s*\d|\d\s*moves?/i.test(e.note));
console.log(`entries: ${noteEntries.length} with a note, ${withMoves.length} with moves, ${saysMove.length} mentioning Move`);
if (saysMove.length > withMoves.length) {
  console.error(`LOST: ${saysMove.length - withMoves.length} entries say Move in the note but carry no moves number`);
  process.exit(1);
}

if (sets !== rows) {
  console.error(`LOSS: ${rows - sets} rows did not survive`);
  process.exit(1);
}
console.log("OK: every row survived as a set");
