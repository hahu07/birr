-- CreateEnum
CREATE TYPE "ZakahRefundReason" AS ENUM ('duplicate_payment', 'wrong_amount', 'unauthorised_payment');

-- CreateEnum
CREATE TYPE "ZakahRefundStatus" AS ENUM ('pending_approval', 'approved', 'paid', 'rejected');

-- AlterEnum
ALTER TYPE "ZakahJournalEntrySource" ADD VALUE 'refund';

-- CreateTable
CREATE TABLE "zakah_refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" "ZakahRefundReason" NOT NULL,
    "details" TEXT NOT NULL,
    "payeeBankDetailsEncrypted" TEXT NOT NULL,
    "status" "ZakahRefundStatus" NOT NULL DEFAULT 'pending_approval',
    "approvedAt" TIMESTAMP(3),
    "approvalActionId" TEXT,
    "paidOn" DATE,
    "bankReference" TEXT,
    "paymentActionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zakah_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zakah_refunds_approvalActionId_key" ON "zakah_refunds"("approvalActionId");

-- CreateIndex
CREATE UNIQUE INDEX "zakah_refunds_paymentActionId_key" ON "zakah_refunds"("paymentActionId");

-- CreateIndex
CREATE INDEX "zakah_refunds_paymentId_idx" ON "zakah_refunds"("paymentId");

-- CreateIndex
CREATE INDEX "zakah_refunds_status_idx" ON "zakah_refunds"("status");

-- AddForeignKey
ALTER TABLE "zakah_refunds" ADD CONSTRAINT "zakah_refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "zakah_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_refunds" ADD CONSTRAINT "zakah_refunds_approvalActionId_fkey" FOREIGN KEY ("approvalActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_refunds" ADD CONSTRAINT "zakah_refunds_paymentActionId_fkey" FOREIGN KEY ("paymentActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_refunds" ADD CONSTRAINT "zakah_refunds_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Hand-written database rules, the same shape as zakah_distributions.

ALTER TABLE "zakah_refunds"
  ADD CONSTRAINT "zakah_refunds_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "zakah_refunds_paid_has_reference" CHECK (
    "status" <> 'paid' OR ("bankReference" IS NOT NULL AND "paidOn" IS NOT NULL AND "paymentActionId" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION zakah_refunds_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'zakah_refunds rows are never deleted';
  END IF;
  IF NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."payeeBankDetailsEncrypted" IS DISTINCT FROM OLD."payeeBankDetailsEncrypted" THEN
    RAISE EXCEPTION 'A zakah refund''s payment, amount and payee account never change';
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

CREATE TRIGGER zakah_refunds_before_change
  BEFORE UPDATE OR DELETE ON "zakah_refunds"
  FOR EACH ROW EXECUTE FUNCTION zakah_refunds_check_change();
