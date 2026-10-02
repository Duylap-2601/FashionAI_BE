#!/bin/sh
set -eu

is_tailscale_enabled() {
  case "${TAILSCALE_ENABLED:-false}" in
    true|TRUE|1|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

if is_tailscale_enabled; then
  echo "[entrypoint] Tailscale mode enabled; starting supervisor."
  exec /usr/bin/supervisord -c /app/docker/supervisord.conf
fi

# Render free tier khoá Pre-Deploy Command, nên migration phải chạy ngay tại đây
# trước khi app nhận traffic. Chỉ có 1 instance nên không lo nhiều process cùng
# migrate. `migrate deploy` chỉ apply migration mới, an toàn để gọi mỗi lần start.
#
# Neon free tier tự suspend compute khi idle; lần connect đầu sau khi suspend
# cần cold-start (vài giây tới hơn chục giây) và có thể vượt quá timeout nội
# bộ ngắn của Prisma advisory lock (P1002). Đây là lỗi tạm thời, không phải
# lỗi migration thật, nên retry với backoff tăng dần trước khi coi là fail.
MAX_RETRIES=5
RETRY_DELAY=5
attempt=1

echo "[entrypoint] Applying pending Prisma migrations..."
until npm run migrate:deploy; do
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "[entrypoint] Migration failed after $MAX_RETRIES attempts, giving up."
    exit 1
  fi
  echo "[entrypoint] Migration attempt $attempt failed, retrying in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
  attempt=$((attempt + 1))
  RETRY_DELAY=$((RETRY_DELAY + 5))
done

echo "[entrypoint] Starting app..."
exec node dist/main.js
