-- CreateEnum
CREATE TYPE "ShariahScreeningDecision" AS ENUM ('approved', 'rejected');

-- AlterTable
ALTER TABLE "investments" ALTER COLUMN "status" SET DEFAULT 'pending_shariah_review';

-- AlterTable
ALTER TABLE "vault_investments" ALTER COLUMN "status" SET DEFAULT 'pending_shariah_review';

-- CreateTable
CREATE TABLE "shariah_prohibited_sectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shariah_prohibited_sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shariah_screenings" (
    "id" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "businessDescription" TEXT NOT NULL,
    "interestBearingDebtConcern" BOOLEAN,
    "nonCompliantIncomeConcern" BOOLEAN,
    "flaggedSectorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewerNotes" TEXT,
    "decision" "ShariahScreeningDecision",
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shariah_screenings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_shariah_screenings" (
    "id" TEXT NOT NULL,
    "vaultInvestmentId" TEXT NOT NULL,
    "businessDescription" TEXT NOT NULL,
    "interestBearingDebtConcern" BOOLEAN,
    "nonCompliantIncomeConcern" BOOLEAN,
    "flaggedSectorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewerNotes" TEXT,
    "decision" "ShariahScreeningDecision",
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_shariah_screenings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shariah_prohibited_sectors_name_key" ON "shariah_prohibited_sectors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "shariah_screenings_investmentId_key" ON "shariah_screenings"("investmentId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_shariah_screenings_vaultInvestmentId_key" ON "vault_shariah_screenings"("vaultInvestmentId");

-- AddForeignKey
ALTER TABLE "shariah_screenings" ADD CONSTRAINT "shariah_screenings_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "investments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shariah_screenings" ADD CONSTRAINT "shariah_screenings_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_shariah_screenings" ADD CONSTRAINT "vault_shariah_screenings_vaultInvestmentId_fkey" FOREIGN KEY ("vaultInvestmentId") REFERENCES "vault_investments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_shariah_screenings" ADD CONSTRAINT "vault_shariah_screenings_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
