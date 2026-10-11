# QR plan: gym equipment codes → exercises

## Goal

Point the phone at a Technogym machine's QR code mid-session and get that
machine (with its exercises / program modes) added to the current workout —
no typing machine names. openGym has no such feature today: its QR support
is membership check-in codes only (render your code, scan codes via jsQR in
browser / ML Kit on device). The scanner *infrastructure* is reusable; the
equipment mapping is new.

## The mapping table: `bridge/qr_mapping.json` (this repo)

One entry per machine, seeded from `equipment_catalog.json`:

```json
{
  "machine": "Run Excite Live",
  "qr_payload": null,
  "opengym_exercises": ["Run Excite Live: Quick Start"],
  "program_modes": ["Quick Start", "Goals (Time, Distance, Calories)", "..."],
  "notes": "fill qr_payload after scanning with a generic reader"
}
```

`qr_payload` stays `null` until a real scan is recorded — the table works
before that (manual machine pick) and the scanner fills payloads in later.

## Payload convention (decoded October 2026 — no guessing needed)

A `qractive` QR is one base64 blob (checksum after the `.` is ignored),
`| `-separated:

```text
SERIAL | FACILITY-UUID | UnityCoach | Screen15_6 | Android | False
| MODEL | ac095868 | 2.19.2.262 | PlatformEssential || 0 | 1
```

Verified from gym scans (facility matches the Technogym export):

| Machine | Model | Serials seen |
|---|---|---|
| Treadmill / Run Excite Live | 1097 | DFKGAA025004315, DFKGAA025004310 |
| Synchro Excite Live | 1103 | DF5G4A025000180, DF5G4A025000184 |
| Climb Excite Live | 1115 | DFEG3A025001326, DFEG3A025001324 |
| Bike Excite Live | 1121 | DFCG4A025000328 |
| Skill rower | — | `skillrow/rower?et=RWX…` serial-only, no facility block |

**Matcher rule: match on `model_code` (+ facility as sanity check),
ignore serial and checksum.** Two units of the same type differ only in
serial — exactly as predicted. Console routine lists per model are in
`qr_mapping.json` (`console_routines`). The `qractive` URL itself returns
**403 without the app session**, so there is no public repository to
query — identity is decoded offline, routine *content* lives in the
mywellness backend (see below).

## Integration points (openGym code, all existing)

- **Scan**: `jsQR` path in-browser (+ `BarcodeDetector` fast path where
  present); `@capacitor-mlkit/barcode-scanning` on device — same libs the
  check-in feature uses, per upstream `NOTICE.md`.
- **Entry point**: a scan button in the active-workout flow; result resolves
  through `qr_mapping.json` (shipped with the frontend or served from
  `api/`) to an exercise/program-mode picker pre-filled for that machine.
- **Offline**: mapping table bundles with the app; scans resolve with no
  network, same as the rest of the workout flow.

## Program modes per scan

Resolving a machine also surfaces its `program_modes` (from the catalog),
so logging "20 min treadmill" can attach the mode (Weight Loss / HIIT /
Hills…) at record time — the field the later program-inference work
(`TECHNOGYM-PROGRAMS.md`) treats as ground truth.

## As built (v1)

- `bridge/export_qr.py` → `frontend/src/lib/equipment-qr.json` (5
  identified machines; model-code dedupe prefers the fuller program list).
- `lib/qr-resolve.js`: offline decode (model code first, recorded serials
  second) + tests on same-shape synthetic fixtures.
- `exercisePicker(..., { initialEq })`: scanner presets the kit filter;
  unknown tags fall back to any (the picker's own dead-end rule).
- Workout ⋯ Add → **Scan machine** → machine sheet (modes, routines) →
  Choose exercise. Same add commit as the open picker, so history and
  progression behave identically.
