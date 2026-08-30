-- 2026-08-30 security audit fix (see docs/comprehensive-code-review-prompt.md).
-- Founder/waqf isolation's DB-level RLS layer (CLAUDE.md: "Row-Level
-- Security scoping by waqf/founder as a second enforcement layer beneath
-- the app") existed only on "waqfs" and "foundations" — every other
-- founder-reachable table relied entirely on the app-layer WHERE clause
-- inside withFounderScope()'s callers. That's a real gap, not a
-- theoretical one: a bug in any one of those app-layer WHERE clauses
-- would have had nothing underneath it to catch a wrong-founder row leak.
--
-- All new policies follow the exact founder_isolation shape already
-- established for "waqfs"/"foundations" — NULLIF(..., '') IS NULL as the
-- unrestricted-when-no-founder-session escape hatch (same empty-string
-- GUC gotcha fixed in 20260801013415_fix_founder_isolation_empty_string_gotcha),
-- reading app.current_founder_id via current_setting(), and ENABLE +
-- FORCE together since the app connects as the owning "birr" role (see
-- governed_actions_constraints's own comment on why FORCE is required).
--
-- Deliberately NOT applied to governed_actions, waqf_case_assignments, or
-- conflict_of_interest_declarations — those are Birr-staff-internal
-- governance machinery a Founder never reaches at all (CLAUDE.md:
-- "Founders never operate that governance machinery themselves"), nor to
-- cause_category_suggestions, whose waqfId is context only, not a scope
-- restriction (see that model's own schema comment).

-- Direct waqfId column: assets, beneficiaries, investments, distributions,
-- waqf_causes, contributions, waqf_proceeds, waqf_deeds,
-- beneficiary_nominations.

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "assets"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "beneficiaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiaries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "beneficiaries"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "investments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "investments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "investments"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "distributions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distributions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "distributions"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "waqf_causes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waqf_causes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "waqf_causes"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "contributions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contributions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "contributions"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "waqf_proceeds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waqf_proceeds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "waqf_proceeds"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "waqf_deeds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waqf_deeds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "waqf_deeds"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "beneficiary_nominations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiary_nominations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "beneficiary_nominations"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

-- Direct foundationId column: messages, foundation_deeds.

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "messages"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "foundationId" IN (
      SELECT "foundationId" FROM "foundation_founders"
      WHERE "founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "foundation_deeds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundation_deeds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "foundation_deeds"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "foundationId" IN (
      SELECT "foundationId" FROM "foundation_founders"
      WHERE "founderId" = current_setting('app.current_founder_id', true)
    )
  );

-- Two-hop tables: cause_impact_updates (via waqf_causes.waqfId),
-- message_attachments (via messages.foundationId). Not in the reviewing
-- agent's original list but the identical gap one join further out —
-- message_attachments carries the actual file content, at least as
-- sensitive as the message row that references it.

ALTER TABLE "cause_impact_updates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cause_impact_updates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "cause_impact_updates"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfCauseId" IN (
      SELECT wc."id" FROM "waqf_causes" wc
      JOIN "waqfs" w ON w."id" = wc."waqfId"
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );

ALTER TABLE "message_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "message_attachments"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "messageId" IN (
      SELECT m."id" FROM "messages" m
      JOIN "foundation_founders" ff ON ff."foundationId" = m."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );
