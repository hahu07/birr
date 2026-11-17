-- CreateEnum
CREATE TYPE "ClinicClaimStatus" AS ENUM ('submitted', 'approved', 'rejected', 'discarded', 'paid');

-- AlterTable
ALTER TABLE "clinic_waqfs" ADD COLUMN     "operatorActionId" TEXT,
ADD COLUMN     "operatorAssignedAt" TIMESTAMP(3),
ADD COLUMN     "operatorId" TEXT;

-- CreateTable
CREATE TABLE "clinic_claims" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "totalPrice" DECIMAL(65,30) NOT NULL,
    "patientPaid" DECIMAL(65,30) NOT NULL,
    "subsidyTotal" DECIMAL(65,30) NOT NULL,
    "runningFundAmount" DECIMAL(65,30) NOT NULL,
    "zakahAmount" DECIMAL(65,30) NOT NULL,
    "status" "ClinicClaimStatus" NOT NULL DEFAULT 'submitted',
    "approvalActionId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paymentActionId" TEXT,
    "paidOn" DATE,
    "bankReference" TEXT,
    "zakahDistributionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_claim_lines" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "visitReference" TEXT NOT NULL,
    "visitDate" DATE NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "bandCode" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "patientPaid" DECIMAL(65,30) NOT NULL,
    "subsidy" DECIMAL(65,30) NOT NULL,
    "zakahEligible" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_claim_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_claims_approvalActionId_key" ON "clinic_claims"("approvalActionId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_claims_paymentActionId_key" ON "clinic_claims"("paymentActionId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_claims_zakahDistributionId_key" ON "clinic_claims"("zakahDistributionId");

-- CreateIndex
CREATE INDEX "clinic_claims_clinicWaqfId_period_idx" ON "clinic_claims"("clinicWaqfId", "period");

-- CreateIndex
CREATE INDEX "clinic_claim_lines_clinicWaqfId_visitReference_idx" ON "clinic_claim_lines"("clinicWaqfId", "visitReference");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_claim_lines_claimId_visitReference_serviceCode_key" ON "clinic_claim_lines"("claimId", "visitReference", "serviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_waqfs_operatorActionId_key" ON "clinic_waqfs"("operatorActionId");

-- AddForeignKey
ALTER TABLE "clinic_waqfs" ADD CONSTRAINT "clinic_waqfs_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_waqfs" ADD CONSTRAINT "clinic_waqfs_operatorActionId_fkey" FOREIGN KEY ("operatorActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_claims" ADD CONSTRAINT "clinic_claims_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_claims" ADD CONSTRAINT "clinic_claims_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_claims" ADD CONSTRAINT "clinic_claims_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "clinic_price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_claims" ADD CONSTRAINT "clinic_claims_approvalActionId_fkey" FOREIGN KEY ("approvalActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_claims" ADD CONSTRAINT "clinic_claims_paymentActionId_fkey" FOREIGN KEY ("paymentActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_claims" ADD CONSTRAINT "clinic_claims_zakahDistributionId_fkey" FOREIGN KEY ("zakahDistributionId") REFERENCES "zakah_distributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_claims" ADD CONSTRAINT "clinic_claims_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_claim_lines" ADD CONSTRAINT "clinic_claim_lines_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "clinic_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_claim_lines" ADD CONSTRAINT "clinic_claim_lines_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==== Rules (2026-11-17, clinic slice 7: monthly claims) ====

-- ---- clinic_waqfs: the operator

ALTER TABLE "clinic_waqfs"
  -- An operator is only ever assigned by an approved governed action.
  ADD CONSTRAINT "clinic_waqfs_operator_consistent" CHECK (
    ("operatorId" IS NULL AND "operatorActionId" IS NULL AND "operatorAssignedAt" IS NULL)
    OR ("operatorId" IS NOT NULL AND "operatorActionId" IS NOT NULL AND "operatorAssignedAt" IS NOT NULL)
  );

-- ---- clinic_claims

ALTER TABLE "clinic_claims"
  ADD CONSTRAINT "clinic_claims_period_format" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "clinic_claims_line_count_positive" CHECK ("lineCount" >= 1),
  ADD CONSTRAINT "clinic_claims_amounts_not_negative" CHECK (
    "totalPrice" > 0 AND "patientPaid" >= 0 AND "subsidyTotal" >= 0 AND "runningFundAmount" >= 0 AND "zakahAmount" >= 0
  ),
  -- What patients paid and the subsidies make up the price; the subsidies
  -- split exactly between the running fund and zakah.
  ADD CONSTRAINT "clinic_claims_totals_add_up" CHECK (
    "totalPrice" = "patientPaid" + "subsidyTotal" AND "subsidyTotal" = "runningFundAmount" + "zakahAmount"
  ),
  ADD CONSTRAINT "clinic_claims_status_consistent" CHECK (
    ("status" IN ('submitted', 'rejected', 'discarded') AND "approvalActionId" IS NULL AND "approvedAt" IS NULL AND "paymentActionId" IS NULL AND "paidOn" IS NULL AND "bankReference" IS NULL)
    OR ("status" = 'approved' AND "approvalActionId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "paymentActionId" IS NULL AND "paidOn" IS NULL AND "bankReference" IS NULL)
    OR ("status" = 'paid' AND "approvalActionId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "paymentActionId" IS NOT NULL AND "paidOn" IS NOT NULL
        AND length(btrim(coalesce("bankReference", ''))) > 0 AND "runningFundAmount" > 0)
  ),
  -- Only an approved claim's zakah part is paid, and only if it has one.
  ADD CONSTRAINT "clinic_claims_zakah_link" CHECK (
    "zakahDistributionId" IS NULL OR ("zakahAmount" > 0 AND "status" IN ('approved', 'paid'))
  );

-- One live claim per clinic per month: a corrected claim replaces a
-- discarded or rejected one, never sits beside it.
CREATE UNIQUE INDEX "clinic_claims_one_per_period" ON "clinic_claims" ("clinicWaqfId", "period")
  WHERE "status" IN ('submitted', 'approved', 'paid');

-- What a claim is never changes; status moves only submitted -> approved |
-- rejected | discarded, approved -> paid; the zakah link is set once;
-- never deleted.
CREATE OR REPLACE FUNCTION clinic_claims_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic claim is never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId" OR NEW."period" IS DISTINCT FROM OLD."period"
     OR NEW."operatorId" IS DISTINCT FROM OLD."operatorId" OR NEW."priceListId" IS DISTINCT FROM OLD."priceListId"
     OR NEW."lineCount" IS DISTINCT FROM OLD."lineCount" OR NEW."totalPrice" IS DISTINCT FROM OLD."totalPrice"
     OR NEW."patientPaid" IS DISTINCT FROM OLD."patientPaid" OR NEW."subsidyTotal" IS DISTINCT FROM OLD."subsidyTotal"
     OR NEW."runningFundAmount" IS DISTINCT FROM OLD."runningFundAmount" OR NEW."zakahAmount" IS DISTINCT FROM OLD."zakahAmount"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'A clinic claim''s lines and totals never change; discard it and upload a corrected one';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'submitted' AND NEW."status" IN ('approved', 'rejected', 'discarded'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'paid')) THEN
    RAISE EXCEPTION 'A clinic claim can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."zakahDistributionId" IS NOT NULL AND NEW."zakahDistributionId" IS DISTINCT FROM OLD."zakahDistributionId" THEN
    RAISE EXCEPTION 'A clinic claim''s zakah distribution never changes once linked';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_claims_before_change
  BEFORE UPDATE OR DELETE ON "clinic_claims"
  FOR EACH ROW EXECUTE FUNCTION clinic_claims_check_change();

-- ---- clinic_claim_lines

ALTER TABLE "clinic_claim_lines"
  ADD CONSTRAINT "clinic_claim_lines_text_present" CHECK (
    length(btrim("visitReference")) > 0 AND length(btrim("serviceCode")) > 0 AND length(btrim("bandCode")) > 0
  ),
  ADD CONSTRAINT "clinic_claim_lines_amounts_add_up" CHECK (
    "price" > 0 AND "patientPaid" >= 0 AND "subsidy" >= 0 AND "price" = "patientPaid" + "subsidy"
  );

-- Insert-only.
CREATE OR REPLACE FUNCTION clinic_claim_lines_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A clinic claim line is never changed or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_claim_lines_before_change
  BEFORE UPDATE OR DELETE ON "clinic_claim_lines"
  FOR EACH ROW EXECUTE FUNCTION clinic_claim_lines_refuse_change();

-- A line belongs to its claim's clinic, and is added only while the claim
-- is being created (a submitted claim, in the same transaction is checked
-- by the totals rule below).
CREATE OR REPLACE FUNCTION clinic_claim_lines_check_insert() RETURNS trigger AS $$
DECLARE
  claim RECORD;
BEGIN
  SELECT "clinicWaqfId", "status", "period" INTO claim FROM "clinic_claims" WHERE "id" = NEW."claimId";
  IF claim."clinicWaqfId" IS DISTINCT FROM NEW."clinicWaqfId" THEN
    RAISE EXCEPTION 'A claim line belongs to its claim''s clinic';
  END IF;
  IF claim."status" <> 'submitted' THEN
    RAISE EXCEPTION 'Lines can''t be added to a % claim', claim."status";
  END IF;
  IF to_char(NEW."visitDate", 'YYYY-MM') <> claim."period" THEN
    RAISE EXCEPTION 'A claim line''s visit (%) must fall in the claim''s month (%)', NEW."visitDate", claim."period";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_claim_lines_before_insert
  BEFORE INSERT ON "clinic_claim_lines"
  FOR EACH ROW EXECUTE FUNCTION clinic_claim_lines_check_insert();

-- At commit, a claim's totals are exactly its lines' totals: no line can be
-- slipped into a claim after it was checked, and no total can be made up.
CREATE OR REPLACE FUNCTION clinic_claims_assert_totals(claim_id TEXT) RETURNS void AS $$
DECLARE
  c RECORD;
  l RECORD;
BEGIN
  SELECT * INTO c FROM "clinic_claims" WHERE "id" = claim_id;
  SELECT count(*) AS n, coalesce(sum("price"), 0) AS price, coalesce(sum("patientPaid"), 0) AS paid,
         coalesce(sum("subsidy"), 0) AS subsidy, coalesce(sum("subsidy") FILTER (WHERE "zakahEligible"), 0) AS zakah
    INTO l FROM "clinic_claim_lines" WHERE "claimId" = claim_id;
  IF l.n <> c."lineCount" OR l.price <> c."totalPrice" OR l.paid <> c."patientPaid"
     OR l.subsidy <> c."subsidyTotal" OR l.zakah <> c."zakahAmount" THEN
    RAISE EXCEPTION 'Clinic claim %''s totals don''t match its lines', claim_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION clinic_claims_check_totals() RETURNS trigger AS $$
BEGIN
  PERFORM clinic_claims_assert_totals(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION clinic_claim_lines_check_totals() RETURNS trigger AS $$
BEGIN
  PERFORM clinic_claims_assert_totals(NEW."claimId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER clinic_claims_totals_match
  AFTER INSERT ON "clinic_claims"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinic_claims_check_totals();

CREATE CONSTRAINT TRIGGER clinic_claim_lines_totals_match
  AFTER INSERT ON "clinic_claim_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinic_claim_lines_check_totals();
