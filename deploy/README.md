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
- `deploy.sh` — pulls `main`, installs the hub and wrapper into
  `/var/www/vv/`, and restarts `auction.service`; safe to run on a timer.
- `auction-autodeploy.service` / `.timer` — run `deploy.sh` every two
  minutes. See [Auto-deploy](#auto-deploy) below.

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

## Auto-deploy

Once enabled, anything merged to `main` is live within about two
minutes, without anyone touching the droplet — the same setup as
Level 0.

A systemd timer runs `deploy/deploy.sh` every two minutes and the
script decides whether there's anything to do:

- **No new commits** — exits immediately, no restart.
- **A game is in progress** — defers and tries again next tick. Rooms
  live in memory, so a restart mid-game would end it. After 45 minutes
  of waiting it deploys anyway. "In progress" comes from
  `GET /api/status` on the local port, which reports counts only.
- **`package-lock.json` changed** — reinstalls dependencies first.
- **The checkout isn't on `main`** — switches it to `main` (the clone
  may have been made from GitHub's old default branch).

`GET /auction/api/status` also reports the commit that's running, so
"is it live yet?" can be answered from a phone browser.

### Enabling it

From the DigitalOcean web console (**Droplets → your droplet →
Access → Launch Droplet Console**):

```bash
cd /opt/auction
sudo git fetch origin && sudo git checkout main && sudo git pull --ff-only origin main
sudo cp deploy/auction-autodeploy.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo /opt/auction/deploy/deploy.sh --force      # deploy what's on main now
sudo systemctl enable --now auction-autodeploy.timer
```

Check it:

```bash
systemctl list-timers auction-autodeploy   # next run time
sudo systemctl start auction-autodeploy    # force a check right now
journalctl -u auction-autodeploy -n 30     # what it did
```

Turn it off with `sudo systemctl disable --now auction-autodeploy.timer`;
deploys go back to being manual with the same script.

## Updating by hand

Always available, whether or not the timer is enabled:

```bash
sudo /opt/auction/deploy/deploy.sh          # deploy if main has moved
sudo /opt/auction/deploy/deploy.sh --force  # deploy even if it hasn't
```

It fast-forwards `/opt/auction` to the latest `main`, reinstalls
dependencies only if `package-lock.json` changed, installs the hub and Platform wrapper into `/var/www/vv/`, restarts
`auction.service`, and verifies the service came back up.

Nginx serves the hub and wrapper straight from disk, so no nginx
reload is needed. If Cloudflare caches the root page, purge `/` after a
hub change.

The script does **not** install the nginx config (`nginx-vv.conf`) or
the systemd units — those rarely change and need their own reload
sequences. Update them by hand when needed.
