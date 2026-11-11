-- CreateEnum
CREATE TYPE "ZakahJournalEntrySource" AS ENUM ('payment', 'manual_adjustment');

-- CreateTable
CREATE TABLE "zakah_payers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "idType" "IdType",
    "idNumberEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zakah_payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zakah_payments" (
    "id" TEXT NOT NULL,
    "payerId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "feeCover" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "provider" "ContributionProvider" NOT NULL,
    "providerReference" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "status" "ContributionStatus" NOT NULL DEFAULT 'pending',
    "confirmedAt" TIMESTAMP(3),
    "settlementSubaccount" TEXT NOT NULL,
    "wakalahConsentVersion" TEXT NOT NULL,
    "rulesetKey" TEXT,
    "rulesetVersion" INTEGER,
    "metalPriceId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zakah_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zakah_ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zakah_ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zakah_journal_entries" (
    "id" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "source" "ZakahJournalEntrySource" NOT NULL,
    "sourceId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zakah_journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zakah_journal_entry_lines" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "zakah_journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zakah_payers_email_key" ON "zakah_payers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "zakah_payments_providerReference_key" ON "zakah_payments"("providerReference");

-- CreateIndex
CREATE INDEX "zakah_payments_payerId_idx" ON "zakah_payments"("payerId");

-- CreateIndex
CREATE INDEX "zakah_payments_status_idx" ON "zakah_payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "zakah_ledger_accounts_code_key" ON "zakah_ledger_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "zakah_journal_entries_source_sourceId_key" ON "zakah_journal_entries"("source", "sourceId");

-- CreateIndex
CREATE INDEX "zakah_journal_entry_lines_journalEntryId_idx" ON "zakah_journal_entry_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "zakah_journal_entry_lines_ledgerAccountId_idx" ON "zakah_journal_entry_lines"("ledgerAccountId");

-- AddForeignKey
ALTER TABLE "zakah_payments" ADD CONSTRAINT "zakah_payments_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "zakah_payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_payments" ADD CONSTRAINT "zakah_payments_metalPriceId_fkey" FOREIGN KEY ("metalPriceId") REFERENCES "zakah_metal_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_journal_entry_lines" ADD CONSTRAINT "zakah_journal_entry_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "zakah_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_journal_entry_lines" ADD CONSTRAINT "zakah_journal_entry_lines_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "zakah_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Hand-written: the two system ledger accounts every confirmed
-- payment posts to, and the database-level rules.

INSERT INTO "zakah_ledger_accounts" ("id", "code", "name", "type", "isSystemDefault")
VALUES
  (gen_random_uuid()::text, '1000', 'Zakah bank account', 'asset', true),
  (gen_random_uuid()::text, '2000', 'Zakah held for recipients', 'liability', true);

ALTER TABLE "zakah_payments"
  ADD CONSTRAINT "zakah_payments_amounts_valid" CHECK ("amount" > 0 AND "feeCover" >= 0);

ALTER TABLE "zakah_journal_entry_lines"
  ADD CONSTRAINT "zakah_journal_entry_lines_debit_xor_credit"
  CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0));

-- The journal is append-only: a mistake is corrected with a new,
-- offsetting entry, never by editing or deleting one.
CREATE OR REPLACE FUNCTION zakah_journal_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The zakah ledger is append-only — post an offsetting entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zakah_journal_entries_append_only
  BEFORE UPDATE OR DELETE ON "zakah_journal_entries"
  FOR EACH ROW EXECUTE FUNCTION zakah_journal_append_only();

CREATE TRIGGER zakah_journal_entry_lines_append_only
  BEFORE UPDATE OR DELETE ON "zakah_journal_entry_lines"
  FOR EACH ROW EXECUTE FUNCTION zakah_journal_append_only();

-- A payment is never deleted, and once it has left "pending" its money
-- facts never change.
CREATE OR REPLACE FUNCTION zakah_payments_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'zakah_payments rows are never deleted';
  END IF;
  IF NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."feeCover" IS DISTINCT FROM OLD."feeCover"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."settlementSubaccount" IS DISTINCT FROM OLD."settlementSubaccount"
     OR NEW."payerId" IS DISTINCT FROM OLD."payerId" THEN
    RAISE EXCEPTION 'A zakah payment''s amount, fee, currency, settlement account and payer never change';
  END IF;
  IF OLD."status" <> 'pending' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'A zakah payment that is % can''t change status', OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zakah_payments_before_change
  BEFORE UPDATE OR DELETE ON "zakah_payments"
  FOR EACH ROW EXECUTE FUNCTION zakah_payments_check_change();
