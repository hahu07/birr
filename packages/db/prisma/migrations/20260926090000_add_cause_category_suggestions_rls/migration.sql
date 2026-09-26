-- 2026-09-26 audit fix (see docs/comprehensive-code-review-prompt.md and the
-- Birr Codebase Audit report). The 20260830152938_expand_founder_isolation_rls
-- migration deliberately skipped cause_category_suggestions, but only
-- justified that against waqfId ("context only, not a scope restriction" —
-- see that model's own schema comment, still true). It never addressed
-- proposedByFounderId, which is the column CauseCategorySuggestionsService
-- .listForFounder() actually scopes the Founder-Portal read by — leaving
-- this table with a single enforcement layer (the app-layer WHERE alone),
-- unlike every structural peer added in that same sweep.
--
-- Same founder_isolation shape as every other table in that sweep, and the
-- same "restrict by direct founder column" pattern already established for
-- "foundations" in 20260802211506 — unrestricted when no founder session is
-- active (Birr staff reviewing all suggestions in the Ops Console still see
-- everything), restricted to the acting founder's own proposals otherwise.
-- No separate WITH CHECK is needed: CauseCategorySuggestionsService.propose()
-- inserts with proposedByFounderId already equal to the founder making the
-- request, and the same USING expression governs INSERT by default when no
-- WITH CHECK is specified.

ALTER TABLE "cause_category_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cause_category_suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "cause_category_suggestions"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "proposedByFounderId" = current_setting('app.current_founder_id', true)
  );
