-- Tamper-evident audit log: a strict insertion-order sequence plus a
-- sha256 hash chain (each row's hash covers its own fields + the
-- previous row's hash), so altering or removing any historical row is
-- detectable by anyone who can query this table, not just anyone who
-- trusts the REVOKE UPDATE/DELETE grant from
-- 20260731201431_governed_actions_constraints. Postgres 16 (this repo's
-- version — see docker-compose.yml) has sha256() built in since v14, so
-- no pgcrypto extension is needed.
--
-- Caveat, deliberately not solved here: this detects tampering by
-- anything going through the app's own write path or the lower-privilege
-- birr_app role. It cannot detect a Postgres superuser rewriting the
-- whole chain consistently — no application-layer control can. Same
-- caveat the birr-vs-birr_app role-topology comments elsewhere in this
-- schema already carry.

-- 1. New columns. sequence/previousHash/recordHash are never set by
-- application code (Prisma) — the trigger below fills them in
-- unconditionally on every insert. Added nullable first so existing rows
-- can be backfilled before the NOT NULL/default/unique constraints go on.
ALTER TABLE "audit_logs" ADD COLUMN "sequence" BIGINT;
ALTER TABLE "audit_logs" ADD COLUMN "previousHash" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "recordHash" TEXT;

-- 2. Backfill sequence for existing rows in true chronological order.
-- createdAt alone isn't a safe total order (same-millisecond ties are
-- exactly why the audit log viewer's cursor pagination uses id as a
-- tiebreaker already) — id breaks ties here the same way.
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn
  FROM "audit_logs"
)
UPDATE "audit_logs" a SET "sequence" = ordered.rn
FROM ordered WHERE a."id" = ordered."id";

-- 3. Sequence becomes the real auto-incrementing column for all future
-- inserts, continuing from the backfilled max.
CREATE SEQUENCE IF NOT EXISTS "audit_logs_sequence_seq" OWNED BY "audit_logs"."sequence";
SELECT setval('"audit_logs_sequence_seq"', COALESCE((SELECT MAX("sequence") FROM "audit_logs"), 0) + 1, false);
ALTER TABLE "audit_logs" ALTER COLUMN "sequence" SET DEFAULT nextval('"audit_logs_sequence_seq"');
ALTER TABLE "audit_logs" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_sequence_key" UNIQUE ("sequence");

-- 4. The hash formula — a single source of truth called by both the
-- insert trigger and the verify function below, so the two can never
-- silently drift apart.
CREATE OR REPLACE FUNCTION audit_log_row_hash(
  p_previous_hash TEXT,
  p_id TEXT,
  p_actor_type TEXT,
  p_actor_user_id TEXT,
  p_actor_agent_id TEXT,
  p_actor_founder_id TEXT,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_before TEXT,
  p_after TEXT,
  p_created_at TEXT
) RETURNS TEXT AS $$
  SELECT encode(
    sha256(
      convert_to(
        COALESCE(p_previous_hash, '') || '|' ||
        p_id || '|' ||
        p_actor_type || '|' ||
        COALESCE(p_actor_user_id, '') || '|' ||
        COALESCE(p_actor_agent_id, '') || '|' ||
        COALESCE(p_actor_founder_id, '') || '|' ||
        p_action || '|' ||
        p_entity_type || '|' ||
        p_entity_id || '|' ||
        COALESCE(p_before, '') || '|' ||
        COALESCE(p_after, '') || '|' ||
        p_created_at,
        'UTF8'
      )
    ),
    'hex'
  );
$$ LANGUAGE sql IMMUTABLE;

-- 5. Backfill the chain itself for existing rows, walking sequence order
-- via a recursive CTE (each row's hash needs the previous row's freshly
-- computed hash, not just its stored value — there isn't one yet).
WITH RECURSIVE chain AS (
  (
    SELECT "id", "sequence", NULL::TEXT AS previous_hash,
      audit_log_row_hash(
        NULL, "id", "actorType"::text, "actorUserId", "actorAgentId", "actorFounderId",
        "action", "entityType", "entityId", "before"::text, "after"::text, "createdAt"::text
      ) AS record_hash
    FROM "audit_logs"
    ORDER BY "sequence"
    LIMIT 1
  )
  UNION ALL
  SELECT a."id", a."sequence", chain.record_hash AS previous_hash,
    audit_log_row_hash(
      chain.record_hash, a."id", a."actorType"::text, a."actorUserId", a."actorAgentId", a."actorFounderId",
      a."action", a."entityType", a."entityId", a."before"::text, a."after"::text, a."createdAt"::text
    ) AS record_hash
  FROM "audit_logs" a
  JOIN chain ON a."sequence" = chain."sequence" + 1
)
UPDATE "audit_logs" SET "previousHash" = chain.previous_hash, "recordHash" = chain.record_hash
FROM chain WHERE "audit_logs"."id" = chain."id";

-- 6. Going forward: every insert gets chained automatically. Serialized
-- with an advisory lock so two concurrent audit-log writes can't both
-- read the same "previous" row and fork the chain.
CREATE OR REPLACE FUNCTION audit_logs_chain_hash() RETURNS TRIGGER AS $$
DECLARE
  prev_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs_hash_chain'));

  SELECT "recordHash" INTO prev_hash FROM "audit_logs" ORDER BY "sequence" DESC LIMIT 1;

  NEW."previousHash" := prev_hash;
  NEW."recordHash" := audit_log_row_hash(
    prev_hash,
    NEW."id",
    NEW."actorType"::text,
    NEW."actorUserId",
    NEW."actorAgentId",
    NEW."actorFounderId",
    NEW."action",
    NEW."entityType",
    NEW."entityId",
    NEW."before"::text,
    NEW."after"::text,
    NEW."createdAt"::text
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_chain_hash_trigger
  BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_chain_hash();

-- 7. Self-service verification: an Audit Committee member or External
-- Auditor can recompute the whole chain at any time rather than having
-- to trust the REVOKE grant. Set-based (a window LAG, not a loop) so it
-- reuses the exact same hash formula as the trigger above. Empty result
-- means the chain is intact end to end.
CREATE OR REPLACE FUNCTION audit_logs_verify_chain()
RETURNS TABLE(sequence BIGINT, id TEXT, issue TEXT) AS $$
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
