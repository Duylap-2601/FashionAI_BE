-- Phase 3: multi-garment try-on. Lưu chi tiết từng món (áo/quần) của một lần thử combo.
ALTER TABLE "try_on_results" ADD COLUMN "garments" JSONB;
