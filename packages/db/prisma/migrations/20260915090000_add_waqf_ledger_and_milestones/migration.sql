-- AlterTable
ALTER TABLE "distributions" ADD COLUMN     "waqfMilestoneId" TEXT;

-- CreateTable
CREATE TABLE "waqf_ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "waqf_ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waqf_journal_entries" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "source" "VaultJournalEntrySource" NOT NULL,
    "sourceId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waqf_journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waqf_journal_entry_lines" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "waqf_journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waqf_expenses" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "waqfMilestoneId" TEXT,
    "ledgerAccountId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waqf_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waqf_milestones" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sequence" INTEGER NOT NULL,
    "targetAmount" DECIMAL(65,30),
    "status" "VaultMilestoneStatus" NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "evidenceNotes" TEXT,
    "evidenceFileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "waqf_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waqf_ledger_accounts_code_key" ON "waqf_ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "waqf_journal_entries_waqfId_idx" ON "waqf_journal_entries"("waqfId");

-- CreateIndex
CREATE INDEX "waqf_journal_entries_source_sourceId_idx" ON "waqf_journal_entries"("source", "sourceId");

-- CreateIndex
CREATE INDEX "waqf_journal_entry_lines_journalEntryId_idx" ON "waqf_journal_entry_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "waqf_journal_entry_lines_ledgerAccountId_idx" ON "waqf_journal_entry_lines"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "waqf_expenses_waqfId_idx" ON "waqf_expenses"("waqfId");

-- CreateIndex
CREATE INDEX "waqf_expenses_waqfMilestoneId_idx" ON "waqf_expenses"("waqfMilestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "waqf_milestones_waqfId_sequence_key" ON "waqf_milestones"("waqfId", "sequence");

-- CreateIndex
CREATE INDEX "distributions_waqfMilestoneId_idx" ON "distributions"("waqfMilestoneId");

-- AddForeignKey
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_waqfMilestoneId_fkey" FOREIGN KEY ("waqfMilestoneId") REFERENCES "waqf_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_journal_entries" ADD CONSTRAINT "waqf_journal_entries_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_journal_entry_lines" ADD CONSTRAINT "waqf_journal_entry_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "waqf_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_journal_entry_lines" ADD CONSTRAINT "waqf_journal_entry_lines_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "waqf_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_expenses" ADD CONSTRAINT "waqf_expenses_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_expenses" ADD CONSTRAINT "waqf_expenses_waqfMilestoneId_fkey" FOREIGN KEY ("waqfMilestoneId") REFERENCES "waqf_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_expenses" ADD CONSTRAINT "waqf_expenses_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "waqf_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_expenses" ADD CONSTRAINT "waqf_expenses_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_milestones" ADD CONSTRAINT "waqf_milestones_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A journal-entry line is exactly one of a debit or a credit, never
-- both, never neither — same debit_xor_credit shape as
-- vault_journal_entry_lines (see that migration's own comment on why
-- the sum(debit) == sum(credit)-across-a-whole-entry invariant can't
-- also be a single-row CHECK; WaqfLedgerService.post() enforces that
-- one inside the same transaction as the insert instead).
ALTER TABLE "waqf_journal_entry_lines"
  ADD CONSTRAINT "waqf_debit_xor_credit"
  CHECK (
    ("debit" = 0 AND "credit" > 0)
    OR
    ("debit" > 0 AND "credit" = 0)
  );
