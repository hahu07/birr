-- AlterTable
ALTER TABLE "vault_contributions" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactWhatsApp" TEXT;

-- AlterTable
ALTER TABLE "zakah_payments" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactWhatsApp" TEXT;


-- A receipt number is E.164, like the giver records' (2026-11-16).
ALTER TABLE "vault_contributions" ADD CONSTRAINT "vault_contributions_contact_whatsapp_e164" CHECK ("contactWhatsApp" IS NULL OR "contactWhatsApp" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "zakah_payments" ADD CONSTRAINT "zakah_payments_contact_whatsapp_e164" CHECK ("contactWhatsApp" IS NULL OR "contactWhatsApp" ~ '^\+[1-9][0-9]{7,14}$');

-- Payments made before this keep receiving receipts where they always did:
-- the giver record's email, which is what the receipt used then.
UPDATE "vault_contributions" c SET "contactEmail" = d."email" FROM "vault_donors" d WHERE c."donorId" = d."id" AND c."contactEmail" IS NULL;
UPDATE "zakah_payments" p SET "contactEmail" = z."email" FROM "zakah_payers" z WHERE p."payerId" = z."id" AND p."contactEmail" IS NULL;
