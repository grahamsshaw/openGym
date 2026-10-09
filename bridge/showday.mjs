// Show one imported day's workout shape (name, entries, sets).
import { readFileSync } from "node:fs";
import { parseWorkoutCSV, mergeImport } from "../frontend/src/lib/import-csv.js";

const text = readFileSync(process.argv[2], "utf8");
const day = process.argv[3];
const parsed = parseWorkoutCSV(text);
const S = { workouts: [], bodyweight: [], customEx: [], exWeights: {} };
mergeImport(S, parsed);
const x = S.workouts.find((w) => w.d === day);
console.log("name:", x.name, "| entries:", x.entries.length,
  "| sets:", x.entries.reduce((a, e) => a + e.sets.length, 0));
