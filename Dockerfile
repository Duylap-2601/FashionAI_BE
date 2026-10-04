# syntax=docker/dockerfile:1

# ---------- Builder ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Toolchain required to compile native modules (e.g. bcrypt) against musl.
# openssl lets `prisma generate` detect the real libssl version instead of
# guessing openssl-1.1.x. Lives only in this stage, so it never bloats the final image.
RUN apk add --no-cache python3 make g++ openssl

# Install dependencies first for better layer caching.
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Build the application.
COPY . .
RUN npm run prisma:generate
RUN npm run build

# Drop devDependencies. The generated Prisma client in node_modules/.prisma
# is not an npm package, so prune leaves it in place.
RUN npm prune --omit=dev

# ---------- Tailscale binaries ----------
FROM tailscale/tailscale:v1.84.3@sha256:f97ea471667bd94023f76e228c5be0b95564cdba2f9501cb084eeef139d8b65e AS tailscale

# ---------- Runner ----------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# tini gives us a real PID 1 for correct signal handling / graceful shutdown.
# openssl provides libssl.so.3, which the Prisma query engine links against.
# supervisor manages tailscaled, the local DB proxy, and the app in Tailscale mode.
RUN apk add --no-cache tini openssl ca-certificates supervisor socat

# Copy only the production artifacts from the builder stage.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /usr/local/bin/tailscaled /usr/local/bin/tailscaled
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY docker ./docker
RUN sed -i 's/\r$//' ./docker-entrypoint.sh ./docker/*.sh ./docker/supervisor-exit-listener.py \
  && chmod +x ./docker-entrypoint.sh ./docker/*.sh ./docker/supervisor-exit-listener.py

# Writable dir for the local avatar-storage fallback, owned by the non-root user.
RUN mkdir -p storage /tmp/tailscale/state && chown -R node:node storage /tmp/tailscale

# Run as an unprivileged user.
USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
# Free tier Render không có Pre-Deploy Command, nên apply migration ngay khi
# container khởi động (xem docker-entrypoint.sh) thay vì một bước deploy riêng.
CMD ["./docker-entrypoint.sh"]
