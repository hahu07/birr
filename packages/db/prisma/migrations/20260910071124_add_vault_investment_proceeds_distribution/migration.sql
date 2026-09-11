-- AlterEnum
ALTER TYPE "CounterpartyType" ADD VALUE 'relief_partner';

-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "payoutBankDetailsEncrypted" TEXT,
ADD COLUMN     "payoutProvider" "PayoutProvider";

-- AlterTable
ALTER TABLE "governed_actions" ADD COLUMN     "vaultId" TEXT;

-- AlterTable
ALTER TABLE "vault_causes" ADD COLUMN     "allocatedAmount" DECIMAL(65,30),
ADD COLUMN     "proceedsAllocatedAmount" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "vault_investments" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instrumentType" "InvestmentInstrumentType" NOT NULL,
    "allocatedAmount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "InvestmentStatus" NOT NULL DEFAULT 'active',
    "liquidatedAt" TIMESTAMP(3),
    "counterpartyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vault_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_proceeds" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "vaultInvestmentId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_proceeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_distributions" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "vaultCauseId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "DistributionStatus" NOT NULL DEFAULT 'pending',
    "approvedAt" TIMESTAMP(3),
    "payoutProvider" "PayoutProvider",
    "payoutReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "payoutError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vault_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_investments_vaultId_idx" ON "vault_investments"("vaultId");

-- CreateIndex
CREATE INDEX "vault_proceeds_vaultId_idx" ON "vault_proceeds"("vaultId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_distributions_payoutReference_key" ON "vault_distributions"("payoutReference");

-- CreateIndex
CREATE INDEX "vault_distributions_vaultId_idx" ON "vault_distributions"("vaultId");

-- CreateIndex
CREATE INDEX "vault_distributions_vaultCauseId_idx" ON "vault_distributions"("vaultCauseId");

-- AddForeignKey
ALTER TABLE "governed_actions" ADD CONSTRAINT "governed_actions_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_investments" ADD CONSTRAINT "vault_investments_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_investments" ADD CONSTRAINT "vault_investments_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_proceeds" ADD CONSTRAINT "vault_proceeds_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_proceeds" ADD CONSTRAINT "vault_proceeds_vaultInvestmentId_fkey" FOREIGN KEY ("vaultInvestmentId") REFERENCES "vault_investments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_proceeds" ADD CONSTRAINT "vault_proceeds_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_distributions" ADD CONSTRAINT "vault_distributions_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_distributions" ADD CONSTRAINT "vault_distributions_vaultCauseId_fkey" FOREIGN KEY ("vaultCauseId") REFERENCES "vault_causes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_distributions" ADD CONSTRAINT "vault_distributions_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

