-- Founder -> Foundation -> Waqf Fund -> Cause restructuring, step C
-- (contract, part 1). Requires packages/db/scripts/backfill-foundations-and-causes.ts
-- to have already been run against this database — the guard below
-- fails loudly, not silently, if it hasn't.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "waqfs" WHERE "foundationId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: some waqfs have NULL foundationId. Run packages/db/scripts/backfill-foundations-and-causes.ts first.';
  END IF;
  IF EXISTS (SELECT 1 FROM "distributions" WHERE "causeId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: some distributions have NULL causeId. Run packages/db/scripts/backfill-foundations-and-causes.ts first.';
  END IF;
END $$;

ALTER TABLE "waqfs" ALTER COLUMN "foundationId" SET NOT NULL;
ALTER TABLE "distributions" ALTER COLUMN "causeId" SET NOT NULL;
