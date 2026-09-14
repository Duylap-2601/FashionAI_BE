CREATE TYPE "LiveTryOnCredentialStatus" AS ENUM ('ISSUING', 'ISSUED', 'ISSUE_UNKNOWN', 'ISSUE_FAILED');
CREATE TYPE "LiveTryOnReservationStatus" AS ENUM ('RESERVED', 'ALLOCATED', 'RELEASED');
CREATE TYPE "LiveTryOnSessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'EXPIRED', 'FAILED');

CREATE TABLE "live_try_on_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'direct',
    "status" "LiveTryOnSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "credential_status" "LiveTryOnCredentialStatus" NOT NULL DEFAULT 'ISSUING',
    "reservation_status" "LiveTryOnReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "idempotency_key" TEXT NOT NULL,
    "idempotency_body_hash" TEXT NOT NULL,
    "quota_date" TEXT NOT NULL,
    "reserved_seconds" INTEGER NOT NULL,
    "allocated_seconds" INTEGER NOT NULL DEFAULT 0,
    "policy_version" TEXT NOT NULL,
    "rate_credits_per_second" INTEGER NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3),
    "blocked_until" TIMESTAMP(3) NOT NULL,
    "client_ended_at" TIMESTAMP(3),
    "ended_reason" TEXT,
    "provider_session_id" TEXT,
    "provider_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "live_try_on_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "live_try_on_budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_key" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "limit_seconds" INTEGER,
    "reserved_seconds" INTEGER NOT NULL DEFAULT 0,
    "allocated_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" UUID,
    CONSTRAINT "live_try_on_budgets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "live_try_on_leases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "live_try_on_leases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "live_try_on_sessions_user_id_idempotency_key_key" ON "live_try_on_sessions"("user_id", "idempotency_key");
CREATE INDEX "live_try_on_sessions_user_id_created_at_idx" ON "live_try_on_sessions"("user_id", "created_at");
CREATE INDEX "live_try_on_sessions_reservation_status_blocked_until_idx" ON "live_try_on_sessions"("reservation_status", "blocked_until");
CREATE INDEX "live_try_on_sessions_credential_status_blocked_until_idx" ON "live_try_on_sessions"("credential_status", "blocked_until");

CREATE UNIQUE INDEX "live_try_on_budgets_scope_key_date_key" ON "live_try_on_budgets"("scope_key", "date");
CREATE INDEX "live_try_on_budgets_user_id_date_idx" ON "live_try_on_budgets"("user_id", "date");

CREATE UNIQUE INDEX "live_try_on_leases_user_id_key" ON "live_try_on_leases"("user_id");
CREATE UNIQUE INDEX "live_try_on_leases_session_id_key" ON "live_try_on_leases"("session_id");
CREATE INDEX "live_try_on_leases_expires_at_idx" ON "live_try_on_leases"("expires_at");

ALTER TABLE "live_try_on_sessions" ADD CONSTRAINT "live_try_on_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_try_on_sessions" ADD CONSTRAINT "live_try_on_sessions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "live_try_on_budgets" ADD CONSTRAINT "live_try_on_budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_try_on_leases" ADD CONSTRAINT "live_try_on_leases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_try_on_leases" ADD CONSTRAINT "live_try_on_leases_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_try_on_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
