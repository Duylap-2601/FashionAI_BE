#!/bin/sh
set -e

# Render free tier khoá Pre-Deploy Command, nên migration phải chạy ngay tại đây
# trước khi app nhận traffic. Chỉ có 1 instance nên không lo nhiều process cùng
# migrate. `migrate deploy` chỉ apply migration mới, an toàn để gọi mỗi lần start.
echo "[entrypoint] Applying pending Prisma migrations..."
npm run migrate:deploy

echo "[entrypoint] Starting app..."
exec node dist/main.js
