-- CreateEnum
CREATE TYPE "ClinicAssetAcquisition" AS ENUM ('donated', 'purchased');

-- CreateEnum
CREATE TYPE "ClinicWorksRoute" AS ENUM ('build_on_donated_land', 'build_on_bought_land', 'renovate');

-- CreateEnum
CREATE TYPE "ClinicWorksStatus" AS ENUM ('proposed', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ClinicSpendKind" AS ENUM ('equipment', 'works_stage');

-- CreateEnum
CREATE TYPE "ClinicSpendStatus" AS ENUM ('pending_approval', 'approved', 'rejected', 'paid');

-- AlterTable
ALTER TABLE "clinic_assets" ADD COLUMN     "acquisition" "ClinicAssetAcquisition" NOT NULL DEFAULT 'donated';

-- CreateTable
CREATE TABLE "clinic_works_projects" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "route" "ClinicWorksRoute" NOT NULL,
    "contractorId" TEXT NOT NULL,
    "budget" DECIMAL(65,30) NOT NULL,
    "budgetNote" TEXT NOT NULL,
    "status" "ClinicWorksStatus" NOT NULL DEFAULT 'proposed',
    "approvalActionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_works_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_spends" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "kind" "ClinicSpendKind" NOT NULL,
    "worksProjectId" TEXT,
    "payeeId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "supportingReference" TEXT NOT NULL,
    "status" "ClinicSpendStatus" NOT NULL DEFAULT 'pending_approval',
    "approvalActionId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paymentActionId" TEXT,
    "paidOn" DATE,
    "bankReference" TEXT,
    "assetId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_spends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_works_projects_approvalActionId_key" ON "clinic_works_projects"("approvalActionId");

-- CreateIndex
CREATE INDEX "clinic_works_projects_clinicWaqfId_idx" ON "clinic_works_projects"("clinicWaqfId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_spends_approvalActionId_key" ON "clinic_spends"("approvalActionId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_spends_paymentActionId_key" ON "clinic_spends"("paymentActionId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_spends_assetId_key" ON "clinic_spends"("assetId");

-- CreateIndex
CREATE INDEX "clinic_spends_clinicWaqfId_idx" ON "clinic_spends"("clinicWaqfId");

-- CreateIndex
CREATE INDEX "clinic_spends_worksProjectId_idx" ON "clinic_spends"("worksProjectId");

-- AddForeignKey
ALTER TABLE "clinic_works_projects" ADD CONSTRAINT "clinic_works_projects_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_works_projects" ADD CONSTRAINT "clinic_works_projects_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_works_projects" ADD CONSTRAINT "clinic_works_projects_approvalActionId_fkey" FOREIGN KEY ("approvalActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_works_projects" ADD CONSTRAINT "clinic_works_projects_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_worksProjectId_fkey" FOREIGN KEY ("worksProjectId") REFERENCES "clinic_works_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_approvalActionId_fkey" FOREIGN KEY ("approvalActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_paymentActionId_fkey" FOREIGN KEY ("paymentActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "clinic_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Hand-written database rules (2026-11-17, clinic slice 5b).

ALTER TABLE "clinic_works_projects"
  ADD CONSTRAINT "clinic_works_budget_positive" CHECK ("budget" > 0 AND "budget" = round("budget", 2)),
  ADD CONSTRAINT "clinic_works_text_present" CHECK (length(btrim("name")) > 0 AND length(btrim("budgetNote")) > 0),
  ADD CONSTRAINT "clinic_works_approval_consistent" CHECK (("status" = 'approved') = ("approvalActionId" IS NOT NULL));

ALTER TABLE "clinic_spends"
  ADD CONSTRAINT "clinic_spends_amount_positive" CHECK ("amount" > 0 AND "amount" = round("amount", 2)),
  ADD CONSTRAINT "clinic_spends_text_present" CHECK (length(btrim("description")) > 0 AND length(btrim("supportingReference")) > 0),
  -- A works stage belongs to a works project; equipment to none.
  ADD CONSTRAINT "clinic_spends_kind_project" CHECK (("kind" = 'works_stage') = ("worksProjectId" IS NOT NULL)),
  -- Only paid equipment names the asset it bought.
  ADD CONSTRAINT "clinic_spends_asset" CHECK ("assetId" IS NULL OR ("kind" = 'equipment' AND "status" = 'paid')),
  -- Each status carries exactly what decided it.
  ADD CONSTRAINT "clinic_spends_status_consistent" CHECK (
    ("status" IN ('pending_approval', 'rejected') AND "approvalActionId" IS NULL AND "approvedAt" IS NULL AND "paymentActionId" IS NULL AND "paidOn" IS NULL AND "bankReference" IS NULL)
    OR ("status" = 'approved' AND "approvalActionId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "paymentActionId" IS NULL AND "paidOn" IS NULL AND "bankReference" IS NULL)
    OR ("status" = 'paid' AND "approvalActionId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "paymentActionId" IS NOT NULL AND "paidOn" IS NOT NULL AND length(btrim(coalesce("bankReference", ''))) > 0)
  );

-- What a project is and its budget never change once proposed; status
-- moves only forward; never deleted.
CREATE OR REPLACE FUNCTION clinic_works_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic works project is never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId" OR NEW."route" IS DISTINCT FROM OLD."route"
     OR NEW."contractorId" IS DISTINCT FROM OLD."contractorId" OR NEW."budget" IS DISTINCT FROM OLD."budget"
     OR NEW."budgetNote" IS DISTINCT FROM OLD."budgetNote" OR NEW."name" IS DISTINCT FROM OLD."name" THEN
    RAISE EXCEPTION 'A clinic works project''s route, contractor and budget never change; propose a new one';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (OLD."status" = 'proposed' AND NEW."status" IN ('approved', 'rejected')) THEN
    RAISE EXCEPTION 'A clinic works project can''t go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_works_before_change
  BEFORE UPDATE OR DELETE ON "clinic_works_projects"
  FOR EACH ROW EXECUTE FUNCTION clinic_works_check_change();

-- What a payment is for, to whom and how much never change; status moves
-- only pending_approval -> approved | rejected, approved -> paid; never deleted.
CREATE OR REPLACE FUNCTION clinic_spends_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic spend is never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId" OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."worksProjectId" IS DISTINCT FROM OLD."worksProjectId" OR NEW."payeeId" IS DISTINCT FROM OLD."payeeId"
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

CREATE TRIGGER clinic_spends_before_change
  BEFORE UPDATE OR DELETE ON "clinic_spends"
  FOR EACH ROW EXECUTE FUNCTION clinic_spends_check_change();

-- A bought asset's value and acquisition never change either (add the
-- column to the existing rule).
CREATE OR REPLACE FUNCTION clinic_assets_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic waqf asset is never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."name" IS DISTINCT FROM OLD."name"
     OR NEW."value" IS DISTINCT FROM OLD."value"
     OR NEW."valuationNote" IS DISTINCT FROM OLD."valuationNote"
     OR NEW."donorName" IS DISTINCT FROM OLD."donorName"
     OR NEW."acquiredOn" IS DISTINCT FROM OLD."acquiredOn"
     OR NEW."acquisition" IS DISTINCT FROM OLD."acquisition"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'What a clinic waqf asset is, and its value, never change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'proposed' AND NEW."status" IN ('active', 'rejected'))
       OR (OLD."status" = 'active' AND NEW."status" = 'disposed')) THEN
    RAISE EXCEPTION 'A clinic waqf asset can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."status" IN ('rejected', 'disposed') AND (
       NEW."location" IS DISTINCT FROM OLD."location" OR NEW."serialNumber" IS DISTINCT FROM OLD."serialNumber"
       OR NEW."warrantyUntil" IS DISTINCT FROM OLD."warrantyUntil" OR NEW."lastServicedOn" IS DISTINCT FROM OLD."lastServicedOn"
       OR NEW."nextServiceDue" IS DISTINCT FROM OLD."nextServiceDue" OR NEW."description" IS DISTINCT FROM OLD."description") THEN
    RAISE EXCEPTION 'A % clinic waqf asset can''t be changed', OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
