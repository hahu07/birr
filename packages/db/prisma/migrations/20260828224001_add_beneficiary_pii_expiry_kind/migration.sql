-- CreateEnum
CREATE TYPE "BeneficiaryKind" AS ENUM ('individual', 'organization');

-- AlterTable
ALTER TABLE "beneficiaries" ADD COLUMN     "bankDetailsEncrypted" TEXT,
ADD COLUMN     "eligibilityExpiresAt" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "kind" "BeneficiaryKind" NOT NULL DEFAULT 'individual',
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "beneficiary_nominations" ADD COLUMN     "bankDetailsEncrypted" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "kind" "BeneficiaryKind" NOT NULL DEFAULT 'individual',
ADD COLUMN     "phone" TEXT;
