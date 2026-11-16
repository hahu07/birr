-- co_founder_deed_consents holds co-founders' names, the statements they
-- accepted and their IP addresses, and is read under a founder session.
-- Same founder isolation as its sibling foundation_deeds
-- (20260830152938_expand_founder_isolation_rls): a founder sees only the
-- consents of Foundations they belong to; no founder set means unrestricted
-- (staff and system paths).
ALTER TABLE "co_founder_deed_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "co_founder_deed_consents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "co_founder_deed_consents"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "foundationId" IN (
      SELECT "foundationId" FROM "foundation_founders"
      WHERE "founderId" = current_setting('app.current_founder_id', true)
    )
  );
