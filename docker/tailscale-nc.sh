#!/bin/sh
set -eu

: "${TAILSCALE_SOCKET:=/tmp/tailscale/tailscaled.sock}"

exec tailscale --socket="$TAILSCALE_SOCKET" nc "$TAILSCALE_DB_HOST" "$TAILSCALE_DB_PORT"
