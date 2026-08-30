-- CreateEnum
CREATE TYPE "PayoutProvider" AS ENUM ('stripe', 'paystack', 'stablecoin');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DistributionStatus" ADD VALUE 'disbursing';
ALTER TYPE "DistributionStatus" ADD VALUE 'paid';
ALTER TYPE "DistributionStatus" ADD VALUE 'payout_failed';

-- AlterTable
ALTER TABLE "beneficiaries" ADD COLUMN     "payoutProvider" "PayoutProvider";

-- AlterTable
ALTER TABLE "beneficiary_nominations" ADD COLUMN     "payoutProvider" "PayoutProvider";

-- AlterTable
ALTER TABLE "distributions" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "payoutError" TEXT,
ADD COLUMN     "payoutProvider" "PayoutProvider",
ADD COLUMN     "payoutReference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "distributions_payoutReference_key" ON "distributions"("payoutReference");

