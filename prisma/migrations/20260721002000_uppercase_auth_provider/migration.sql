-- Align AuthProvider enum values with Prisma schema: LOCAL / GOOGLE.
ALTER TABLE "users" ALTER COLUMN "provider" DROP DEFAULT;

ALTER TYPE "AuthProvider" RENAME TO "AuthProvider_old";
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'GOOGLE');

ALTER TABLE "users"
  ALTER COLUMN "provider" TYPE "AuthProvider"
  USING upper("provider"::text)::"AuthProvider";

ALTER TABLE "users" ALTER COLUMN "provider" SET DEFAULT 'LOCAL';
DROP TYPE "AuthProvider_old";
