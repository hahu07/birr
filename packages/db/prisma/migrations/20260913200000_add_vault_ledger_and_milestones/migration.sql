-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

-- CreateEnum
CREATE TYPE "VaultJournalEntrySource" AS ENUM ('contribution', 'distribution', 'expense', 'manual_adjustment');

-- CreateEnum
CREATE TYPE "VaultMilestoneStatus" AS ENUM ('pending', 'in_progress', 'completed');

-- AlterTable
ALTER TABLE "vault_distributions" ADD COLUMN     "vaultMilestoneId" TEXT;

-- CreateTable
CREATE TABLE "vault_ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vault_ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_journal_entries" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "source" "VaultJournalEntrySource" NOT NULL,
    "sourceId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_journal_entry_lines" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "vault_journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_expenses" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "vaultMilestoneId" TEXT,
    "ledgerAccountId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_milestones" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sequence" INTEGER NOT NULL,
    "targetAmount" DECIMAL(65,30),
    "status" "VaultMilestoneStatus" NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "evidenceNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vault_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_ledger_accounts_code_key" ON "vault_ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "vault_journal_entries_vaultId_idx" ON "vault_journal_entries"("vaultId");

-- CreateIndex
CREATE INDEX "vault_journal_entries_source_sourceId_idx" ON "vault_journal_entries"("source", "sourceId");

-- CreateIndex
CREATE INDEX "vault_journal_entry_lines_journalEntryId_idx" ON "vault_journal_entry_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "vault_journal_entry_lines_ledgerAccountId_idx" ON "vault_journal_entry_lines"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "vault_expenses_vaultId_idx" ON "vault_expenses"("vaultId");

-- CreateIndex
CREATE INDEX "vault_expenses_vaultMilestoneId_idx" ON "vault_expenses"("vaultMilestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_milestones_vaultId_sequence_key" ON "vault_milestones"("vaultId", "sequence");

-- CreateIndex
CREATE INDEX "vault_distributions_vaultMilestoneId_idx" ON "vault_distributions"("vaultMilestoneId");

-- AddForeignKey
ALTER TABLE "vault_distributions" ADD CONSTRAINT "vault_distributions_vaultMilestoneId_fkey" FOREIGN KEY ("vaultMilestoneId") REFERENCES "vault_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_journal_entries" ADD CONSTRAINT "vault_journal_entries_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_journal_entry_lines" ADD CONSTRAINT "vault_journal_entry_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "vault_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_journal_entry_lines" ADD CONSTRAINT "vault_journal_entry_lines_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "vault_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_expenses" ADD CONSTRAINT "vault_expenses_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_expenses" ADD CONSTRAINT "vault_expenses_vaultMilestoneId_fkey" FOREIGN KEY ("vaultMilestoneId") REFERENCES "vault_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_expenses" ADD CONSTRAINT "vault_expenses_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "vault_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_expenses" ADD CONSTRAINT "vault_expenses_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_milestones" ADD CONSTRAINT "vault_milestones_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A journal-entry line is exactly one of a debit or a credit, never
-- both, never neither — schema.prisma can express two Decimal columns
-- but not this exclusivity, same reasoning as governed_actions'
-- checker_not_maker constraint above in this migration history. The
-- separate, harder invariant (sum(debit) == sum(credit) across every
-- line of one journal entry) can't be expressed as a single-row CHECK
-- at all — VaultLedgerService.post() enforces that one inside the same
-- transaction as the insert instead (see that method's own comment).
ALTER TABLE "vault_journal_entry_lines"
  ADD CONSTRAINT "debit_xor_credit"
  CHECK (
    ("debit" = 0 AND "credit" > 0)
    OR
    ("debit" > 0 AND "credit" = 0)
  );
