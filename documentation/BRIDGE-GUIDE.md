# Bridge guide: getting history into openGym

All converters are stdlib-only Python. Outputs go to a folder you choose
(`bridge/out/` is git-ignored; verified samples live in `bridge/samples/`).

## 1. Technogym export → workouts + weigh-ins

```text
py bridge/technogym_export_to_opengym.py --input <technogym_export folder> --out bridge/out
```

Writes `opengym_workouts.csv` (167/167 sessions in the verified export)
and `opengym_weighins.csv` (biometrics + in-session UserWeight rows).
Exercise names are *inferred* from metrics (treadmill/bike/rower/climb/
strength) because the export names no machine — rows from the live API
(which carries `physicalActivityName`/`equipmentName`) should prefer those
names. The `note` column keeps Level, Profile, HR, MOVEs and segment
counts for later program inference. Then: **Settings → Data → Import from
another app**, pick the workouts file; import the weigh-ins the same way.

## 2. Wii Fit saves → weigh-ins

```text
py bridge/wii_to_opengym.py --input <folder with FitPlus*.dat> --out bridge/out
```

Writes `opengym_wii_weighins.csv` (one row per day; openGym keeps one
weigh-in/day anyway). Point `--input` at the Shield's save folder (SMB) —
the local `data/wii_fit` copies in the Flask project are blank placeholders
(all-zero body-test slots), which is why the sample output is header-only.
Parser correctness is proven by a synthetic round-trip test, not by those
files. `FitPlus2.dat` is skipped with a note (no profiles in it).

## 3. Health Connect export → phone sessions + daily file

```text
py bridge/health_connect_to_opengym.py --input <Health Data Export folder> --out bridge/out
```

Writes `opengym_phone_sessions.csv` (verified: 83 activity rows → 74
sessions) and `phone_daily.json` (31 days of steps/distance/calories/
vitals + 44 sleep sessions). Sessions import through the same **Import
from another app** path and are named `"<type> (phone)"` so they read as
phone activity next to `(Technogym)` gym rows. Steps/sleep/vitals have no
CSV columns — they live in `phone_daily.json` for the later schema
extension, documented in `HEALTH-CONNECT-PLAN.md`.

## 4. Equipment catalog

```text
py bridge/export_equipment_catalog.py --db <fitness.db> --out bridge/
```

Dumps the researched Technogym machines (9 machines: Run/Bike/Climb/
Synchro Excite Live, Treadmill, selection-line strength machines) with
program modes and muscles to `bridge/equipment_catalog.json`. Re-run after
any catalog edit in the Flask project.

## Import order and safety

Import weigh-ins first (they never conflict), then workouts. Everything is
re-runnable: converters are pure functions of their inputs, and openGym
skips already-imported days. The Flask project's database remains the
archive of record until the bridge has carried everything across.
