#!/bin/sh
set -eu

log() {
  printf '%s\n' "[redis-proxy] $*"
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

if [ -z "${TAILSCALE_REDIS_HOST:-}" ]; then
  log "TAILSCALE_REDIS_HOST is not set; Redis proxy disabled."
  exec tail -f /dev/null
fi

: "${TAILSCALE_REDIS_PORT:=6379}"
: "${REDIS_PROXY_PORT:=16379}"
: "${TAILSCALE_SOCKET:=/tmp/tailscale/tailscaled.sock}"
export TAILSCALE_REDIS_PORT REDIS_PROXY_PORT TAILSCALE_SOCKET
validate_port TAILSCALE_REDIS_PORT "$TAILSCALE_REDIS_PORT"
validate_port REDIS_PROXY_PORT "$REDIS_PROXY_PORT"

log "Listening on 127.0.0.1:${REDIS_PROXY_PORT} and forwarding to ${TAILSCALE_REDIS_HOST}:${TAILSCALE_REDIS_PORT}."
exec socat \
  TCP-LISTEN:"$REDIS_PROXY_PORT",bind=127.0.0.1,reuseaddr,fork \
  EXEC:/app/docker/tailscale-redis-nc.sh,nofork
