-- CreateEnum
CREATE TYPE "ClinicPriceListStatus" AS ENUM ('draft', 'approved', 'superseded', 'discarded');

-- CreateTable
CREATE TABLE "clinic_price_lists" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "ClinicPriceListStatus" NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_price_lists_approvedActionId_key" ON "clinic_price_lists"("approvedActionId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_price_lists_clinicWaqfId_version_key" ON "clinic_price_lists"("clinicWaqfId", "version");

-- AddForeignKey
ALTER TABLE "clinic_price_lists" ADD CONSTRAINT "clinic_price_lists_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_price_lists" ADD CONSTRAINT "clinic_price_lists_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_price_lists" ADD CONSTRAINT "clinic_price_lists_approvedActionId_fkey" FOREIGN KEY ("approvedActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---- Hand-written database rules (2026-11-17, clinic slice 6).

ALTER TABLE "clinic_price_lists"
  ADD CONSTRAINT "clinic_price_lists_version_positive" CHECK ("version" >= 1),
  -- The hash is always the content's hash, so an approval naming it names exactly this list.
  ADD CONSTRAINT "clinic_price_lists_hash_matches" CHECK ("contentHash" = encode(sha256(convert_to("content", 'UTF8')), 'hex')),
  ADD CONSTRAINT "clinic_price_lists_approval_consistent" CHECK (
    ("status" IN ('approved', 'superseded') AND "approvedAt" IS NOT NULL AND "approvedActionId" IS NOT NULL)
    OR ("status" IN ('draft', 'discarded') AND "approvedAt" IS NULL AND "approvedActionId" IS NULL)
  );

CREATE UNIQUE INDEX "clinic_price_lists_one_approved" ON "clinic_price_lists" ("clinicWaqfId") WHERE "status" = 'approved';
CREATE UNIQUE INDEX "clinic_price_lists_one_draft" ON "clinic_price_lists" ("clinicWaqfId") WHERE "status" = 'draft';

-- A version's content never changes; status moves only draft -> approved
-- | discarded, approved -> superseded; never deleted.
CREATE OR REPLACE FUNCTION clinic_price_lists_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic price list version is never deleted';
  END IF;
  IF NEW."content" IS DISTINCT FROM OLD."content" OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'A price list version''s content never changes; draft a new version instead';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'draft' AND NEW."status" IN ('approved', 'discarded'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'superseded')) THEN
    RAISE EXCEPTION 'A price list version can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."approvedActionId" IS NOT NULL AND (NEW."approvedActionId" IS DISTINCT FROM OLD."approvedActionId" OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt") THEN
    RAISE EXCEPTION 'A price list version''s approval never changes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_price_lists_before_change
  BEFORE UPDATE OR DELETE ON "clinic_price_lists"
  FOR EACH ROW EXECUTE FUNCTION clinic_price_lists_check_change();
