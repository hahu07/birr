-- Birr — constraints that schema.prisma cannot express.
-- Folded in from prisma/migrations/manual/001_governed_actions_constraints.sql
-- per that file's own instructions. See CLAUDE.md non-negotiables: the
-- maker/checker rule and the immutable audit log are DB-enforced, not just
-- application-layer conventions.

-- A human maker can never also be the checker on the same action.
-- Column names are camelCase, matching what Prisma actually generated
-- (schema.prisma has no per-field @map, only @@map at the model level —
-- the original manual SQL assumed snake_case columns that don't exist).
ALTER TABLE "governed_actions"
  ADD CONSTRAINT "checker_not_maker"
  CHECK ("checkerUserId" IS NULL OR "makerUserId" IS NULL OR "checkerUserId" <> "makerUserId");

-- Exactly one maker identity is set, matching the declared makerType.
-- (There is no equivalent "checkerAgentId" column anywhere — that
-- absence, not a constraint, is what keeps agents out of the checker
-- role. Do not add one, and do not add a constraint that assumes one.)
ALTER TABLE "governed_actions"
  ADD CONSTRAINT "maker_identity_matches_type"
  CHECK (
    ("makerType" = 'human' AND "makerUserId" IS NOT NULL AND "makerAgentId" IS NULL)
    OR
    ("makerType" = 'ai_agent' AND "makerAgentId" IS NOT NULL AND "makerUserId" IS NULL)
  );

-- Immutable audit log: no updates, no deletes — insert-only, enforced at
-- the database role level so a bug in application code can't erase
-- history. "birr" is the role the application actually connects as in
-- this environment (see DATABASE_URL in .env); Postgres enforces REVOKE
-- against the owner role for DML privileges, so this has real effect even
-- though "birr" also owns the table. If a separate migration/admin role
-- is introduced later, re-point this REVOKE at the runtime role instead.
REVOKE UPDATE, DELETE ON "audit_logs" FROM "birr";

-- Row-Level Security as a second enforcement layer beneath app-level
-- waqf/founder scoping (defense in depth, per the earlier tenancy
-- discussion). Adapt the policy predicate to however founder identity is
-- passed into the DB session for founder-portal queries — for example,
-- via `SET LOCAL app.current_founder_id = '<uuid>'` at the start of a
-- request-scoped transaction.
ALTER TABLE "waqfs" ENABLE ROW LEVEL SECURITY;

-- Postgres table owners bypass RLS by default, and "birr" (the role the
-- app connects as — see DATABASE_URL) also owns this table, since it ran
-- the migrations. Without FORCE, ENABLE ROW LEVEL SECURITY above would be
-- a silent no-op for every query the app actually makes. Verified
-- empirically before adding this line — do not remove without re-checking
-- that assumption if the connecting role ever changes.
ALTER TABLE "waqfs" FORCE ROW LEVEL SECURITY;

-- Example shape only — verify current_setting() usage and the
-- founder-identity-propagation mechanism before relying on this in
-- production:
-- CREATE POLICY founder_isolation ON "waqfs"
--   USING (
--     id IN (
--       SELECT waqf_id FROM waqf_founders
--       WHERE founder_id = current_setting('app.current_founder_id', true)::uuid
--     )
--   );
