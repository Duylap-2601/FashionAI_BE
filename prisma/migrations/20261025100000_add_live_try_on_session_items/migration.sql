-- Cac mon cua mot phien Live Try-On. Decart chi nhan 1 anh tham chieu moi phien
-- nen is_primary danh dau mon cap anh do; cac mon con lai mo ta trong prompt.
CREATE TABLE "live_try_on_session_items" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "layer_role" "LayerRole" NOT NULL,
    "color_name" TEXT,
    "image_url" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_try_on_session_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "live_try_on_session_items_session_id_product_id_key"
    ON "live_try_on_session_items"("session_id", "product_id");

CREATE INDEX "live_try_on_session_items_session_id_position_idx"
    ON "live_try_on_session_items"("session_id", "position");

ALTER TABLE "live_try_on_session_items"
    ADD CONSTRAINT "live_try_on_session_items_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "live_try_on_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "live_try_on_session_items"
    ADD CONSTRAINT "live_try_on_session_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
