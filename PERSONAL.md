# OpenGym-Personal

Personal fork of **openGym** (AGPL-3.0, © Duarte Santos — see `LICENSE`,
`NOTICE.md`) plus a data bridge from the Flask fitness-tracker project.
For one person's use only; the server is never exposed to others.

- Upstream: https://github.com/DuarteSantos8/openGym (unchanged code lives
  in `api/`, `frontend/`, `web/`, `docs/` — read those docs first).
- Personal additions live in **`bridge/`** (import converters, equipment
  catalog, QR mapping) and **`documentation/`** (this fork's own notes).
- Start with `documentation/ARCHITECTURE.md`, then
  `documentation/BRIDGE-GUIDE.md`.

## Quick map

| You want to | Go to |
|---|---|
| Run it | Upstream `README.md` + `docs/SELF_HOSTING.md` |
| Import Technogym / Wii Fit / phone data | `bridge/README.md` |
| Automatic nightly pull + push | `documentation/AUTO-PULL.md` |
| How data flows between app and database | `documentation/ARCHITECTURE.md` |
| What's allowed (licences, images) | `documentation/LICENSING.md` |
| Gym QR → exercise plan | `documentation/QR-PLAN.md` |
| Adding .tcx detail to a gym session | `documentation/TCX-IMPORT.md` |
| Health Connect plan (Android) | `documentation/HEALTH-CONNECT-PLAN.md` |
| What Technogym records about programs | `documentation/TECHNOGYM-PROGRAMS.md` |
| Staying signed in on the phone | `documentation/PHONE-ACCESS.md` |
