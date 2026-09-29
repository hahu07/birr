-- One journal entry per (source, sourceId): a payment/payout provider
-- retrying the same webhook concurrently must not post the same money
-- twice. NULL sourceIds (manual adjustments) never collide. Mirrors
-- vault_journal_entries' own 20260929120000_vault_money_integrity fix.
DROP INDEX "waqf_journal_entries_source_sourceId_idx";
CREATE UNIQUE INDEX "waqf_journal_entries_source_sourceId_key" ON "waqf_journal_entries"("source", "sourceId");
