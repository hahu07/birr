-- CreateEnum
CREATE TYPE "ClinicGiftStatus" AS ENUM ('pending', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "clinic_gifts" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "pot" "ClinicPot" NOT NULL,
    "donorId" TEXT,
    "contactEmail" TEXT,
    "contactWhatsApp" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "feeCover" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "provider" "ContributionProvider" NOT NULL,
    "providerReference" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "settlementSubaccount" TEXT NOT NULL,
    "status" "ClinicGiftStatus" NOT NULL DEFAULT 'pending',
    "confirmedAt" TIMESTAMP(3),
    "deedId" TEXT,
    "deedTextHash" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_gifts_providerReference_key" ON "clinic_gifts"("providerReference");

-- CreateIndex
CREATE INDEX "clinic_gifts_clinicWaqfId_idx" ON "clinic_gifts"("clinicWaqfId");

-- CreateIndex
CREATE INDEX "clinic_gifts_donorId_idx" ON "clinic_gifts"("donorId");

-- AddForeignKey
ALTER TABLE "clinic_gifts" ADD CONSTRAINT "clinic_gifts_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_gifts" ADD CONSTRAINT "clinic_gifts_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "vault_donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_gifts" ADD CONSTRAINT "clinic_gifts_deedId_fkey" FOREIGN KEY ("deedId") REFERENCES "clinic_waqf_deeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Hand-written database rules (2026-11-17, clinic slice 3).

ALTER TABLE "clinic_gifts"
  ADD CONSTRAINT "clinic_gifts_amounts_valid" CHECK (
    "amount" > 0 AND "amount" = round("amount", 2) AND "feeCover" >= 0 AND "feeCover" = round("feeCover", 2)
  ),
  ADD CONSTRAINT "clinic_gifts_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  -- An endowment gift names the deed version its giver accepted; a
  -- running-fund gift names none.
  ADD CONSTRAINT "clinic_gifts_deed_matches_pot" CHECK (
    ("pot" = 'endowment' AND "deedId" IS NOT NULL AND "deedTextHash" IS NOT NULL)
    OR ("pot" = 'running' AND "deedId" IS NULL AND "deedTextHash" IS NULL)
  ),
  ADD CONSTRAINT "clinic_gifts_confirmation_consistent" CHECK (("status" = 'confirmed') = ("confirmedAt" IS NOT NULL));

-- A gift is taken only by an established clinic waqf, and an endowment
-- gift only under that clinic's approved deed, exactly as worded.
CREATE OR REPLACE FUNCTION clinic_gifts_check_insert() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "clinic_waqfs" WHERE "id" = NEW."clinicWaqfId" AND "status" = 'established') THEN
    RAISE EXCEPTION 'Clinic waqf % isn''t established, so it can''t take gifts', NEW."clinicWaqfId";
  END IF;
  IF NEW."pot" = 'endowment' AND NOT EXISTS (
       SELECT 1 FROM "clinic_waqf_deeds"
       WHERE "id" = NEW."deedId" AND "clinicWaqfId" = NEW."clinicWaqfId" AND "status" = 'approved' AND "textHash" = NEW."deedTextHash") THEN
    RAISE EXCEPTION 'An endowment gift must accept the clinic waqf''s approved deed, as worded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_gifts_before_insert
  BEFORE INSERT ON "clinic_gifts"
  FOR EACH ROW EXECUTE FUNCTION clinic_gifts_check_insert();

-- What was given, by whom and to which pot never changes; a gift settles
-- once (pending -> confirmed or failed); and it's never deleted.
CREATE OR REPLACE FUNCTION clinic_gifts_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinic_gifts rows are never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId"
     OR NEW."pot" IS DISTINCT FROM OLD."pot"
     OR NEW."donorId" IS DISTINCT FROM OLD."donorId"
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

CREATE TRIGGER clinic_gifts_before_change
  BEFORE UPDATE OR DELETE ON "clinic_gifts"
  FOR EACH ROW EXECUTE FUNCTION clinic_gifts_check_change();
