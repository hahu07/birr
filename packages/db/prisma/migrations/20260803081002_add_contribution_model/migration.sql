-- CreateEnum
CREATE TYPE "ContributionProvider" AS ENUM ('stripe', 'paystack', 'stablecoin');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('pending', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "contributions" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" "ContributionProvider" NOT NULL,
    "providerReference" TEXT NOT NULL,
    "status" "ContributionStatus" NOT NULL DEFAULT 'pending',
    "assetId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contributions_assetId_key" ON "contributions"("assetId");

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
