-- CreateTable
CREATE TABLE "avatar_presets" (
    "id" UUID NOT NULL,
    "gender" TEXT NOT NULL,
    "height" DECIMAL(5,1) NOT NULL,
    "weight" DECIMAL(5,1) NOT NULL,
    "glb_url" TEXT NOT NULL,
    "preset_measurements" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatar_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avatar_presets_gender_idx" ON "avatar_presets"("gender");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_presets_gender_height_weight_key" ON "avatar_presets"("gender", "height", "weight");
