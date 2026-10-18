# Bridge converters

Stdlib-only Python. Each script documents its own input shape, mapping
decisions and verification in its docstring — read the file, not just this
page.

| Script | Input | Output |
|---|---|---|
| `technogym_fetch.py` | Technogym cloud API (login) | `data/technogym.db` |
| `technogym_export_to_opengym.py` | export folder + live db | `opengym_workouts.csv` + `opengym_weighins.csv` |
| `wii_to_opengym.py` | Folder with `FitPlus*.dat` | `opengym_wii_weighins.csv` |
| `health_connect_to_opengym.py` | Health Data Export folder | `opengym_phone_sessions.csv` + `phone_daily.json` |
| `export_equipment_catalog.py` | legacy Flask `fitness.db` | `equipment_catalog.json` (one-off; output committed) |
| `build_qr_mapping.py` | `equipment_catalog.json` | `qr_mapping.json` |
| `merge_workout_csvs.py` | bridge workout CSVs | one combined import file |
| `dryrun.mjs` / `showday.mjs` | a combined CSV | real-parser verification |
| `mergetest.mjs` | samples + live state copy | idempotency proof (offline) |
| `export_qr.py` | `qr_mapping.json` | `equipment-qr.json` for the app bundle |
| `program_infer.py` + `test_infer.py` | session metrics + catalogs | program guesses in notes |
| `autopush.mjs` | bridge CSVs + login | merge + push into openGym (dry-run default) |
| `pull_all.bat` | everything above | scheduled nightly chain (see AUTO-PULL.md) |

`data/` is the git-ignored source data the bridge owns: `technogym.db` (the live
pull), `technogym_export/`, `wii_fit/`, `health_data_export/`. It travels with
the migration bundle, not with a clone.

`samples/` holds verified outputs from the real data (see
`documentation/BRIDGE-GUIDE.md` for counts). `out/` is the git-ignored
working folder for everyday runs.
