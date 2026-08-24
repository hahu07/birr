-- The prior migration (governed_actions_constraints) enabled and forced RLS
-- on "waqfs" but left the actual policy commented out as an example — with
-- zero policies, FORCE ROW LEVEL SECURITY denies every row to everyone,
-- including the table owner, with no distinction between a Founder Portal
-- session and Birr's own Ops Console/backend. That's a landmine, not a
-- control: the first code to touch "waqfs" gets an unexplained permission
-- denied, and the easy "fix" is to strip RLS out entirely.
--
-- Per CLAUDE.md, this table's RLS concern is specifically Founder/waqf
-- isolation ("a Founder sees only the waqf(s) they established, nothing
-- about any other Founder") — not Birr-staff isolation. Birr staff access
-- is governed by the roles/permissions/role_permissions RBAC layer and
-- waqf_case_assignments (caseload), not by row filtering here. So this
-- policy only needs to restrict connections that have identified
-- themselves as a specific Founder; any other connection (Birr's backend,
-- acting on behalf of its own staff) passes through unfiltered.
--
-- The founder-identity-propagation mechanism itself (how apps/backend sets
-- this per request) is still Milestone 2+ work — see the app.current_founder_id
-- convention sketched in the original comment this replaces. Until that
-- wiring exists, no session ever sets the GUC, so the first branch below is
-- always true and access is unrestricted — i.e. this migration does not
-- change current (no-app-yet) behavior, it only removes the permanent
-- deny-all and puts the real, intended restriction in place for the moment
-- the founder portal starts setting it.
CREATE POLICY "founder_isolation" ON "waqfs"
  USING (
    current_setting('app.current_founder_id', true) IS NULL
    OR "id" IN (
      SELECT "waqfId" FROM "waqf_founders"
      WHERE "founderId" = current_setting('app.current_founder_id', true)
    )
  );
