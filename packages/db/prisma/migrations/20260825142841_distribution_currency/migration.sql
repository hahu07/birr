-- AlterTable: add nullable first so existing rows can be backfilled,
-- then enforce NOT NULL once every row has a value. Backfill defaults
-- to USD — this is pre-launch test data, not real money; every new
-- distribution going forward must supply its own currency explicitly
-- (see DistributionsService.create), no default there.
ALTER TABLE "distributions" ADD COLUMN     "currency" TEXT;

UPDATE "distributions" SET "currency" = 'USD' WHERE "currency" IS NULL;

ALTER TABLE "distributions" ALTER COLUMN "currency" SET NOT NULL;
