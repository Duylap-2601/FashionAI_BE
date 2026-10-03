#!/bin/sh
set -eu

log() {
  printf '%s\n' "[app-bootstrap] $*"
}

is_tailscale_enabled() {
  case "${TAILSCALE_ENABLED:-false}" in
    true|TRUE|1|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
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

wait_for_tailscaled() {
  timeout_seconds="${TAILSCALE_STARTUP_TIMEOUT_SECONDS:-60}"
  validate_port TAILSCALE_STARTUP_TIMEOUT_SECONDS "$timeout_seconds"
  deadline=$(( $(date +%s) + timeout_seconds ))

  while [ ! -S "$TAILSCALE_SOCKET" ]; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "Timed out waiting for tailscaled socket"
      exit 1
    fi
    sleep 1
  done
}

tailscale_up() {
  require_env TS_AUTHKEY "${TS_AUTHKEY:-}"
  wait_for_tailscaled

  hostname="${TAILSCALE_HOSTNAME:-fashionai-be-render}"
  log "Authenticating Tailscale node..."
  tailscale --socket="$TAILSCALE_SOCKET" up \
    --auth-key="$TS_AUTHKEY" \
    --hostname="$hostname" \
    --accept-dns=false \
    --reset >/dev/null

  log "Tailscale is ready."
}

wait_for_database() {
  timeout_seconds="${DB_CONNECT_TIMEOUT_SECONDS:-60}"
  validate_port DB_CONNECT_TIMEOUT_SECONDS "$timeout_seconds"
  deadline=$(( $(date +%s) + timeout_seconds ))

  log "Checking database connectivity with Prisma..."
  while true; do
    if printf 'SELECT 1;' | npx prisma db execute --stdin --schema prisma/schema.prisma >/dev/null 2>&1; then
      log "Database connectivity check passed."
      return 0
    fi

    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "Timed out waiting for database connectivity."
      return 1
    fi

    sleep 2
  done
}

run_migrations() {
  max_retries="${MIGRATION_MAX_RETRIES:-5}"
  retry_delay="${MIGRATION_RETRY_DELAY_SECONDS:-5}"
  validate_port MIGRATION_MAX_RETRIES "$max_retries"
  validate_port MIGRATION_RETRY_DELAY_SECONDS "$retry_delay"

  attempt=1
  log "Applying pending Prisma migrations..."
  until npm run migrate:deploy; do
    if [ "$attempt" -ge "$max_retries" ]; then
      log "Migration failed after $max_retries attempts."
      exit 1
    fi

    log "Migration attempt $attempt failed, retrying in ${retry_delay}s..."
    sleep "$retry_delay"
    attempt=$((attempt + 1))
    retry_delay=$((retry_delay + 5))
  done
}

if is_tailscale_enabled; then
  : "${TAILSCALE_SOCKET:=/tmp/tailscale/tailscaled.sock}"
  export TAILSCALE_SOCKET
  require_env TAILSCALE_DB_HOST "${TAILSCALE_DB_HOST:-}"
  require_env TAILSCALE_DB_PORT "${TAILSCALE_DB_PORT:-}"
  validate_port TAILSCALE_DB_PORT "$TAILSCALE_DB_PORT"
  validate_port DB_PROXY_PORT "${DB_PROXY_PORT:-15432}"
  if [ -n "${TAILSCALE_REDIS_HOST:-}" ]; then
    validate_port TAILSCALE_REDIS_PORT "${TAILSCALE_REDIS_PORT:-6379}"
    validate_port REDIS_PROXY_PORT "${REDIS_PROXY_PORT:-16379}"
  fi
  tailscale_up
fi

wait_for_database
run_migrations

log "Starting NestJS app..."
exec node dist/main.js
