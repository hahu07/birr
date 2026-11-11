-- AlterTable
ALTER TABLE "zakah_payments" ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "heldByUserId" TEXT,
ADD COLUMN     "heldReason" TEXT;

-- AddForeignKey
ALTER TABLE "zakah_payments" ADD CONSTRAINT "zakah_payments_heldByUserId_fkey" FOREIGN KEY ("heldByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Hand-written database rules.

-- Only a confirmed payment can be held, and a hold always says why and who.
ALTER TABLE "zakah_payments"
  ADD CONSTRAINT "zakah_payments_hold_consistent" CHECK (
    ("heldAt" IS NULL AND "heldReason" IS NULL AND "heldByUserId" IS NULL)
    OR ("heldAt" IS NOT NULL AND "heldReason" IS NOT NULL AND "heldByUserId" IS NOT NULL AND "status" = 'confirmed')
  );
