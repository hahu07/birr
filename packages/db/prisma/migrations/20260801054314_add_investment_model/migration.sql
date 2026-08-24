-- CreateEnum
CREATE TYPE "InvestmentInstrumentType" AS ENUM ('sukuk', 'equity_fund', 'real_estate_fund', 'murabaha', 'other');

-- CreateEnum
CREATE TYPE "InvestmentStatus" AS ENUM ('active', 'liquidated');

-- CreateTable
CREATE TABLE "investments" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instrumentType" "InvestmentInstrumentType" NOT NULL,
    "allocatedAmount" DECIMAL(65,30) NOT NULL,
    "status" "InvestmentStatus" NOT NULL DEFAULT 'active',
    "liquidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "investments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
