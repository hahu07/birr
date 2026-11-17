-- AlterTable
ALTER TABLE "clinic_gifts" ADD COLUMN     "founderId" TEXT,
ADD COLUMN     "initiatedByUserId" TEXT;

-- AlterTable
ALTER TABLE "founders" ADD COLUMN     "clinicSupporter" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "clinic_gifts_founderId_idx" ON "clinic_gifts"("founderId");

-- AddForeignKey
ALTER TABLE "clinic_gifts" ADD CONSTRAINT "clinic_gifts_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_gifts" ADD CONSTRAINT "clinic_gifts_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Hand-written database rules (2026-11-17, clinic slice 4a).

ALTER TABLE "clinic_gifts"
  -- A gift is a Founder's or a public giver's, never both; a Founder's
  -- gift names the user who gave it.
  ADD CONSTRAINT "clinic_gifts_one_giver" CHECK ("founderId" IS NULL OR "donorId" IS NULL),
  ADD CONSTRAINT "clinic_gifts_founder_user" CHECK (("founderId" IS NULL) = ("initiatedByUserId" IS NULL));

-- The same rules as before, plus: who gave never changes.
CREATE OR REPLACE FUNCTION clinic_gifts_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinic_gifts rows are never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId"
     OR NEW."pot" IS DISTINCT FROM OLD."pot"
     OR NEW."donorId" IS DISTINCT FROM OLD."donorId"
     OR NEW."founderId" IS DISTINCT FROM OLD."founderId"
     OR NEW."initiatedByUserId" IS DISTINCT FROM OLD."initiatedByUserId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."feeCover" IS DISTINCT FROM OLD."feeCover"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."settlementSubaccount" IS DISTINCT FROM OLD."settlementSubaccount"
     OR NEW."deedId" IS DISTINCT FROM OLD."deedId"
     OR NEW."deedTextHash" IS DISTINCT FROM OLD."deedTextHash"
     OR NEW."contactEmail" IS DISTINCT FROM OLD."contactEmail"
     OR NEW."contactWhatsApp" IS DISTINCT FROM OLD."contactWhatsApp" THEN
    RAISE EXCEPTION 'A clinic gift''s amount, pot, giver, deed and settlement account never change';
  END IF;
  IF OLD."status" <> 'pending' AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."providerReference" IS DISTINCT FROM OLD."providerReference") THEN
    RAISE EXCEPTION 'A clinic gift that is % can''t change', OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
