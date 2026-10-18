#!/usr/bin/env python3
"""Pack the files openGym keeps out of git, for moving the server elsewhere.

Everything this copies is deliberately untracked: the account, the history, the
session secret, the bridge's credentials and source data. The code comes from
git; this is the rest.

The settings are arguments, never copied from the machine that runs it. The
whole point is that the *source* box's .env says localhost, and copying that
straight over is how a server arrives pointing at itself.

Usage::

    py scripts/make-migration-bundle.py --out C:/path/to/bundle.tar.gz \\
        --rp-id gym.example.com --origin https://gym.example.com --port 6080

Then on the new machine, from its clone::

    tar -xzf bundle.tar.gz
    cp opengym/.env         openGym/.env
    cp -r opengym/data      openGym/
    cp opengym/bridge.env   openGym/bridge/.env
    cp -r opengym/bridge-data openGym/bridge/data
    cp -r opengym/out       openGym/bridge/out

The archive is NOT encrypted and holds passwords. Move it over a trusted
network or on a USB stick, and delete it once the new server is verified.
"""
from __future__ import annotations

import argparse
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding="utf-8")

# .env key -> command line flag. Only these are rewritten; everything else in
# the file is left exactly as the running server had it.
SETTINGS = {
    "RP_ID": "--rp-id",
    "ORIGIN": "--origin",
    "WEB_PORT": "--port",
}

README = """openGym migration bundle

NOT encrypted. Holds your account, history, session secret and passwords.
Move it over a trusted network or on a USB stick; delete it once the new
server is verified working.

  opengym/.env          ->  <clone>/.env
  opengym/data/         ->  <clone>/data/                (do not touch)
  opengym/bridge.env    ->  <clone>/bridge/.env
  opengym/bridge-data/  ->  <clone>/bridge/data/
  opengym/out/          ->  <clone>/bridge/out/

Every git-ignored thing openGym has is in here, so a clone brings the code
only. If gym pulls come back empty, check bridge/.env and bridge/data/.

Do NOT run `docker compose pull` on the new machine: the image names point at
upstream's published builds, which have no bridge endpoints. Always --build.
Do NOT delete data/secret: it is what keeps devices signed in.
"""


def set_env(text: str, values: dict[str, str]) -> str:
    """Replace or append the given keys in a .env file's text."""
    lines = text.splitlines()
    for key, value in values.items():
        entry = f"{key}={value}"
        replaced = False
        for i, line in enumerate(lines):
            if line.startswith(f"{key}="):
                lines[i] = entry
                replaced = True
                break
        if not replaced:
            lines.append(entry)
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="where to write the .tar.gz")
    ap.add_argument("--rp-id", required=True,
                    help="RP_ID: the relying-party hostname, no scheme and no port")
    ap.add_argument("--origin", required=True,
                    help="ORIGIN: the address you will actually type in the browser, "
                         "scheme and port included. This is not the address you "
                         "expect to use eventually: setting ORIGIN to a domain that "
                         "is not live yet makes sign-in fail with 'cross-origin "
                         "request refused'")
    ap.add_argument("--port", required=True, help="WEB_PORT on the new machine")
    args = ap.parse_args()

    sources = {
        ".env": ROOT / ".env",
        "bridge.env": ROOT / "bridge" / ".env",
        "data": ROOT / "data",
        "bridge-data": ROOT / "bridge" / "data",
        "out": ROOT / "bridge" / "out",
    }
    missing = [name for name, path in sources.items() if not path.exists()]
    if missing:
        print(f"missing on this machine: {', '.join(missing)}")
        return 1

    env_text = set_env(sources[".env"].read_text(encoding="utf-8"), {
        "RP_ID": args.rp_id, "ORIGIN": args.origin, "WEB_PORT": args.port,
    })
    bridge_text = set_env(
        sources["bridge.env"].read_text(encoding="utf-8"),
        {"OG_URL": f"http://host.docker.internal:{args.port}"})

    # data/secret is what decides who is signed in; a bundle without it means
    # every device pairs again. Worth stopping over.
    secret = sources["data"] / "secret"
    if not secret.is_file():
        print("data/secret is missing - every device would have to pair again")
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out, "w:gz") as tar:
        for name in ("bridge-data", "data", "out"):
            tar.add(sources[name], arcname=f"opengym/{name}")
        for name, text in ((".env", env_text), ("bridge.env", bridge_text)):
            info = tarfile.TarInfo(f"opengym/{name}")
            data = text.encode("utf-8")
            info.size = len(data)
            import io
            tar.addfile(info, io.BytesIO(data))
        readme = README.encode("utf-8")
        info = tarfile.TarInfo("README-migration.txt")
        info.size = len(readme)
        import io
        tar.addfile(info, io.BytesIO(readme))

    size = out.stat().st_size
    print(f"{out}  ({size/1024:.0f} KB)")
    print(f"  RP_ID   {args.rp_id}")
    print(f"  ORIGIN  {args.origin}")
    print(f"  port    {args.port}")
    print("  not encrypted - delete it once the new server is verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())