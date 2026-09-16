-- CreateTable
CREATE TABLE "vault_cause_allocations" (
    "id" TEXT NOT NULL,
    "vaultCauseId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "proceedsAllocatedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_cause_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_cause_allocations_vaultCauseId_currency_key" ON "vault_cause_allocations"("vaultCauseId", "currency");

-- AddForeignKey
ALTER TABLE "vault_cause_allocations" ADD CONSTRAINT "vault_cause_allocations_vaultCauseId_fkey" FOREIGN KEY ("vaultCauseId") REFERENCES "vault_causes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data backfill: every VaultCause.allocatedAmount/proceedsAllocatedAmount
-- set before this migration was implicitly denominated in its parent
-- Vault's primary currency (no other currency was reachable until this
-- migration made VaultCauseAllocation currency-aware) — carry those
-- values forward as that currency's row before the columns are dropped
-- below, so existing allocations aren't silently lost.
INSERT INTO "vault_cause_allocations" ("id", "vaultCauseId", "currency", "allocatedAmount", "proceedsAllocatedAmount", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    vc.id,
    v.currency,
    COALESCE(vc."allocatedAmount", 0),
    COALESCE(vc."proceedsAllocatedAmount", 0),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "vault_causes" vc
JOIN "vaults" v ON v.id = vc."vaultId"
WHERE vc."allocatedAmount" IS NOT NULL OR vc."proceedsAllocatedAmount" IS NOT NULL;

-- AlterTable
ALTER TABLE "vault_causes" DROP COLUMN "allocatedAmount",
DROP COLUMN "proceedsAllocatedAmount";
