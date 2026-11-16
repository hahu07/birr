-- AlterTable
ALTER TABLE "recurring_gifts" ADD COLUMN     "whatsappNumber" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vault_donors" ADD COLUMN     "whatsappNumber" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "zakah_payers" ADD COLUMN     "whatsappNumber" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "giver_whatsapp_confirmations" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "proofHash" TEXT,
    "proofExpiresAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "giver_whatsapp_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "giver_whatsapp_confirmations_proofHash_key" ON "giver_whatsapp_confirmations"("proofHash");

-- CreateIndex
CREATE INDEX "giver_whatsapp_confirmations_phoneNumber_createdAt_idx" ON "giver_whatsapp_confirmations"("phoneNumber", "createdAt");

-- CreateIndex
CREATE INDEX "giver_whatsapp_confirmations_requestIp_createdAt_idx" ON "giver_whatsapp_confirmations"("requestIp", "createdAt");

-- CreateIndex
CREATE INDEX "vault_donors_whatsappNumber_idx" ON "vault_donors"("whatsappNumber");

-- CreateIndex
CREATE INDEX "zakah_payers_whatsappNumber_idx" ON "zakah_payers"("whatsappNumber");


-- Every giver is reachable: an email, a confirmed WhatsApp number, or both
-- (owner's decision, 2026-11-16). A stored number is E.164.
ALTER TABLE "zakah_payers" ADD CONSTRAINT "zakah_payers_contact" CHECK ("email" IS NOT NULL OR "whatsappNumber" IS NOT NULL);
ALTER TABLE "zakah_payers" ADD CONSTRAINT "zakah_payers_whatsapp_e164" CHECK ("whatsappNumber" IS NULL OR "whatsappNumber" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "vault_donors" ADD CONSTRAINT "vault_donors_contact" CHECK ("email" IS NOT NULL OR "whatsappNumber" IS NOT NULL);
ALTER TABLE "vault_donors" ADD CONSTRAINT "vault_donors_whatsapp_e164" CHECK ("whatsappNumber" IS NULL OR "whatsappNumber" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_contact" CHECK ("email" IS NOT NULL OR "whatsappNumber" IS NOT NULL);
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_whatsapp_e164" CHECK ("whatsappNumber" IS NULL OR "whatsappNumber" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "giver_whatsapp_confirmations" ADD CONSTRAINT "giver_whatsapp_confirmations_e164" CHECK ("phoneNumber" ~ '^\+[1-9][0-9]{7,14}$');
-- A proof only ever exists on a confirmed row.
ALTER TABLE "giver_whatsapp_confirmations" ADD CONSTRAINT "giver_whatsapp_confirmations_proof_after_confirm" CHECK ("proofHash" IS NULL OR "confirmedAt" IS NOT NULL);
