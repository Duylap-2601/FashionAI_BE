#!/bin/sh
set -eu

: "${TAILSCALE_SOCKET:=/tmp/tailscale/tailscaled.sock}"

exec tailscale --socket="$TAILSCALE_SOCKET" nc "$TAILSCALE_REDIS_HOST" "$TAILSCALE_REDIS_PORT"
