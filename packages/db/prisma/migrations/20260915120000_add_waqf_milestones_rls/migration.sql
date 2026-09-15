-- 2026-09-15 — waqf_milestones is now Founder-reachable (the Founder
-- Portal's own read-only "Project progress" section, GET
-- /waqf-milestones?waqfId=), so it needs the same DB-level RLS layer
-- every other founder-reachable table with a direct waqfId column
-- already has (see 20260830152938_expand_founder_isolation_rls's own
-- comment on why this is a real second layer, not a formality) — this
-- table simply didn't exist yet when that migration ran. Same shape as
-- "assets" there, exactly. waqf_ledger_accounts/waqf_expenses/
-- waqf_journal_entries stay untouched — none of them are ever read by
-- a Founder session (staff-only internal accounting), matching the
-- prior migration's own precedent for what's deliberately excluded.

ALTER TABLE "waqf_milestones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waqf_milestones" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "waqf_milestones"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );
