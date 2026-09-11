-- CreateEnum
CREATE TYPE "VaultRefundStatus" AS ENUM ('requested', 'processing', 'refunded', 'failed');

-- AlterTable
ALTER TABLE "vault_contributions" ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "heldReason" TEXT,
ADD COLUMN     "providerPaymentId" TEXT,
ADD COLUMN     "refundFailedReason" TEXT,
ADD COLUMN     "refundReference" TEXT,
ADD COLUMN     "refundStatus" "VaultRefundStatus",
ADD COLUMN     "refundedAt" TIMESTAMP(3);
