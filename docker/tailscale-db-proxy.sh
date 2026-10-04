#!/bin/sh
set -eu

log() {
  printf '%s\n' "[db-proxy] $*"
}

require_env() {
  name="$1"
  value="$2"
  if [ -z "$value" ]; then
    log "Missing required environment variable: $name"
    exit 1
  fi
}

validate_port() {
  name="$1"
  value="$2"
  case "$value" in
    ''|*[!0-9]*)
      log "$name must be a numeric TCP port"
      exit 1
      ;;
  esac

  if [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    log "$name must be between 1 and 65535"
    exit 1
  fi
}

require_env TAILSCALE_DB_HOST "${TAILSCALE_DB_HOST:-}"
require_env TAILSCALE_DB_PORT "${TAILSCALE_DB_PORT:-}"
validate_port TAILSCALE_DB_PORT "$TAILSCALE_DB_PORT"

: "${DB_PROXY_PORT:=15432}"
: "${TAILSCALE_SOCKET:=/tmp/tailscale/tailscaled.sock}"
export DB_PROXY_PORT TAILSCALE_SOCKET
validate_port DB_PROXY_PORT "$DB_PROXY_PORT"

log "Listening on 127.0.0.1:${DB_PROXY_PORT} and forwarding to ${TAILSCALE_DB_HOST}:${TAILSCALE_DB_PORT}."
exec socat \
  TCP-LISTEN:"$DB_PROXY_PORT",bind=127.0.0.1,reuseaddr,fork \
  EXEC:/app/docker/tailscale-nc.sh,nofork
