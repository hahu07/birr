-- CreateEnum
CREATE TYPE "BeneficiaryNominationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "beneficiary_nominations" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "proposedByFounderId" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "causeId" TEXT,
    "name" TEXT NOT NULL,
    "eligibilityCriteria" TEXT NOT NULL,
    "status" "BeneficiaryNominationStatus" NOT NULL DEFAULT 'pending',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "resultingBeneficiaryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beneficiary_nominations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "beneficiary_nominations_resultingBeneficiaryId_key" ON "beneficiary_nominations"("resultingBeneficiaryId");

-- AddForeignKey
ALTER TABLE "beneficiary_nominations" ADD CONSTRAINT "beneficiary_nominations_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_nominations" ADD CONSTRAINT "beneficiary_nominations_proposedByFounderId_fkey" FOREIGN KEY ("proposedByFounderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_nominations" ADD CONSTRAINT "beneficiary_nominations_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_nominations" ADD CONSTRAINT "beneficiary_nominations_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "waqf_causes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_nominations" ADD CONSTRAINT "beneficiary_nominations_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_nominations" ADD CONSTRAINT "beneficiary_nominations_resultingBeneficiaryId_fkey" FOREIGN KEY ("resultingBeneficiaryId") REFERENCES "beneficiaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
