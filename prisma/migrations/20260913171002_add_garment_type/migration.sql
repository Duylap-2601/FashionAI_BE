-- CreateEnum
CREATE TYPE "GarmentType" AS ENUM ('SHIRT', 'VEST', 'JACKET', 'PANTS', 'SKIRT', 'DRESS', 'JUMPSUIT');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "garment_type" "GarmentType";
