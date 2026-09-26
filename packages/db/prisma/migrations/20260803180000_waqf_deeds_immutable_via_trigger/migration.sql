-- Correction to the previous migration's REVOKE UPDATE, DELETE ON
-- "waqf_deeds" FROM "birr". That approach mirrors audit_logs' own
-- immutability enforcement, but audit_logs has no incoming foreign key
-- from any other table — waqf_deeds does (waqfs -> waqf_deeds via
-- waqfId, ON DELETE RESTRICT). Postgres enforces an incoming RESTRICT FK
-- internally with `SELECT ... FOR KEY SHARE` against the referencing
-- table, and that locking SELECT itself requires UPDATE privilege on the
-- role — so revoking UPDATE broke Postgres's ability to check the FK at
-- all, turning every attempt to delete a Waqf (regardless of whether it
-- has a deed) into a hard permission error instead of a normal RESTRICT
-- check. Confirmed directly against the dev DB.
--
-- Fix: grant UPDATE/DELETE back (restoring the FK-check machinery), and
-- enforce immutability instead via a trigger that unconditionally
-- rejects UPDATE/DELETE on this table. Still DB-level enforcement, not
-- just application code — a bug in a service can't bypass it — it just
-- doesn't share the REVOKE approach's incompatibility with an incoming
-- FK from a table (Waqf) that legitimately gets deleted in other
-- contexts (e.g. test fixture cleanup; Waqf itself should never be
-- hard-deleted in real product code per CLAUDE.md's soft-delete rule,
-- but nothing stops a *different* table's hard-delete from needing to
-- check this FK).
--
-- 2026-09-26: guarded the same way as the REVOKE this restores — see
-- 20260731201431_governed_actions_constraints's own comment. On an
-- environment with no role literally named "birr" (found deploying to
-- Render), the prior migration's REVOKE never ran either (same guard),
-- so there's nothing to restore here — GRANT ... TO a nonexistent role
-- would itself error the same way REVOKE ... FROM one does.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'birr') THEN
    GRANT UPDATE, DELETE ON "waqf_deeds" TO "birr";
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION waqf_deeds_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'waqf_deeds is immutable once written — % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER waqf_deeds_no_update
  BEFORE UPDATE ON "waqf_deeds"
  FOR EACH ROW EXECUTE FUNCTION waqf_deeds_reject_mutation();

CREATE TRIGGER waqf_deeds_no_delete
  BEFORE DELETE ON "waqf_deeds"
  FOR EACH ROW EXECUTE FUNCTION waqf_deeds_reject_mutation();
