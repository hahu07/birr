-- Correction to 20260909053819_add_audit_log_hash_chain: "sequence" was
-- created as BIGINT. That breaks JSON.stringify on any endpoint that
-- returns a raw AuditLog row as a plain scalar field — confirmed
-- against two existing endpoints that already do exactly that
-- (AiAgentsService.drafts(), ComplianceReportsService's compliance
-- report export), not just the new audit-logs export/verify routes.
-- INTEGER (max ~2.1 billion) is nowhere near a real ceiling for this
-- table and serializes as a normal JS number, so switch to it instead
-- of pushing a BigInt-to-string conversion onto every consumer.
ALTER TABLE "audit_logs" ALTER COLUMN "sequence" TYPE INTEGER;
ALTER SEQUENCE "audit_logs_sequence_seq" AS integer;

-- Postgres won't let CREATE OR REPLACE change a function's declared
-- return row type (OUT parameter types) — has to be dropped first.
DROP FUNCTION audit_logs_verify_chain();

CREATE OR REPLACE FUNCTION audit_logs_verify_chain()
RETURNS TABLE(sequence INTEGER, id TEXT, issue TEXT) AS $$
  SELECT t."sequence", t."id",
    CASE
      WHEN t."previousHash" IS DISTINCT FROM t.lag_hash
        THEN 'chain link broken: previousHash does not match the prior record''s recordHash'
      ELSE 'record hash does not match this row''s current contents'
    END AS issue
  FROM (
    SELECT *, LAG("recordHash") OVER (ORDER BY "sequence") AS lag_hash
    FROM "audit_logs"
  ) t
  WHERE t."previousHash" IS DISTINCT FROM t.lag_hash
     OR t."recordHash" IS DISTINCT FROM audit_log_row_hash(
          t."previousHash", t."id", t."actorType"::text, t."actorUserId", t."actorAgentId",
          t."actorFounderId", t."action", t."entityType", t."entityId",
          t."before"::text, t."after"::text, t."createdAt"::text
        )
$$ LANGUAGE sql STABLE;
