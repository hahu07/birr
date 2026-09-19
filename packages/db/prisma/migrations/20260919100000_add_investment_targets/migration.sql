-- CreateTable
CREATE TABLE "investment_targets" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "instrumentType" "InvestmentInstrumentType" NOT NULL,
    "targetPercent" DECIMAL(65,30) NOT NULL,
    "setByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_investment_targets" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "instrumentType" "InvestmentInstrumentType" NOT NULL,
    "targetPercent" DECIMAL(65,30) NOT NULL,
    "setByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_investment_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investment_targets_waqfId_idx" ON "investment_targets"("waqfId");

-- CreateIndex
CREATE UNIQUE INDEX "investment_targets_waqfId_instrumentType_key" ON "investment_targets"("waqfId", "instrumentType");

-- CreateIndex
CREATE INDEX "vault_investment_targets_vaultId_idx" ON "vault_investment_targets"("vaultId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_investment_targets_vaultId_instrumentType_key" ON "vault_investment_targets"("vaultId", "instrumentType");

-- AddForeignKey
ALTER TABLE "investment_targets" ADD CONSTRAINT "investment_targets_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_targets" ADD CONSTRAINT "investment_targets_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_investment_targets" ADD CONSTRAINT "vault_investment_targets_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_investment_targets" ADD CONSTRAINT "vault_investment_targets_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
