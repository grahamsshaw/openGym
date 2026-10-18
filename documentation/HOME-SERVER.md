# Running openGym on the home server (Linux Mint + Dockge)

Personal notes for moving the stack off the Windows PC onto the HP Prodesk
mini. Upstream's own deployment docs live in `docs/SELF_HOSTING.md`; this file
records the things that differ for *this* setup: a second compose file, a
Technogym/Wii bridge, and a home network address instead of a domain.

## What is where

Two compose stacks, deliberately separate so an upstream merge never disturbs
the bridge:

| Stack | File | Serves |
| --- | --- | --- |
| `opengym` | `docker-compose.yml` (upstream's) | web + api on port 8080 |
| `opengym-bridge` | `docker-compose.bridge.yml` (ours) | the runner that pulls gym data |

Plus a second repo, `personal-fitness-tracker` (the Flask project), mounted
into the bridge at `/flask` for its Technogym login and database.

## Why the bridge has its own `extra_hosts`

`bridge/.env` points the runner at `http://host.docker.internal:8080`. Docker
Desktop hands that name to containers for free; **plain Docker Engine on Linux
does not**. Without the `host-gateway` mapping in `docker-compose.bridge.yml`
the runner cannot reach openGym, every pull fails with a connection error, and
the reason is not obvious from the logs. Keep that mapping if the file is ever
regenerated.

## The two settings that must change

In `.env`:

```
RP_ID=gym.grahamsshaw.mooo.com                # the DNS name only: no https:// , no path
ORIGIN=https://gym.grahamsshaw.mooo.com       # what you actually type in the browser
WEB_PORT=6080                                 # 8080 was already taken on the Mini
```

`RP_ID` is the WebAuthn relying-party id — a bare hostname. `ORIGIN` drives the
session cookie's `Secure` flag and the CSRF fallback. Neither breaks the
browser UI on its own (a browser sends `Sec-Fetch-Site: same-origin`, which the
API accepts before it ever compares origins), but getting them right is what
keeps you signed in across restarts.

**The app is used at the gym, on the gym's wifi.** So the server has to be
reachable from outside the home network, which means all three of:

1. a DNS `A` record for `gym.grahamsshaw.mooo.com` -> the public IP
2. router port-forward 443 -> Nginx Proxy Manager
3. an NPM Proxy Host: `https://gym.grahamsshaw.mooo.com` ->
   `http://192.168.0.94:6080`, with a Let's Encrypt certificate

Until all three are in place the app only works on the home network, by typing
`http://192.168.0.94:6080`. That is a fine fallback, but it is not the same
thing, and `RP_ID`/`ORIGIN` must then be changed to match whatever address is
in use — the app and the server have to agree about who they are.

In `bridge/.env`:

```
OG_URL=http://host.docker.internal:6080
FLASK_DIR_HOST=/home/<you>/personal-fitness-tracker
```

An absolute path on the Mini. Avoid spaces in the folder name — a space inside a
Docker volume path is a very good way to lose an afternoon.

## Ports

`WEB_PORT` in `.env` is what nginx binds on the host. Nginx Proxy Manager should
proxy to it (set an upstream of `192.168.0.94:8080`); NPM's own 80/443 stay
free for the proxy. Check 8080 is not already taken before starting.

## Starting, in order

```bash
# 1. the app
docker compose up -d --build

# 2. the bridge (separate project name)
docker compose -f docker-compose.bridge.yml up -d --build
```

`--build`, always. The compose files carry upstream's published image names, so
a plain `docker compose pull` would overwrite the API with the official build —
which has no `/api/bridge/*` endpoints, so the pull button silently does nothing
and the stack still looks healthy.

Check what actually got served, because a cached container can serve an old
bundle even after a rebuild:

```bash
curl -s http://192.168.0.94:8080/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

The hash must change after a rebuild; if it does not, `up -d --build
--force-recreate`.

## Finishing the history

The workouts currently on the server predate the MOVEs feature, so they carry
"Move 250" as text in a note rather than as a number. One pass fixes it, in the
app:

1. Settings → **Reset everything** (confirm: *Delete everything*)
2. Settings → **Pull gym + Wii data**

That re-imports all 56 workouts / 255 sets with the MOVEs numbers attached. The
Home screen then shows the Moves card with real history. Expected: 94 sessions
carrying MOVEs.

## Nginx Proxy Manager

Proxy host → Scheme `http`, Forward Hostname/IP `192.168.0.94`, Forward Port
`8080`, Block Common Exploits on, Websockets on. Enable SSL only with a real
hostname; a self-signed certificate works for the browser (the app trusts user
CAs, see `network_security_config.xml`) but browsers will warn on every visit.

## What must never be lost

`data/secret`. It is the key deciding who is signed in. Copy it and every device
stays paired; lose it and each one has to pair again through Settings on the
phone. Back it up alongside `data/`.

## One trap worth naming

The bridge's Technogym login lives in the **Flask project's** `.env`
(`MYWELLNESS_EMAIL` / `MYWELLNESS_PASSWORD`), not in openGym's. The bridge
container mounts the Flask project at `/flask` and reads it from there. That
project is a separate git repository (`grahamshaw/personal-fitness-tracker`),
and its `data/` plus its `.env` are both git-ignored — so cloning it on the Mini
brings code only, and the gym pulls fail until both are restored from the
migration bundle.