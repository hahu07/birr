
-- CreateTable
CREATE TABLE "vault_gift_minimums" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "minAmount" DECIMAL(65,30) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_gift_minimums_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_gift_minimums_currency_key" ON "vault_gift_minimums"("currency");


-- Vault gifts had silently shared the Waqf contribution minimum. Start
-- from today's values, so every currency keeps the floor it has now,
-- then naira at ₦5,000 (owner's decision, 2026-11-16).
INSERT INTO "vault_gift_minimums" ("id", "currency", "minAmount", "updatedAt")
SELECT gen_random_uuid()::text, "currency", "minAmount", CURRENT_TIMESTAMP FROM "contribution_minimums";
UPDATE "vault_gift_minimums" SET "minAmount" = 5000, "updatedAt" = CURRENT_TIMESTAMP WHERE "currency" = 'NGN';
