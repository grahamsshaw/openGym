# Running openGym on the home server (Linux Mint + Dockge)

Personal notes for moving the stack off the Windows PC onto the HP Prodesk
mini. Upstream's own deployment docs live in `docs/SELF_HOSTING.md`; this file
records the things that differ for *this* setup: a second compose file, a
Technogym/Wii bridge, and a home network address instead of a domain.

## What is where

## Packing the move

Everything openGym keeps out of git — the account, the history, the session
secret, the bridge's credentials and source data — goes in one small archive:

```bash
py scripts/make-migration-bundle.py --out ~/opengym-migration.tar.gz \
    --rp-id gym.grahamsshaw.mooo.com \
    --origin https://gym.grahamsshaw.mooo.com \
    --port 6080
```

The address is an **argument on purpose**. Copying `.env` off the running
machine ships its `RP_ID=localhost` and `ORIGIN=http://localhost:8080`, and the
new server then answers to itself and logs you out on every restart. That is
the one mistake this script exists to stop, so it rewrites those three keys
whatever the source says.

## Two compose stacks, deliberately separate so an upstream merge never disturbs
the bridge:

| Stack | File | Serves |
| --- | --- | --- |
| `opengym` | `docker-compose.yml` (upstream's) | web + api on port 8080 |
| `opengym-bridge` | `docker-compose.bridge.yml` (ours) | the runner that pulls gym data |

Plus one more folder the bridge owns, `bridge/data/`, holding the Technogym
live database, the gym export, Wii Fit dumps and Health Connect CSVs. Nothing
else is needed: the bridge's Technogym login is `bridge/technogym_fetch.py`, so
there is no second repository to clone.

## Why the bridge has its own `extra_hosts`

`bridge/.env` points the runner at `http://host.docker.internal:8080`. Docker
Desktop hands that name to containers for free; **plain Docker Engine on Linux
does not**. Without the `host-gateway` mapping in `docker-compose.bridge.yml`
the runner cannot reach openGym, every pull fails with a connection error, and
the reason is not obvious from the logs. Keep that mapping if the file is ever
regenerated.

## The settings that must change

In `.env`:

```
RP_ID=gym.grahamsshaw.mooo.com          # the DNS name only: no https:// , no path
ORIGIN=http://192.168.0.94:6080         # the address you ACTUALLY type in the browser
WEB_PORT=6080                           # 8080 was already taken on the Mini
```

**`ORIGIN` must match the address in the browser bar, not the address you
intend to use eventually.** This is the setting that produces the most
confusing failure, because nothing is wrong until you try to sign in:

```
cross-origin request refused
```

The API guards every state-changing POST (`api/server.js`). It lets one
through by `Sec-Fetch-Site: same-origin`, which most browsers send — but not
all, and not through every proxy. Failing that it compares the request's
`Origin` against `ORIGIN`. So while browsing `http://192.168.0.94:6080`, an
`ORIGIN` of `https://gym.grahamsshaw.mooo.com` refuses the sign-in. Measured,
with the LAN address typed in the browser:

| `ORIGIN` is | browser sends `Sec-Fetch-Site` | result |
| --- | --- | --- |
| `https://gym...` | no | **403 cross-origin request refused** |
| `https://gym...` | `same-origin` | 200 |
| `http://192.168.0.94:6080` | no | 200 |

So there are two legitimate settings, and they swap when you move:

- **On the home network now** — `ORIGIN=http://192.168.0.94:6080`
- **Once DNS, port-forward and the NPM certificate are all live**, when you
  browse `https://gym.grahamsshaw.mooo.com` — set
  `ORIGIN=https://gym.grahamsshaw.mooo.com` and rebuild with
  `docker compose up -d`. Until then, requests from the https name are refused.

Changing `.env` needs `docker compose up -d`, not `restart`: the value is
baked in when the container is created.

`RP_ID` only matters for passkeys, which need a real https domain anyway — an
IP address is not a valid relying-party id. Passkeys made while the server was
on `localhost` cannot work on any other address; re-register one once the
domain is live.

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
```

Everything else the bridge needs is already set in that file, and travels with
the bundle: the openGym password profile for the push, and the Technogym cloud
credentials (`MYWELLNESS_EMAIL` / `MYWELLNESS_PASSWORD`).

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

## The Technogym login

It lives in `bridge/.env` as `MYWELLNESS_EMAIL` / `MYWELLNESS_PASSWORD` — the
same MyWellness account as the gym's own app — and is used by
`bridge/technogym_fetch.py`. That script used to be `import_data.py` inside the
old Flask project; it was the only piece of that project still in use, and it
is now a script of our own.

`bridge/data/` is git-ignored (it is your data), so it travels with the
migration bundle rather than with the clone. If gym pulls come back empty after
the move, that folder is the thing to check.

## One trap worth naming

`bridge/.env` and `bridge/data/` are both git-ignored — that is correct, they
hold your passwords and your gym data. It also means a `git clone` on the Mini
brings neither. Both travel in the migration bundle instead, and until they are
in place the pull button returns nothing while the rest of the app looks
perfectly healthy. If gym pulls come back empty, check those two first.