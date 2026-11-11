-- CreateEnum
CREATE TYPE "ZakahCategory" AS ENUM ('fuqara', 'masakin', 'amilin', 'muallafah', 'riqab', 'gharimin', 'fi_sabilillah', 'ibn_sabil');

-- CreateEnum
CREATE TYPE "ZakahDistributionStatus" AS ENUM ('pending_approval', 'approved', 'paid', 'rejected');

-- AlterEnum
ALTER TYPE "ZakahJournalEntrySource" ADD VALUE 'distribution';

-- CreateTable
CREATE TABLE "zakah_recipients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categories" "ZakahCategory"[],
    "eligibilityReason" TEXT NOT NULL,
    "phone" TEXT,
    "bankDetailsEncrypted" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zakah_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zakah_distributions" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT,
    "counterpartyId" TEXT,
    "category" "ZakahCategory" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ZakahDistributionStatus" NOT NULL DEFAULT 'pending_approval',
    "approvedAt" TIMESTAMP(3),
    "approvalActionId" TEXT,
    "paidOn" DATE,
    "bankReference" TEXT,
    "paymentActionId" TEXT,
    "partnerReachedCount" INTEGER,
    "partnerReport" TEXT,
    "partnerReportedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zakah_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zakah_distributions_approvalActionId_key" ON "zakah_distributions"("approvalActionId");

-- CreateIndex
CREATE UNIQUE INDEX "zakah_distributions_paymentActionId_key" ON "zakah_distributions"("paymentActionId");

-- CreateIndex
CREATE INDEX "zakah_distributions_status_idx" ON "zakah_distributions"("status");

-- CreateIndex
CREATE INDEX "zakah_distributions_recipientId_idx" ON "zakah_distributions"("recipientId");

-- CreateIndex
CREATE INDEX "zakah_distributions_counterpartyId_idx" ON "zakah_distributions"("counterpartyId");

-- AddForeignKey
ALTER TABLE "zakah_recipients" ADD CONSTRAINT "zakah_recipients_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_distributions" ADD CONSTRAINT "zakah_distributions_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "zakah_recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_distributions" ADD CONSTRAINT "zakah_distributions_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_distributions" ADD CONSTRAINT "zakah_distributions_approvalActionId_fkey" FOREIGN KEY ("approvalActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_distributions" ADD CONSTRAINT "zakah_distributions_paymentActionId_fkey" FOREIGN KEY ("paymentActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_distributions" ADD CONSTRAINT "zakah_distributions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Hand-written database rules.

ALTER TABLE "zakah_distributions"
  -- Exactly one payee: a verified individual or a vetted partner.
  ADD CONSTRAINT "zakah_distributions_one_payee" CHECK (("recipientId" IS NULL) <> ("counterpartyId" IS NULL)),
  ADD CONSTRAINT "zakah_distributions_amount_positive" CHECK ("amount" > 0),
  -- 100% of zakah reaches recipients (owner's decision, 2026-11-11): no
  -- administrators' share, so this category can never be paid.
  ADD CONSTRAINT "zakah_distributions_no_amilin" CHECK ("category" <> 'amilin'),
  ADD CONSTRAINT "zakah_distributions_paid_has_reference" CHECK (
    "status" <> 'paid' OR ("bankReference" IS NOT NULL AND "paidOn" IS NOT NULL AND "paymentActionId" IS NOT NULL)
  );

-- Never deleted. The payee, category and amount never change. Status
-- only moves forward: pending_approval → approved | rejected, approved → paid.
CREATE OR REPLACE FUNCTION zakah_distributions_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'zakah_distributions rows are never deleted';
  END IF;
  IF NEW."recipientId" IS DISTINCT FROM OLD."recipientId"
     OR NEW."counterpartyId" IS DISTINCT FROM OLD."counterpartyId"
     OR NEW."category" IS DISTINCT FROM OLD."category"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency" THEN
    RAISE EXCEPTION 'A zakah distribution''s payee, category and amount never change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'pending_approval' AND NEW."status" IN ('approved', 'rejected'))
    OR (OLD."status" = 'approved' AND NEW."status" = 'paid')
  ) THEN
    RAISE EXCEPTION 'A zakah distribution can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."status" = 'paid' AND (
    NEW."bankReference" IS DISTINCT FROM OLD."bankReference" OR NEW."paidOn" IS DISTINCT FROM OLD."paidOn"
  ) THEN
    RAISE EXCEPTION 'A paid zakah distribution''s bank reference and date never change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zakah_distributions_before_change
  BEFORE UPDATE OR DELETE ON "zakah_distributions"
  FOR EACH ROW EXECUTE FUNCTION zakah_distributions_check_change();

CREATE OR REPLACE FUNCTION zakah_recipients_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'zakah_recipients rows are never deleted — deactivate instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zakah_recipients_no_delete
  BEFORE DELETE ON "zakah_recipients"
  FOR EACH ROW EXECUTE FUNCTION zakah_recipients_no_delete();
