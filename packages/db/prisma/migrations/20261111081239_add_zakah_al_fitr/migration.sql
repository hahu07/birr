-- CreateEnum
CREATE TYPE "ZakahPool" AS ENUM ('mal', 'fitr_food', 'fitr_cash');

-- CreateEnum
CREATE TYPE "ZakahFitrCampaignStatus" AS ENUM ('draft', 'approved', 'superseded');

-- AlterTable
ALTER TABLE "zakah_distributions" ADD COLUMN     "pool" "ZakahPool" NOT NULL DEFAULT 'mal';

-- AlterTable
ALTER TABLE "zakah_payments" ADD COLUMN     "fitrCampaignId" TEXT,
ADD COLUMN     "fitrPeople" INTEGER,
ADD COLUMN     "pool" "ZakahPool" NOT NULL DEFAULT 'mal';

-- AlterTable
ALTER TABLE "zakah_refunds" ADD COLUMN     "pool" "ZakahPool" NOT NULL DEFAULT 'mal';

-- CreateTable
CREATE TABLE "zakah_fitr_campaigns" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "staple" TEXT NOT NULL,
    "kgPerPerson" DECIMAL(65,30) NOT NULL,
    "amountPerPerson" DECIMAL(65,30) NOT NULL,
    "opensOn" DATE NOT NULL,
    "expectedEidOn" DATE NOT NULL,
    "closesOn" DATE NOT NULL,
    "closedAt" TIMESTAMP(3),
    "status" "ZakahFitrCampaignStatus" NOT NULL DEFAULT 'draft',
    "approvedAt" TIMESTAMP(3),
    "approvedGovernedActionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zakah_fitr_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zakah_fitr_campaigns_approvedGovernedActionId_key" ON "zakah_fitr_campaigns"("approvedGovernedActionId");

-- CreateIndex
CREATE UNIQUE INDEX "zakah_fitr_campaigns_season_version_key" ON "zakah_fitr_campaigns"("season", "version");

-- AddForeignKey
ALTER TABLE "zakah_payments" ADD CONSTRAINT "zakah_payments_fitrCampaignId_fkey" FOREIGN KEY ("fitrCampaignId") REFERENCES "zakah_fitr_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_fitr_campaigns" ADD CONSTRAINT "zakah_fitr_campaigns_approvedGovernedActionId_fkey" FOREIGN KEY ("approvedGovernedActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_fitr_campaigns" ADD CONSTRAINT "zakah_fitr_campaigns_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Hand-written: the two fitr ledger accounts, and database rules.

INSERT INTO "zakah_ledger_accounts" ("id", "code", "name", "type", "isSystemDefault")
VALUES
  (gen_random_uuid()::text, '2100', 'Zakah al-Fitr held for recipients — food', 'liability', true),
  (gen_random_uuid()::text, '2200', 'Zakah al-Fitr held for recipients — cash', 'liability', true);

-- A fitr payment always names its campaign and how many people it covers;
-- zakah on wealth never does.
ALTER TABLE "zakah_payments"
  ADD CONSTRAINT "zakah_payments_pool_fields" CHECK (
    ("pool" = 'mal' AND "fitrCampaignId" IS NULL AND "fitrPeople" IS NULL)
    OR ("pool" <> 'mal' AND "fitrCampaignId" IS NOT NULL AND "fitrPeople" BETWEEN 1 AND 100)
  );

-- Fitr goes to the poor and the needy only (the majority view).
ALTER TABLE "zakah_distributions"
  ADD CONSTRAINT "zakah_distributions_fitr_categories" CHECK ("pool" = 'mal' OR "category" IN ('fuqara', 'masakin'));

-- A row's pool is part of its money facts: it never changes. These
-- replace the earlier functions with the same rules plus the new fields.
CREATE OR REPLACE FUNCTION zakah_payments_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'zakah_payments rows are never deleted';
  END IF;
  IF NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."feeCover" IS DISTINCT FROM OLD."feeCover"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."settlementSubaccount" IS DISTINCT FROM OLD."settlementSubaccount"
     OR NEW."payerId" IS DISTINCT FROM OLD."payerId"
     OR NEW."pool" IS DISTINCT FROM OLD."pool"
     OR NEW."fitrCampaignId" IS DISTINCT FROM OLD."fitrCampaignId"
     OR NEW."fitrPeople" IS DISTINCT FROM OLD."fitrPeople" THEN
    RAISE EXCEPTION 'A zakah payment''s amount, fee, currency, settlement account, payer and pool never change';
  END IF;
  IF OLD."status" <> 'pending' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'A zakah payment that is % can''t change status', OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION zakah_distributions_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'zakah_distributions rows are never deleted';
  END IF;
  IF NEW."recipientId" IS DISTINCT FROM OLD."recipientId"
     OR NEW."counterpartyId" IS DISTINCT FROM OLD."counterpartyId"
     OR NEW."category" IS DISTINCT FROM OLD."category"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."pool" IS DISTINCT FROM OLD."pool" THEN
    RAISE EXCEPTION 'A zakah distribution''s payee, category, amount and pool never change';
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

CREATE OR REPLACE FUNCTION zakah_refunds_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'zakah_refunds rows are never deleted';
  END IF;
  IF NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."payeeBankDetailsEncrypted" IS DISTINCT FROM OLD."payeeBankDetailsEncrypted"
     OR NEW."pool" IS DISTINCT FROM OLD."pool" THEN
    RAISE EXCEPTION 'A zakah refund''s payment, amount, payee account and pool never change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'pending_approval' AND NEW."status" IN ('approved', 'rejected'))
    OR (OLD."status" = 'approved' AND NEW."status" = 'paid')
  ) THEN
    RAISE EXCEPTION 'A zakah refund can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."status" = 'paid' AND (
    NEW."bankReference" IS DISTINCT FROM OLD."bankReference" OR NEW."paidOn" IS DISTINCT FROM OLD."paidOn"
  ) THEN
    RAISE EXCEPTION 'A paid zakah refund''s bank reference and date never change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Campaigns: the same versioning rules as zakah_rulesets.
ALTER TABLE "zakah_fitr_campaigns"
  ADD CONSTRAINT "zakah_fitr_campaigns_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "zakah_fitr_campaigns_amounts_positive" CHECK ("kgPerPerson" > 0 AND "amountPerPerson" > 0),
  -- Payments close the day before Eid (owner's decision, 2026-11-11).
  ADD CONSTRAINT "zakah_fitr_campaigns_closes_day_before_eid" CHECK ("closesOn" = "expectedEidOn" - 1),
  ADD CONSTRAINT "zakah_fitr_campaigns_opens_before_close" CHECK ("opensOn" <= "closesOn"),
  ADD CONSTRAINT "zakah_fitr_campaigns_approval_consistent" CHECK (
    ("status" = 'draft' AND "approvedAt" IS NULL AND "approvedGovernedActionId" IS NULL)
    OR ("status" <> 'draft' AND "approvedAt" IS NOT NULL AND "approvedGovernedActionId" IS NOT NULL)
  );

CREATE UNIQUE INDEX "zakah_fitr_campaigns_one_draft_per_season" ON "zakah_fitr_campaigns"("season") WHERE "status" = 'draft';
CREATE UNIQUE INDEX "zakah_fitr_campaigns_one_approved_per_season" ON "zakah_fitr_campaigns"("season") WHERE "status" = 'approved';

-- A draft may be edited or approved. An approved version never changes,
-- except to close payments early (once) or be superseded. A superseded
-- version never changes. Nothing is deleted.
CREATE OR REPLACE FUNCTION zakah_fitr_campaigns_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'zakah_fitr_campaigns rows are never deleted';
  END IF;
  IF NEW."season" IS DISTINCT FROM OLD."season"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'A fitr campaign''s season, version and creator never change';
  END IF;
  IF OLD."status" = 'draft' THEN
    IF NEW."status" NOT IN ('draft', 'approved') THEN
      RAISE EXCEPTION 'A draft fitr campaign can only be edited or approved';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'approved'
     AND NEW."staple" IS NOT DISTINCT FROM OLD."staple"
     AND NEW."kgPerPerson" IS NOT DISTINCT FROM OLD."kgPerPerson"
     AND NEW."amountPerPerson" IS NOT DISTINCT FROM OLD."amountPerPerson"
     AND NEW."opensOn" IS NOT DISTINCT FROM OLD."opensOn"
     AND NEW."expectedEidOn" IS NOT DISTINCT FROM OLD."expectedEidOn"
     AND NEW."closesOn" IS NOT DISTINCT FROM OLD."closesOn"
     AND NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt"
     AND NEW."approvedGovernedActionId" IS NOT DISTINCT FROM OLD."approvedGovernedActionId"
     AND (NEW."closedAt" IS NOT DISTINCT FROM OLD."closedAt" OR OLD."closedAt" IS NULL)
     AND NEW."status" IN ('approved', 'superseded') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'An approved fitr campaign can''t be edited — draft a new version instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zakah_fitr_campaigns_before_change
  BEFORE UPDATE OR DELETE ON "zakah_fitr_campaigns"
  FOR EACH ROW EXECUTE FUNCTION zakah_fitr_campaigns_check_change();
