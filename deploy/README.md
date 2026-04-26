# Deploy — platformvv.com

Artifacts for deploying AUCTION alongside PLATFORM on a single droplet.

## Files

- `nginx-vv.conf` — nginx site config that routes:
  - `/` → landing hub (`/var/www/vv/index.html`)
  - `/platform/` → Godot web export via wrapper (`/var/www/vv/platform/index.html`)
  - `/ws` → Platform relay on `127.0.0.1:8080` (unchanged)
  - `/auction/` → Auction Node server on `127.0.0.1:3100`
- `auction.service` — systemd unit mirroring `platform-relay.service`
- `hub/index.html` — landing page with tiles for PLATFORM, AUCTION, and LEVEL 0
- `platform-wrapper/index.html` — iframes Godot's `Platform_WebClaude.html`
  and overlays a "Hub" link, so we can add navigation chrome without
  editing any Godot-exported files on disk

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

- `8080` — Platform relay (existing)
- `3100` — Auction server (new)

Both bind to `127.0.0.1` and are proxied through nginx on `:80`.
