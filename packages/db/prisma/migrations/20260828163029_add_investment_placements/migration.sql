-- AlterTable
ALTER TABLE "investments" ADD COLUMN     "placementId" TEXT;

-- CreateTable
CREATE TABLE "investment_placements" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instrumentType" "InvestmentInstrumentType" NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_placements_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "investment_placements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_placements" ADD CONSTRAINT "investment_placements_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_placements" ADD CONSTRAINT "investment_placements_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
