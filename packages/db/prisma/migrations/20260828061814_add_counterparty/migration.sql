-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('bank', 'asset_manager', 'broker_dealer', 'fund_administrator', 'other');

-- CreateEnum
CREATE TYPE "CounterpartyStatus" AS ENUM ('pending_review', 'active', 'under_review', 'suspended', 'blacklisted');

-- AlterTable
ALTER TABLE "investments" ADD COLUMN     "counterpartyId" TEXT;

-- CreateTable
CREATE TABLE "counterparties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institutionType" "CounterpartyType" NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "status" "CounterpartyStatus" NOT NULL DEFAULT 'pending_review',
    "regulatoryLicenseNumber" TEXT,
    "regulatingAuthority" TEXT,
    "licenseExpiresAt" TIMESTAMP(3),
    "shariahApprovedAt" TIMESTAMP(3),
    "shariahApprovedByUserId" TEXT,
    "concentrationLimit" DECIMAL(65,30),
    "concentrationLimitCurrency" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_name_key" ON "counterparties"("name");

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_shariahApprovedByUserId_fkey" FOREIGN KEY ("shariahApprovedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
