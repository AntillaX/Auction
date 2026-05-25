# Deploy — platformvv.com

Artifacts for deploying AUCTION alongside PLATFORM on a single droplet.

## Files

- `nginx-vv.conf` — nginx site config that routes:
  - `/` → landing hub (`/var/www/vv/index.html`)
  - `/platform/` → Godot web export via wrapper (`/var/www/vv/platform/index.html`)
  - `/ws` → Platform relay on `127.0.0.1:8080` (unchanged)
  - `/auction/` → Auction Node server on `127.0.0.1:3100`
  - `/level0/` → Level 0 Node server on `127.0.0.1:3200`
  - `/acdc/` → AC/DC Node server on `127.0.0.1:3300`
- `auction.service` — systemd unit mirroring `platform-relay.service`
- `hub/index.html` — landing page with featured tiles for PLATFORM,
  AUCTION, and AC/DC, with a small "Level 0" aside link
- `platform-wrapper/index.html` — iframes Godot's `Platform_WebClaude.html`
  and overlays a "Hub" link, so we can add navigation chrome without
  editing any Godot-exported files on disk
- `deploy.sh` — one-command refresh: pulls `main`, copies the static
  files into `/var/www/vv/`, and restarts `auction.service`. See
  [Updating the droplet](#updating-the-droplet) below.

## Layout on the droplet

```
/var/www/vv/
  index.html            ← landing hub (deploy/hub/index.html)
  platform/             ← moved from /var/www/platform
    index.html          ← wrapper (deploy/platform-wrapper/index.html)
    Platform_WebClaude.html
    Platform_WebClaude.pck
    ...

/opt/auction/           ← cloned from github.com/antillax/auction
  server.js
  public/
  ...
```

## Ports

- `8080` — Platform relay
- `3100` — Auction server
- `3200` — Level 0 server
- `3300` — AC/DC server

All bind to `127.0.0.1` and are proxied through nginx on `:80`.

## Updating the droplet

After merging changes to `main`, SSH into the droplet and run:

```bash
cd /opt/auction
./deploy/deploy.sh
```

That fast-forwards `/opt/auction` to the latest `main`, copies
`deploy/hub/index.html` → `/var/www/vv/index.html`,
`deploy/platform-wrapper/index.html` → `/var/www/vv/platform/index.html`,
and restarts `auction.service`. Nginx static files are served straight
from disk so no nginx reload is needed for the hub/wrapper updates.

The script does **not** install the nginx config (`nginx-vv.conf`) or
the systemd unit (`auction.service`) — those rarely change and require
their own reload sequences. Update them by hand when needed.
