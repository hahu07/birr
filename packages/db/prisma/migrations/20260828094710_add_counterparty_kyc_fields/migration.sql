-- AlterEnum
ALTER TYPE "CounterpartyType" ADD VALUE 'business';

-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "address" TEXT,
ADD COLUMN     "businessActivities" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "website" TEXT;
