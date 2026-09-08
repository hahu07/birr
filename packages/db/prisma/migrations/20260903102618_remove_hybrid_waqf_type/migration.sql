-- Removes "hybrid" as a supported WaqfType — a Founder can already
-- establish as many separate Waqf Funds as they like under one
-- Foundation, so a fund that spans purposes has no need for a distinct
-- combined type; it's just two funds. Confirmed zero existing "waqfs"
-- rows and zero "cause_categories.typicalWaqfTypes" entries use
-- "hybrid" before this was written (owner's explicit decision,
-- 2026-09-03) — Postgres has no ALTER TYPE ... DROP VALUE, so removing
-- an enum value means the standard rename/recreate/swap dance below.
BEGIN;
CREATE TYPE "WaqfType_new" AS ENUM ('investment', 'asset', 'project');
ALTER TABLE "waqfs" ALTER COLUMN "type" TYPE "WaqfType_new" USING ("type"::text::"WaqfType_new");
ALTER TABLE "cause_categories" ALTER COLUMN "typicalWaqfTypes" TYPE "WaqfType_new"[] USING ("typicalWaqfTypes"::text::"WaqfType_new"[]);
ALTER TYPE "WaqfType" RENAME TO "WaqfType_old";
ALTER TYPE "WaqfType_new" RENAME TO "WaqfType";
DROP TYPE "WaqfType_old";
COMMIT;
