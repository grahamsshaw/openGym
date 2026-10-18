# Technogym program data: what exists and how to infer the rest

Verified October 2026 against the real 167-session `indooractivities`
export (plus `biometrics`, plus the live-API importer in the Flask
project). This is the reference for all cardio-program work.

## Present in the stored export (per session)

Duration, Calories, MOVEs, distance/speed/pace (`HDistance`, `AvgSpeed`,
`MaxSpeed`, `Pace`), heart rate (`AvgHr`, `MaxHr`, `WattMaxHr`), power
(`AvgPower`), cadence (`AvgRpm`), elevation/floors, METs/VO₂, compliance —
plus a numeric **`Level`** (19 sessions: 6.0, 10.0, 12.0…) and a numeric
**`Profile`** code (2.0, twice), plus per-segment summaries (`st`, present
in 120/167 sessions) with per-block duration/speed/HR.

## Absent from the stored export

- **Program name** ("Hills", "Weight Loss"): nowhere. `Level`/`Profile`
  are bare numbers.
- **Machine name**: no `equipmentName` here; `masterdata` is the user
  profile, not a catalog, so the 46 distinct `phId` values resolve to
  nothing locally.
- **Mid-session changes**: only segment averages survive; the act of
  changing settings (tired / pushing) is invisible.

## Present via the live API only

`physicalActivityName` + `equipmentName` per exercise (Flask importer
`technogym.py` already stores these). No program-name field observed;
worth one probe call when the server is back, but not planned on.

## Inference strategy (for later discussion)

1. **Segments are the key**, as suspected: programs vary across blocks, so
   per-block speed/level/HR shapes (ramps = hills, intervals = HIIT, flat
   = steady/weight-loss) are the fingerprint. `Level` + `Profile` anchor it.
2. **Catalog grounding**: `bridge/equipment_catalog.json` lists what each
   machine can even run — inference proposes only modes the machine has.
3. **Ground truth capture**: log `program_mode` at session time wherever
   possible (Flask runner already supports it; QR resolution surfaces the
   mode picker per `QR-PLAN.md`). Each logged mode + its segment shape
   trains the inference for the unlabeled history.
4. **Fallback**: time + calories across exercise types as rough intensity —
   always available, never misleading.

## Inference v1 (built): stated > shape > silence

`bridge/program_infer.py`, applied to export rows at convert time (live
rows already state their program in the exercise name):

1. Name contains a machine-menu phrase → that phrase, 0.9.
2. Level ≥ 8 with climb, or level ≥ 10 → Hills, 0.7/0.65.
3. 20+ min with flat heart rate → Steady, 0.6.
4. Else nothing. Intervals are never guessed without block shapes.

Guesses render in notes as "likely Hills (7/10)". On the verified export,
4 of 167 rows earn one — conservative on purpose.

**Since: the .tcx files carry the block shape.** A console export holds every
few seconds of speed, which is exactly the evidence rule 2 lacked — it is why
intervals were never guessed. Settings → Data → Add gym machine files (.tcx)
folds that shape into the session it belongs to (see `TCX-IMPORT.md`), and the
effort is then described on the entry ("19 speed levels 5.1-10.3 km/h …
hi-lo blocks"). The name is still not certain from shape alone: the console's
own label, when it gives one, still wins.

## AI hook (deferred with the rest of the AI work)

The Coach sees only its payload allowlist, so program labels and segment
summaries must reach openGym's synced state (option B schema extension)
before any "suggest a run like Tuesday's hill session" feature can use
them. The `note` column preserves the raw material on every imported
session until then.
