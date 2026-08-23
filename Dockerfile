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

# ---------- Runner ----------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# tini gives us a real PID 1 for correct signal handling / graceful shutdown.
# openssl provides libssl.so.3, which the Prisma query engine links against.
RUN apk add --no-cache tini openssl

# Copy only the production artifacts from the builder stage.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Writable dir for the local avatar-storage fallback, owned by the non-root user.
RUN mkdir -p storage && chown -R node:node storage

# Run as an unprivileged user.
USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
