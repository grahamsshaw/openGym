# Licensing for this personal fork

## openGym application code: GNU AGPL v3.0 — personal use is free and clear

`LICENSE` + `NOTICE.md` (upstream, © 2026 Duarte Santos) stay in place,
unmodified. The AGPL expressly permits running, modifying and running
modified versions for any purpose. Because this instance serves one person
and is never exposed to others, **no share-alike obligation triggers**:
nothing to publish, no permission to seek. Keep the licence files intact —
that is the whole of the attribution duty here.

If that ever changes (anyone else gets an account, or the server is put on
the internet for others), the duty is: offer the complete corresponding
source of the running version under AGPL-3.0. Revisit this file then.

## Our bridge code: yours, no restrictions

`bridge/` converters, `documentation/`, `qr_mapping.json` and the catalog
export are your own code, ported from your own Flask project. Reuse freely.
Note the one consequence: combined with AGPL code into one program, the
*combined work* follows AGPL terms — irrelevant while personal-only,
relevant only if the fork is ever distributed (see above).

## Exercise metadata (English names, attributes, instructions): MIT

Via the exercises-dataset (© Hasan Emir Yıldırım), attribution kept in
upstream `NOTICE.md`. Usable with the notice intact — already satisfied.

## Exercise images/animations: NOT bundled — official download instead

Ownership of the demo thumbnails/animations is disputed (Gym visual vs
ExerciseDB/AscendAPI; see upstream `NOTICE.md` "Images & animations").
They are covered by neither the MIT metadata licence nor the AGPL, and
upstream deliberately does not ship them. So this fork does not bundle or
commit them either:

- `media/img/` + `media/gif/` are git-ignored upstream and populate on the
  **first `docker compose up`** (~140 MB official download) or via
  `scripts/fetch-media.sh`. That channel — not a copied folder — is how
  this project gets its images, legitimately and updateably.
- The `Resources_Archive/opengym-examples/images/` copies in the Flask
  project are **not** imported here and must not be committed here.
- If provenance is ever settled, revisit — until then, use-but-don't-
  redistribute is the posture, and personal-only use stays on the safe side.

## Chart.js, QR libs, other dependencies

MIT/Apache-2.0 packages per upstream `NOTICE.md` (lean-qr, jsQR, Chart.js).
Keep their notices intact; no action needed beyond not stripping them.
