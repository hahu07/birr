-- CreateEnum
CREATE TYPE "SanctionsScreeningProvider" AS ENUM ('screenshield');

-- CreateEnum
CREATE TYPE "SanctionsScreeningStatus" AS ENUM ('clear', 'hit', 'error', 'cleared');

-- CreateTable
CREATE TABLE "sanctions_screenings" (
    "id" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "provider" "SanctionsScreeningProvider" NOT NULL,
    "status" "SanctionsScreeningStatus" NOT NULL,
    "screenedName" TEXT NOT NULL,
    "rawResponseEncrypted" TEXT,
    "errorMessage" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_screenings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sanctions_screenings_counterpartyId_idx" ON "sanctions_screenings"("counterpartyId");

-- AddForeignKey
ALTER TABLE "sanctions_screenings" ADD CONSTRAINT "sanctions_screenings_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanctions_screenings" ADD CONSTRAINT "sanctions_screenings_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

