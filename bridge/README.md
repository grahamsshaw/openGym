# Bridge converters

Stdlib-only Python. Each script documents its own input shape, mapping
decisions and verification in its docstring — read the file, not just this
page.

| Script | Input | Output |
|---|---|---|
| `technogym_export_to_opengym.py` | Technogym export folder | `opengym_workouts.csv` + `opengym_weighins.csv` |
| `wii_to_opengym.py` | Folder with `FitPlus*.dat` | `opengym_wii_weighins.csv` |
| `health_connect_to_opengym.py` | Health Data Export folder | `opengym_phone_sessions.csv` + `phone_daily.json` |
| `export_equipment_catalog.py` | Flask `fitness.db` | `equipment_catalog.json` |
| `build_qr_mapping.py` | `equipment_catalog.json` | `qr_mapping.json` |

`samples/` holds verified outputs from the real data (see
`documentation/BRIDGE-GUIDE.md` for counts). `out/` is the git-ignored
working folder for everyday runs.
