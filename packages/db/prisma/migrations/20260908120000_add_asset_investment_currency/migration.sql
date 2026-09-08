-- 2026-09-08 audit fix — Asset.estimatedValue and Investment.allocatedAmount
-- were bare Decimals with no currency of their own (same gap Distribution
-- had before 20260825142841_distribution_currency, fixed there first — this
-- follows the identical add-nullable / backfill / SET NOT NULL shape).
--
-- Backfilled from each row's own waqf's declared corpusCurrency, since both
-- fields are implicitly denominated in that waqf's corpus currency already
-- (same assumption WaqfCause's amounts and assertWithinRaised/
-- assertWithinConcentrationLimit already make elsewhere). Falls back to
-- 'USD' only for the remainder — waqfs with no corpusCurrency of their own
-- to inherit (pre-existing rows from before that field existed) — same
-- fallback and reasoning as the Distribution precedent.
ALTER TABLE "assets" ADD COLUMN "currency" TEXT;
ALTER TABLE "investments" ADD COLUMN "currency" TEXT;

UPDATE "assets" a SET "currency" = w."corpusCurrency"
  FROM "waqfs" w WHERE w."id" = a."waqfId" AND w."corpusCurrency" IS NOT NULL;
UPDATE "investments" i SET "currency" = w."corpusCurrency"
  FROM "waqfs" w WHERE w."id" = i."waqfId" AND w."corpusCurrency" IS NOT NULL;

UPDATE "assets" SET "currency" = 'USD' WHERE "currency" IS NULL;
UPDATE "investments" SET "currency" = 'USD' WHERE "currency" IS NULL;

ALTER TABLE "assets" ALTER COLUMN "currency" SET NOT NULL;
ALTER TABLE "investments" ALTER COLUMN "currency" SET NOT NULL;
