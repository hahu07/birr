-- Fixes a real bug in founder_isolation (see
-- 20260731202928_waqf_founder_isolation_policy): current_setting(name,
-- missing_ok) only returns NULL for a custom GUC that has *never* been
-- referenced on the current connection. Once anything calls
-- set_config('app.current_founder_id', ..., true) — even scoped
-- is_local = true, reverting at transaction end — Postgres creates a
-- session-level placeholder for it, and current_setting() afterward
-- returns '' (empty string), not NULL, for the rest of that connection's
-- life. The old policy only checked IS NULL.
--
-- With real connection pooling this is a serious bug, not a cosmetic
-- one: after the *first* founder-scoped request ever touches a pooled
-- connection, every later request reusing that connection — including
-- Birr's own unscoped Ops Console queries — would permanently lose
-- access to every waqf, since neither branch of the old predicate would
-- ever be true again on that connection. Caught by the automated RLS
-- test added in the waqf_founders slice; the original manual psql check
-- used a fresh session that had never touched the GUC, so it never hit
-- this path.
DROP POLICY "founder_isolation" ON "waqfs";

CREATE POLICY "founder_isolation" ON "waqfs"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "id" IN (
      SELECT "waqfId" FROM "waqf_founders"
      WHERE "founderId" = current_setting('app.current_founder_id', true)
    )
  );
