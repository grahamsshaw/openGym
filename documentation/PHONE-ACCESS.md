# Phone access: staying signed in

## You will not be logging in constantly

- Browser/phone sessions last **`SESSION_DAYS` (90 days default)** and a
  paired phone **renews its own token** every start past half-life — a
  phone in regular use never expires.
- Only three things end a session early: **Sign out everywhere**, an admin
  disabling the account, or replacing `data/secret` (so back that file up
  with `data/` — losing it logs every device out at once).

## How sign-in works here

- **Passkeys** (default) need **HTTPS or localhost** — browsers refuse
  WebAuthn over plain-LAN `http://`. On the PC, `http://localhost:8080`
  just works.
- **Phone over LAN**: the app pairs with a one-time code from an already
  signed-in browser (Settings → "Pair the mobile app") and thereafter uses
  a bearer token — **no passkey ceremony on the phone, ever**.
- If passkeys ever annoy you on the PC, upstream offers `PASSWORD_LOGIN=1`
  (.env): name + password sign-in as a fallback. Passkeys stay recommended.

## HTTPS

Needed only if you want passkeys from other LAN devices' browsers. The
phone app does not need it (pairing + token). Upstream `docs/` covers
Cloudflare Tunnel / Caddy / LAN-cert routes when the Pi is back; until
then, localhost on the PC and the paired phone cover everything.
