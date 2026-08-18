-- CreateTable
CREATE TABLE "avatars" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gender" TEXT NOT NULL DEFAULT 'female',
    "height" DECIMAL(5,1),
    "weight" DECIMAL(5,1),
    "chest" DECIMAL(5,1),
    "waist" DECIMAL(5,1),
    "hip" DECIMAL(5,1),
    "shoulder" DECIMAL(5,1),
    "glb_url" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avatars_user_id_idx" ON "avatars"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "avatars_user_id_cache_key_key" ON "avatars"("user_id", "cache_key");

-- AddForeignKey
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
