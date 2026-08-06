-- Split system authorization role from customer tier.
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

ALTER TABLE "users"
ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER';

-- UserTier no longer contains ADMIN. This block only works when no users still have tier='ADMIN'.
-- If existing admin users used tier='ADMIN', run this before changing enum:
-- UPDATE "users" SET "role" = 'ADMIN', "tier" = 'VIP' WHERE "tier" = 'ADMIN';
ALTER TYPE "UserTier" RENAME TO "UserTier_old";
CREATE TYPE "UserTier" AS ENUM ('FREE', 'MEMBER', 'VIP');
ALTER TABLE "users"
  ALTER COLUMN "tier" DROP DEFAULT,
  ALTER COLUMN "tier" TYPE "UserTier" USING "tier"::text::"UserTier",
  ALTER COLUMN "tier" SET DEFAULT 'FREE';
DROP TYPE "UserTier_old";
