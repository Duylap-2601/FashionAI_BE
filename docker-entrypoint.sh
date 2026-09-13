#!/bin/sh
set -e

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

# Resolve known failed migrations so prisma migrate deploy can proceed.
# This is safe to run repeatedly — if the migration is already resolved it
# becomes a no-op (Prisma just errors harmlessly).
echo "[entrypoint] Resolving failed migrations (if any)..."
npx prisma migrate resolve --rolled-back 202609130001_order_payment_shipping_foundation 2>&1 || true

echo "[entrypoint] Applying pending Prisma migrations..."
until npm run migrate:deploy; do
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "[entrypoint] Migration failed after $MAX_RETRIES attempts, giving up."
    exit 1
  fi
  echo "[entrypoint] Migration attempt $attempt failed, retrying in ${RETRY_DELAY}s..."

  # On retry, resolve the migration again in case it just failed
  echo "[entrypoint] Re-resolving migration before retry..."
  npx prisma migrate resolve --rolled-back 202609130001_order_payment_shipping_foundation 2>&1 || true

  sleep "$RETRY_DELAY"
  attempt=$((attempt + 1))
  RETRY_DELAY=$((RETRY_DELAY + 5))
done

echo "[entrypoint] Starting app..."
exec node dist/main.js
