-- Founder -> Foundation -> Waqf Fund -> Cause restructuring, step D
-- (contract, part 2). Every Waqf now has a foundationId (enforced NOT
-- NULL by the previous migration), so a Waqf's founder relationship is
-- fully derivable via foundationId -> foundation_founders -> founderId.
-- waqf_founders is now redundant and would only risk drifting out of
-- sync with foundationId if kept around.
--
-- Order matters: the old founder_isolation policy's subquery still
-- references waqf_founders, so the policy must be dropped BEFORE the
-- table — dropping the table first would break every founder-scoped
-- query in between.
DROP POLICY "founder_isolation" ON "waqfs";
DROP TABLE "waqf_founders";

-- Same empty-string GUC gotcha fix as before
-- (20260801013415_fix_founder_isolation_empty_string_gotcha) — only the
-- join target changes, from waqf_founders to
-- waqfs.foundationId -> foundation_founders.
CREATE POLICY "founder_isolation" ON "waqfs"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "foundationId" IN (
      SELECT "foundationId" FROM "foundation_founders"
      WHERE "founderId" = current_setting('app.current_founder_id', true)
    )
  );

-- Same defense-in-depth principle CLAUDE.md states generally for RLS
-- ("scoping by waqf/founder as a second enforcement layer beneath the
-- app"), applied here for the same reason it was applied to waqfs —
-- Foundation is now a founder-scoped entity in its own right.
ALTER TABLE "foundations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "foundations"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "id" IN (
      SELECT "foundationId" FROM "foundation_founders"
      WHERE "founderId" = current_setting('app.current_founder_id', true)
    )
  );
