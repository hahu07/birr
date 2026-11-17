-- CreateEnum
CREATE TYPE "ClinicInvestmentStatus" AS ENUM ('pending_shariah_review', 'shariah_rejected', 'shariah_approved', 'placed', 'returned');

-- AlterTable
ALTER TABLE "clinic_spends" ADD COLUMN     "investmentId" TEXT;

-- CreateTable
CREATE TABLE "clinic_investments" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instrumentType" "InvestmentInstrumentType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "businessDescription" TEXT NOT NULL,
    "status" "ClinicInvestmentStatus" NOT NULL DEFAULT 'pending_shariah_review',
    "shariahDecidedByUserId" TEXT,
    "shariahDecidedAt" TIMESTAMP(3),
    "shariahNote" TEXT,
    "returnedOn" DATE,
    "returnBankReference" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_investment_income" (
    "id" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "receivedOn" DATE NOT NULL,
    "bankReference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_investment_income_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinic_investments_clinicWaqfId_idx" ON "clinic_investments"("clinicWaqfId");

-- CreateIndex
CREATE INDEX "clinic_investment_income_investmentId_idx" ON "clinic_investment_income"("investmentId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_spends_investmentId_key" ON "clinic_spends"("investmentId");

-- AddForeignKey
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "clinic_investments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_investments" ADD CONSTRAINT "clinic_investments_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_investments" ADD CONSTRAINT "clinic_investments_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_investments" ADD CONSTRAINT "clinic_investments_shariahDecidedByUserId_fkey" FOREIGN KEY ("shariahDecidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_investments" ADD CONSTRAINT "clinic_investments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_investment_income" ADD CONSTRAINT "clinic_investment_income_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "clinic_investments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_investment_income" ADD CONSTRAINT "clinic_investment_income_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---- Hand-written database rules (2026-11-17, clinic slice 5c).

ALTER TABLE "clinic_investments"
  ADD CONSTRAINT "clinic_investments_amount_positive" CHECK ("amount" > 0 AND "amount" = round("amount", 2)),
  ADD CONSTRAINT "clinic_investments_text_present" CHECK (length(btrim("name")) > 0 AND length(btrim("businessDescription")) > 0),
  -- The Shariah decision is complete once made, and never by whoever recorded it.
  ADD CONSTRAINT "clinic_investments_shariah_consistent" CHECK (
    ("status" = 'pending_shariah_review' AND "shariahDecidedByUserId" IS NULL AND "shariahDecidedAt" IS NULL)
    OR ("status" <> 'pending_shariah_review' AND "shariahDecidedByUserId" IS NOT NULL AND "shariahDecidedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "clinic_investments_reviewer_not_creator" CHECK ("shariahDecidedByUserId" IS NULL OR "shariahDecidedByUserId" <> "createdByUserId"),
  ADD CONSTRAINT "clinic_investments_return_consistent" CHECK (
    ("status" = 'returned') = ("returnedOn" IS NOT NULL AND "returnBankReference" IS NOT NULL)
  );

-- What an investment is never changes; status only moves
-- pending_shariah_review -> shariah_approved | shariah_rejected,
-- shariah_approved -> placed, placed -> returned; never deleted.
CREATE OR REPLACE FUNCTION clinic_investments_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic investment is never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId" OR NEW."counterpartyId" IS DISTINCT FROM OLD."counterpartyId"
     OR NEW."name" IS DISTINCT FROM OLD."name" OR NEW."instrumentType" IS DISTINCT FROM OLD."instrumentType"
     OR NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."businessDescription" IS DISTINCT FROM OLD."businessDescription"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'What a clinic investment is, and its amount, never change';
  END IF;
  IF OLD."shariahDecidedByUserId" IS NOT NULL AND (
       NEW."shariahDecidedByUserId" IS DISTINCT FROM OLD."shariahDecidedByUserId" OR NEW."shariahDecidedAt" IS DISTINCT FROM OLD."shariahDecidedAt"
       OR NEW."shariahNote" IS DISTINCT FROM OLD."shariahNote") THEN
    RAISE EXCEPTION 'A clinic investment''s Shariah decision never changes';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'pending_shariah_review' AND NEW."status" IN ('shariah_approved', 'shariah_rejected'))
       OR (OLD."status" = 'shariah_approved' AND NEW."status" = 'placed')
       OR (OLD."status" = 'placed' AND NEW."status" = 'returned')) THEN
    RAISE EXCEPTION 'A clinic investment can''t go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_investments_before_change
  BEFORE UPDATE OR DELETE ON "clinic_investments"
  FOR EACH ROW EXECUTE FUNCTION clinic_investments_check_change();

-- Income: positive, only from an investment that was placed, append-only.
ALTER TABLE "clinic_investment_income"
  ADD CONSTRAINT "clinic_investment_income_amount_positive" CHECK ("amount" > 0 AND "amount" = round("amount", 2)),
  ADD CONSTRAINT "clinic_investment_income_text_present" CHECK (length(btrim("bankReference")) > 0 AND length(btrim("description")) > 0);

CREATE OR REPLACE FUNCTION clinic_investment_income_check() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Clinic investment income is append-only; record an offsetting entry instead';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "clinic_investments" WHERE "id" = NEW."investmentId" AND "status" IN ('placed', 'returned')) THEN
    RAISE EXCEPTION 'Income can only be recorded for an investment that was placed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_investment_income_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "clinic_investment_income"
  FOR EACH ROW EXECUTE FUNCTION clinic_investment_income_check();

-- A payment's kind says what it's for: a works stage names its project,
-- an investment its investment, equipment neither.
ALTER TABLE "clinic_spends" DROP CONSTRAINT "clinic_spends_kind_project";
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_kind_target" CHECK (
  ("kind" = 'works_stage' AND "worksProjectId" IS NOT NULL AND "investmentId" IS NULL)
  OR ("kind" = 'investment' AND "investmentId" IS NOT NULL AND "worksProjectId" IS NULL)
  OR ("kind" = 'equipment' AND "worksProjectId" IS NULL AND "investmentId" IS NULL)
);

-- The same rule as before, plus: which investment never changes.
CREATE OR REPLACE FUNCTION clinic_spends_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic spend is never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId" OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."worksProjectId" IS DISTINCT FROM OLD."worksProjectId" OR NEW."investmentId" IS DISTINCT FROM OLD."investmentId"
     OR NEW."payeeId" IS DISTINCT FROM OLD."payeeId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."description" IS DISTINCT FROM OLD."description"
     OR NEW."supportingReference" IS DISTINCT FROM OLD."supportingReference" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'A clinic spend''s payee, amount and purpose never change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'pending_approval' AND NEW."status" IN ('approved', 'rejected'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'paid')) THEN
    RAISE EXCEPTION 'A clinic spend can''t go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
