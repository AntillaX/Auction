# Deploy — platformvv.com

Artifacts for deploying AUCTION alongside PLATFORM on a single droplet.

## Files

- `nginx-vv.conf` — nginx site config that routes:
  - `/` → landing hub (`/var/www/vv/index.html`)
  - `/platform/` → Godot web export (`/var/www/vv/platform/`)
  - `/ws` → Platform relay on `127.0.0.1:8080` (unchanged)
  - `/auction/` → Auction Node server on `127.0.0.1:3100`
- `auction.service` — systemd unit mirroring `platform-relay.service`
- `hub/index.html` — landing page with two tiles (PLATFORM, AUCTION)

## Layout on the droplet

```
/var/www/vv/
  index.html            ← landing hub
  platform/             ← moved from /var/www/platform
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
