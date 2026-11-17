-- CreateEnum
CREATE TYPE "ClinicWaqfStatus" AS ENUM ('draft', 'established');

-- CreateEnum
CREATE TYPE "ClinicWaqfDeedStatus" AS ENUM ('draft', 'approved', 'superseded', 'discarded');

-- CreateEnum
CREATE TYPE "ClinicPot" AS ENUM ('endowment', 'running');

-- CreateEnum
CREATE TYPE "ClinicJournalEntrySource" AS ENUM ('gift', 'investment_income', 'expense', 'manual_adjustment');

-- CreateTable
CREATE TABLE "clinic_waqfs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "description" TEXT,
    "status" "ClinicWaqfStatus" NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "establishedAt" TIMESTAMP(3),
    "establishedActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_waqfs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_waqf_deeds" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "status" "ClinicWaqfDeedStatus" NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_waqf_deeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "pot" "ClinicPot" NOT NULL,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_journal_entries" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "source" "ClinicJournalEntrySource" NOT NULL,
    "sourceId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_journal_entry_lines" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "clinic_journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_waqfs_slug_key" ON "clinic_waqfs"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_waqfs_establishedActionId_key" ON "clinic_waqfs"("establishedActionId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_waqf_deeds_approvedActionId_key" ON "clinic_waqf_deeds"("approvedActionId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_waqf_deeds_clinicWaqfId_version_key" ON "clinic_waqf_deeds"("clinicWaqfId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_ledger_accounts_code_key" ON "clinic_ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "clinic_journal_entries_clinicWaqfId_idx" ON "clinic_journal_entries"("clinicWaqfId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_journal_entries_source_sourceId_key" ON "clinic_journal_entries"("source", "sourceId");

-- CreateIndex
CREATE INDEX "clinic_journal_entry_lines_journalEntryId_idx" ON "clinic_journal_entry_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "clinic_journal_entry_lines_ledgerAccountId_idx" ON "clinic_journal_entry_lines"("ledgerAccountId");

-- AddForeignKey
ALTER TABLE "clinic_waqfs" ADD CONSTRAINT "clinic_waqfs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_waqfs" ADD CONSTRAINT "clinic_waqfs_establishedActionId_fkey" FOREIGN KEY ("establishedActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_waqf_deeds" ADD CONSTRAINT "clinic_waqf_deeds_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_waqf_deeds" ADD CONSTRAINT "clinic_waqf_deeds_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_waqf_deeds" ADD CONSTRAINT "clinic_waqf_deeds_approvedActionId_fkey" FOREIGN KEY ("approvedActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_journal_entries" ADD CONSTRAINT "clinic_journal_entries_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_journal_entry_lines" ADD CONSTRAINT "clinic_journal_entry_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "clinic_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_journal_entry_lines" ADD CONSTRAINT "clinic_journal_entry_lines_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "clinic_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Hand-written database rules (2026-11-17, clinic slice 2).

-- The chart of accounts. Each account belongs to one pot for good.
INSERT INTO "clinic_ledger_accounts" ("id", "code", "name", "type", "pot", "isSystemDefault")
VALUES
  (gen_random_uuid()::text, '1000', 'Endowment cash', 'asset', 'endowment', true),
  (gen_random_uuid()::text, '1200', 'Endowment investments', 'asset', 'endowment', true),
  (gen_random_uuid()::text, '1500', 'Premises and equipment', 'asset', 'endowment', true),
  (gen_random_uuid()::text, '3000', 'Endowment capital', 'equity', 'endowment', true),
  (gen_random_uuid()::text, '1100', 'Running fund cash', 'asset', 'running', true),
  (gen_random_uuid()::text, '4000', 'Gifts to the running fund', 'revenue', 'running', true),
  (gen_random_uuid()::text, '4100', 'Endowment income', 'revenue', 'running', true),
  (gen_random_uuid()::text, '5000', 'Subsidised visits', 'expense', 'running', true),
  (gen_random_uuid()::text, '5100', 'Running costs', 'expense', 'running', true);

-- ---- clinic_waqfs

ALTER TABLE "clinic_waqfs"
  ADD CONSTRAINT "clinic_waqfs_jurisdiction_code" CHECK ("jurisdiction" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "clinic_waqfs_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "clinic_waqfs_text_present" CHECK (length(btrim("name")) > 0 AND length(btrim("city")) > 0),
  -- Establishment details exist exactly when it's established.
  ADD CONSTRAINT "clinic_waqfs_establishment_consistent" CHECK (
    ("status" = 'established' AND "establishedAt" IS NOT NULL AND "establishedActionId" IS NOT NULL)
    OR ("status" = 'draft' AND "establishedAt" IS NULL AND "establishedActionId" IS NULL)
  );

-- A clinic waqf only moves from draft to established, its address never
-- changes, and it's never deleted: once established it's a waqf for ever.
CREATE OR REPLACE FUNCTION clinic_waqfs_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic waqf is never deleted';
  END IF;
  IF NEW."slug" IS DISTINCT FROM OLD."slug" THEN
    RAISE EXCEPTION 'A clinic waqf''s address (slug) never changes';
  END IF;
  IF OLD."status" = 'established' AND (
       NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."establishedAt" IS DISTINCT FROM OLD."establishedAt"
       OR NEW."establishedActionId" IS DISTINCT FROM OLD."establishedActionId"
       OR NEW."jurisdiction" IS DISTINCT FROM OLD."jurisdiction") THEN
    RAISE EXCEPTION 'An established clinic waqf can''t be un-established, and its establishment and jurisdiction never change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_waqfs_before_change
  BEFORE UPDATE OR DELETE ON "clinic_waqfs"
  FOR EACH ROW EXECUTE FUNCTION clinic_waqfs_check_change();

-- ---- clinic_waqf_deeds

ALTER TABLE "clinic_waqf_deeds"
  ADD CONSTRAINT "clinic_waqf_deeds_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "clinic_waqf_deeds_text_present" CHECK (length(btrim("text")) > 0),
  -- The hash is always the hash of the text, so an approval naming the hash
  -- names exactly this wording.
  ADD CONSTRAINT "clinic_waqf_deeds_hash_matches" CHECK ("textHash" = encode(sha256(convert_to("text", 'UTF8')), 'hex')),
  ADD CONSTRAINT "clinic_waqf_deeds_approval_consistent" CHECK (
    ("status" IN ('approved', 'superseded') AND "approvedAt" IS NOT NULL AND "approvedActionId" IS NOT NULL)
    OR ("status" IN ('draft', 'discarded') AND "approvedAt" IS NULL AND "approvedActionId" IS NULL)
  );

-- At most one approved version, and one open draft, per clinic.
CREATE UNIQUE INDEX "clinic_waqf_deeds_one_approved" ON "clinic_waqf_deeds" ("clinicWaqfId") WHERE "status" = 'approved';
CREATE UNIQUE INDEX "clinic_waqf_deeds_one_draft" ON "clinic_waqf_deeds" ("clinicWaqfId") WHERE "status" = 'draft';

-- A version's wording never changes; a change is a new version. Status
-- moves only draft -> approved | discarded, and approved -> superseded.
CREATE OR REPLACE FUNCTION clinic_waqf_deeds_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic waqf deed version is never deleted';
  END IF;
  IF NEW."text" IS DISTINCT FROM OLD."text"
     OR NEW."textHash" IS DISTINCT FROM OLD."textHash"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'A deed version''s wording never changes; draft a new version instead';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'draft' AND NEW."status" IN ('approved', 'discarded'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'superseded')) THEN
    RAISE EXCEPTION 'A deed version can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."approvedActionId" IS NOT NULL AND (
       NEW."approvedActionId" IS DISTINCT FROM OLD."approvedActionId"
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt") THEN
    RAISE EXCEPTION 'A deed version''s approval never changes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_waqf_deeds_before_change
  BEFORE UPDATE OR DELETE ON "clinic_waqf_deeds"
  FOR EACH ROW EXECUTE FUNCTION clinic_waqf_deeds_check_change();

-- ---- The ledger

ALTER TABLE "clinic_journal_entry_lines"
  ADD CONSTRAINT "clinic_journal_entry_lines_debit_xor_credit"
  CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0));

-- Append-only: a mistake is corrected with a new, offsetting entry.
CREATE OR REPLACE FUNCTION clinic_journal_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The clinic ledger is append-only — post an offsetting entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_journal_entries_append_only
  BEFORE UPDATE OR DELETE ON "clinic_journal_entries"
  FOR EACH ROW EXECUTE FUNCTION clinic_journal_append_only();

CREATE TRIGGER clinic_journal_entry_lines_append_only
  BEFORE UPDATE OR DELETE ON "clinic_journal_entry_lines"
  FOR EACH ROW EXECUTE FUNCTION clinic_journal_append_only();

-- An account's code, type and pot never change, and accounts aren't deleted.
CREATE OR REPLACE FUNCTION clinic_ledger_accounts_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Clinic ledger accounts are never deleted';
  END IF;
  IF NEW."code" IS DISTINCT FROM OLD."code" OR NEW."type" IS DISTINCT FROM OLD."type" OR NEW."pot" IS DISTINCT FROM OLD."pot" THEN
    RAISE EXCEPTION 'A clinic ledger account''s code, type and pot never change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_ledger_accounts_before_change
  BEFORE UPDATE OR DELETE ON "clinic_ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION clinic_ledger_accounts_check_change();

-- The pots never mix: at commit, every journal entry has at least two lines
-- and balances within each pot on its own. An entry moving money from the
-- endowment to the running fund balances overall but not per pot, so it's
-- refused.
CREATE OR REPLACE FUNCTION clinic_journal_check_balanced() RETURNS trigger AS $$
DECLARE
  entry_id TEXT;
  unbalanced TEXT;
  line_count INT;
BEGIN
  IF TG_TABLE_NAME = 'clinic_journal_entries' THEN
    entry_id := NEW."id";
  ELSE
    entry_id := NEW."journalEntryId";
  END IF;
  SELECT count(*) INTO line_count FROM "clinic_journal_entry_lines" WHERE "journalEntryId" = entry_id;
  IF line_count < 2 THEN
    RAISE EXCEPTION 'Clinic journal entry % needs at least a debit and a credit', entry_id;
  END IF;
  SELECT a."pot"::text INTO unbalanced
    FROM "clinic_journal_entry_lines" l
    JOIN "clinic_ledger_accounts" a ON a."id" = l."ledgerAccountId"
    WHERE l."journalEntryId" = entry_id
    GROUP BY a."pot"
    HAVING sum(l."debit") <> sum(l."credit")
    LIMIT 1;
  IF unbalanced IS NOT NULL THEN
    RAISE EXCEPTION 'Clinic journal entry % doesn''t balance within the % pot; the endowment and the running fund never mix', entry_id, unbalanced;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER clinic_journal_entries_balanced
  AFTER INSERT ON "clinic_journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinic_journal_check_balanced();

CREATE CONSTRAINT TRIGGER clinic_journal_entry_lines_balanced
  AFTER INSERT ON "clinic_journal_entry_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinic_journal_check_balanced();
