-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('passport', 'national_id', 'drivers_license', 'other');

-- AlterEnum
ALTER TYPE "ActorType" ADD VALUE 'public_donor';

-- CreateTable
CREATE TABLE "vault_donors" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "idType" "IdType",
    "idNumberEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_donors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_donor_thresholds" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "thresholdAmount" DECIMAL(65,30) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_donor_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_contributions" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "vaultCauseId" TEXT,
    "donorId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" "ContributionProvider" NOT NULL,
    "providerReference" TEXT NOT NULL,
    "status" "ContributionStatus" NOT NULL DEFAULT 'pending',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_donors_email_key" ON "vault_donors"("email");

-- CreateIndex
CREATE UNIQUE INDEX "vault_donor_thresholds_currency_key" ON "vault_donor_thresholds"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "vault_contributions_providerReference_key" ON "vault_contributions"("providerReference");

-- CreateIndex
CREATE INDEX "vault_contributions_vaultId_idx" ON "vault_contributions"("vaultId");

-- CreateIndex
CREATE INDEX "vault_contributions_donorId_idx" ON "vault_contributions"("donorId");

-- AddForeignKey
ALTER TABLE "vault_contributions" ADD CONSTRAINT "vault_contributions_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_contributions" ADD CONSTRAINT "vault_contributions_vaultCauseId_fkey" FOREIGN KEY ("vaultCauseId") REFERENCES "vault_causes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_contributions" ADD CONSTRAINT "vault_contributions_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "vault_donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

