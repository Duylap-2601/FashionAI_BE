CREATE TYPE "GhnLocationLevel" AS ENUM ('PROVINCE', 'DISTRICT', 'WARD');

CREATE TABLE "ghn_locations" (
    "id" UUID NOT NULL,
    "level" "GhnLocationLevel" NOT NULL,
    "code" TEXT NOT NULL,
    "parent_code" TEXT,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ghn_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ghn_locations_level_code_key" ON "ghn_locations"("level", "code");
CREATE INDEX "ghn_locations_level_parent_code_idx" ON "ghn_locations"("level", "parent_code");
CREATE INDEX "ghn_locations_is_active_idx" ON "ghn_locations"("is_active");
