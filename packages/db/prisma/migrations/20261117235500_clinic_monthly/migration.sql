-- AlterTable
ALTER TABLE "clinic_gifts" ADD COLUMN     "recurringGiftId" TEXT,
ADD COLUMN     "recurringPeriod" TEXT;

-- AlterTable
ALTER TABLE "recurring_gifts" ADD COLUMN     "clinicDeedId" TEXT,
ADD COLUMN     "clinicDeedTextHash" TEXT,
ADD COLUMN     "clinicPot" "ClinicPot",
ADD COLUMN     "clinicWaqfId" TEXT;

-- AddForeignKey
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_clinicDeedId_fkey" FOREIGN KEY ("clinicDeedId") REFERENCES "clinic_waqf_deeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_gifts" ADD CONSTRAINT "clinic_gifts_recurringGiftId_fkey" FOREIGN KEY ("recurringGiftId") REFERENCES "recurring_gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Hand-written database rules (2026-11-17, clinic slice 4b).

-- Each kind carries exactly its own target. A clinic gift names its clinic
-- and pot, and an endowment gift the deed accepted; it may be a Founder's
-- (founderId) or a public giver's (none).
ALTER TABLE "recurring_gifts" DROP CONSTRAINT "recurring_gifts_target_matches_kind";
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_target_matches_kind" CHECK (
  ("kind" = 'vault' AND "vaultId" IS NOT NULL AND "waqfId" IS NULL AND "founderId" IS NULL AND "wakalahConsentVersion" IS NULL AND "clinicWaqfId" IS NULL)
  OR ("kind" = 'waqf' AND "waqfId" IS NOT NULL AND "founderId" IS NOT NULL AND "vaultId" IS NULL AND "vaultCauseId" IS NULL AND "wakalahConsentVersion" IS NULL AND "clinicWaqfId" IS NULL)
  OR ("kind" = 'zakah' AND "wakalahConsentVersion" IS NOT NULL AND "vaultId" IS NULL AND "vaultCauseId" IS NULL AND "waqfId" IS NULL AND "founderId" IS NULL AND "clinicWaqfId" IS NULL)
  OR ("kind" = 'clinic' AND "clinicWaqfId" IS NOT NULL AND "clinicPot" IS NOT NULL AND "vaultId" IS NULL AND "vaultCauseId" IS NULL AND "waqfId" IS NULL AND "wakalahConsentVersion" IS NULL)
);
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_clinic_fields" CHECK (
  ("kind" = 'clinic' AND ("clinicPot" = 'endowment') = ("clinicDeedId" IS NOT NULL AND "clinicDeedTextHash" IS NOT NULL))
  OR ("kind" <> 'clinic' AND "clinicPot" IS NULL AND "clinicDeedId" IS NULL AND "clinicDeedTextHash" IS NULL)
);

-- A month is only ever named together with its gift, and a monthly gift
-- collects each month at most once.
ALTER TABLE "clinic_gifts" ADD CONSTRAINT "clinic_gifts_recurring_pair" CHECK ("recurringPeriod" IS NULL OR "recurringGiftId" IS NOT NULL);
CREATE UNIQUE INDEX "clinic_gifts_one_charge_per_gift_month" ON "clinic_gifts" ("recurringGiftId", "recurringPeriod") WHERE "recurringPeriod" IS NOT NULL AND "status" <> 'failed';

-- The same rules as before, plus: which monthly gift and month never change.
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
     OR NEW."recurringGiftId" IS DISTINCT FROM OLD."recurringGiftId"
     OR NEW."recurringPeriod" IS DISTINCT FROM OLD."recurringPeriod"
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
