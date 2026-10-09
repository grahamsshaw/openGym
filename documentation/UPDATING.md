# Updating: upstream merges + image rebuilds

## Taking an upstream release (e.g. v1.4.0)

```text
git fetch upstream
git merge upstream/main -m "Merge upstream vX.Y.Z (...)"
```

Conflicts so far have been trivial (shared import lines, `.gitignore`
tails) — resolve by keeping both sides. Then:

```text
cd api && node --test test/bridge.test.js   # personal endpoints
docker compose up -d --build                # rebuild BOTH images
curl http://localhost:8080/api/health
```

Re-run the bridge test after every merge; upstream refactors the files
around our marked blocks regularly.

## The golden rule: never plain `docker compose pull`

The `api` image is **built locally** (`--build`), because it contains
`api/bridge.js` + our two routes. A bare `compose pull` replaces it with
upstream's prebuilt image and the bridge endpoints silently vanish (the
app keeps working — the buttons just 401/404). After any pull, always
follow with `docker compose up -d --build api`. The `web` image is
unmodified upstream and safe to pull.

## Phone app

The in-app updater tracks upstream releases — safe to take (the project
guarantees server/client cross-version compat, and our server additions
are purely additive). Our future custom build replaces it once (uninstall
+ reinstall + pair again; server data intact).
