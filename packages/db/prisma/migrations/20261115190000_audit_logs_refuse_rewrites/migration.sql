-- The audit log must never change once written (CLAUDE.md, non-negotiables).
-- Until now that rested on revoking UPDATE/DELETE from the app roles, but
-- the four "who did it" foreign keys were ON DELETE SET NULL: deleting a
-- user, founder, AI agent or Vault donor rewrote every audit row naming
-- them, with the table owner's rights, so the revoked grants never applied.
-- Each rewritten row then failed the hash chain (audit_logs_verify_chain);
-- 5,941 had in the dev database by 2026-11-15, all from test cleanup. No
-- application code deletes these people. Owner's decision, 2026-11-15:
-- refuse such a delete instead, and refuse any change to an audit row at
-- all, whoever attempts it.

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorUserId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorAgentId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorAgentId_fkey" FOREIGN KEY ("actorAgentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorFounderId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorFounderId_fkey" FOREIGN KEY ("actorFounderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorDonorId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorDonorId_fkey" FOREIGN KEY ("actorDonorId") REFERENCES "vault_donors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Belt and braces, as for the other immutable tables (foundation_deeds,
-- co_founder_deed_consents): the database itself refuses any change.
-- A future migration that truly must touch audit rows has to drop these
-- triggers explicitly, which a reviewer will see.
CREATE OR REPLACE FUNCTION audit_logs_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();
