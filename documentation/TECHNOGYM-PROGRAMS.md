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

## AI hook (deferred with the rest of the AI work)

The Coach sees only its payload allowlist, so program labels and segment
summaries must reach openGym's synced state (option B schema extension)
before any "suggest a run like Tuesday's hill session" feature can use
them. The `note` column preserves the raw material on every imported
session until then.
