#!/usr/bin/env bash
# deploy.sh — pull latest main and refresh platformvv.com from this clone.
#
# Run on the droplet from anywhere; the script locates its own repo root.
# Requires sudo for the file copies and the systemd restart (no-op when
# already running as root). --ff-only makes the pull fail loudly if local
# state has diverged from main instead of silently producing a merge.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Pulling latest main"
git pull --ff-only origin main

echo "==> Refreshing static assets"
sudo install -m 644 deploy/hub/index.html              /var/www/vv/index.html
sudo install -m 644 deploy/platform-wrapper/index.html /var/www/vv/platform/index.html

echo "==> Restarting auction.service"
sudo systemctl restart auction.service

echo "==> Done."
