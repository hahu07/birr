-- Refund reversals get their own ledger source, so a contribution's
-- confirmation entry and its refund reversal never collide on the
-- (source, sourceId) uniqueness below.
ALTER TYPE "VaultJournalEntrySource" ADD VALUE 'contribution_refund';

-- One journal entry per (source, sourceId): a payment provider retrying
-- the same webhook concurrently must not post the same money twice.
-- NULL sourceIds (manual adjustments) never collide.
DROP INDEX "vault_journal_entries_source_sourceId_idx";
CREATE UNIQUE INDEX "vault_journal_entries_source_sourceId_key" ON "vault_journal_entries"("source", "sourceId");

-- Money moving in or out is always strictly positive. Enforced here as
-- well as in the DTOs because a negative pending distribution lowers a
-- cause's committed total and so silently raises the headroom every later
-- distribution is checked against — defeating the governed allocation
-- ceiling. Proceeds are deliberately excluded: a correction there is a
-- legitimately negative entry.
ALTER TABLE "vault_distributions" ADD CONSTRAINT "vault_distributions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "vault_contributions" ADD CONSTRAINT "vault_contributions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "vault_investments" ADD CONSTRAINT "vault_investments_allocated_amount_positive" CHECK ("allocatedAmount" > 0);
ALTER TABLE "investments" ADD CONSTRAINT "investments_allocated_amount_positive" CHECK ("allocatedAmount" > 0);
ALTER TABLE "vault_expenses" ADD CONSTRAINT "vault_expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "waqf_expenses" ADD CONSTRAINT "waqf_expenses_amount_positive" CHECK ("amount" > 0);
