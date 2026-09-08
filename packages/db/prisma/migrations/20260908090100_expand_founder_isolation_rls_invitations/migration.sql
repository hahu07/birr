-- 2026-09-08 audit fix — invitations was the one founder-reachable table
-- left out of 20260830152938_expand_founder_isolation_rls, with no comment
-- there marking the exclusion as deliberate (unlike governed_actions/
-- waqf_case_assignments/conflict_of_interest_declarations/
-- cause_category_suggestions, which are explicitly and correctly excluded
-- in that migration's own comment as Birr-staff-internal, founder-
-- unreachable tables).
--
-- Two ways an invitation is scoped to a founder (see
-- InvitationsService.invite's own validation): founder_user invites set
-- founderId directly (an existing Founder's teammate invite); co_founder
-- invites set foundationId instead (no existing Founder to point at yet).
-- birr_staff invites set neither, so this policy correctly grants a
-- founder session access to neither branch for those rows.
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "invitations"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "founderId" = current_setting('app.current_founder_id', true)
    OR "foundationId" IN (
      SELECT "foundationId" FROM "foundation_founders"
      WHERE "founderId" = current_setting('app.current_founder_id', true)
    )
  );
