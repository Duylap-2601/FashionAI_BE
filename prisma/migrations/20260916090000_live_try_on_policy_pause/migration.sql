ALTER TYPE "LiveTryOnSessionStatus" ADD VALUE IF NOT EXISTS 'PAUSING';
ALTER TYPE "LiveTryOnSessionStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "LiveTryOnSessionStatus" ADD VALUE IF NOT EXISTS 'RESUMING';
ALTER TYPE "LiveTryOnSessionStatus" ADD VALUE IF NOT EXISTS 'ENDING';

ALTER TABLE "live_try_on_sessions"
ADD COLUMN IF NOT EXISTS "used_seconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "tier" "UserTier" NOT NULL DEFAULT 'FREE',
ADD COLUMN IF NOT EXISTS "active_started_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "paused_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "pause_expires_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "live_try_on_policy_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "live_try_on_policy_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "live_try_on_policy_audits_actor_id_created_at_idx" ON "live_try_on_policy_audits"("actor_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_try_on_policy_audits_actor_id_fkey'
  ) THEN
    ALTER TABLE "live_try_on_policy_audits"
    ADD CONSTRAINT "live_try_on_policy_audits_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
