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

## Payload convention (proposal — finalised after first real scans)

Technogym console codes are scanned today by the mywellness app to join the
machine to a session; their raw text outside that app is currently unknown.
Next gym visit: scan 2–3 machines with any generic QR-reader app and paste
the raw strings here. Matcher design accepts anything:

1. **Exact match** on a recorded `qr_payload` → the machine, instantly.
2. **Substring/fuzzy match** against machine names and aliases (for codes
   that embed serial numbers or URLs with a machine id).
3. **Pair-on-first-scan**: an unknown code offers the machine list once;
   the choice is saved, so each code is taught exactly once.

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
