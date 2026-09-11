-- Adds Vault-scoping/attribution to audit_logs for the new Vault
-- product (a Birr-staff-curated public-giving product, separate from
-- the Founder/Foundation/Waqf system — see schema.prisma's own
-- top-of-section comment on Vault). Two additions, two very different
-- amounts of care needed:
--
--   1. audit_logs.vaultId — a plain nullable scalar, exactly like the
--      existing waqfId column (no @relation, not part of the hash-chain
--      formula — see audit_log_row_hash() below, which never covered
--      waqfId either). Purely additive, no re-derivation needed.
--
--   2. audit_logs.actorDonorId — an actor-identity FK, the same
--      category as actorUserId/actorAgentId/actorFounderId, all three
--      of which ARE covered by the tamper-evident hash chain (see
--      20260909053819_add_audit_log_hash_chain's own comment on why
--      this exists at all). Leaving a brand-new actor-identity field
--      out of the hash formula would silently reopen exactly the gap
--      that migration was built to close, just for public_donor
--      specifically — so audit_log_row_hash() itself changes shape here,
--      which means every existing row's stored recordHash no longer
--      matches what the (now-changed) formula would produce for it.
--      There is no way around fully recomputing the chain from scratch
--      when the formula itself changes — this is the exact same
--      operation 20260909053819's own step 5 already performed once, for
--      the exact same reason (introducing the mechanism for a table that
--      already had historical rows). Every existing row's actorDonorId
--      is NULL (the column didn't exist before this migration), so this
--      is a legitimate re-anchoring of the chain under the new formula,
--      not a way to hide any actual tampering — audit_logs_verify_chain()
--      below is recomputed against the same new formula, so it stays a
--      true self-check either way.

-- 1. New columns.
ALTER TABLE "audit_logs" ADD COLUMN "vaultId" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "actorDonorId" TEXT;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorDonorId_fkey"
  FOREIGN KEY ("actorDonorId") REFERENCES "vault_donors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Redefine the hash formula to also cover actorDonorId, in the same
-- position as the other three actor FKs (right after actorFounderId).
-- CREATE OR REPLACE only replaces a function whose argument list is
-- byte-for-byte identical — adding a new parameter makes Postgres treat
-- this as a distinct overload rather than a replacement, which would
-- leave the old 12-argument version lingering unused (dropped, not
-- just shadowed) alongside the new 13-argument one. Drop the exact old
-- signature first so there's only ever one audit_log_row_hash.
DROP FUNCTION IF EXISTS audit_log_row_hash(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION audit_log_row_hash(
  p_previous_hash TEXT,
  p_id TEXT,
  p_actor_type TEXT,
  p_actor_user_id TEXT,
  p_actor_agent_id TEXT,
  p_actor_founder_id TEXT,
  p_actor_donor_id TEXT,
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
        COALESCE(p_actor_donor_id, '') || '|' ||
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

-- 3. Re-derive the entire chain under the new formula. Every existing
-- row's actorDonorId is NULL, so this only changes each row's stored
-- hash to reflect the new formula shape — it does not change what any
-- row's before/after/actor/action content actually says.
--
-- NOT the original migration's own `a.sequence = chain.sequence + 1`
-- join — confirmed live (this database has run a lot of tests) that
-- "sequence" has real gaps: a rolled-back insert still burns a
-- nextval() call, since Postgres sequences aren't transactional, so
-- consecutive rows can read e.g. 10344, 10346 with no 10345 ever
-- existing. That join condition silently stops recursing the instant it
-- can't find an exact sequence+1 match, leaving every row after the
-- first gap on a stale hash — reproduced exactly this way while writing
-- this migration (audit_logs_verify_chain() flagged everything from the
-- first gap onward). Joining on row position (ROW_NUMBER() over
-- sequence order) instead of raw sequence arithmetic walks every row
-- regardless of gaps in the underlying values.
WITH RECURSIVE ordered AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY "sequence") AS rn FROM "audit_logs"
),
chain AS (
  (
    SELECT "id", "rn", NULL::TEXT AS previous_hash,
      audit_log_row_hash(
        NULL, "id", "actorType"::text, "actorUserId", "actorAgentId", "actorFounderId", "actorDonorId",
        "action", "entityType", "entityId", "before"::text, "after"::text, "createdAt"::text
      ) AS record_hash
    FROM ordered
    ORDER BY "rn"
    LIMIT 1
  )
  UNION ALL
  SELECT o."id", o."rn", chain.record_hash AS previous_hash,
    audit_log_row_hash(
      chain.record_hash, o."id", o."actorType"::text, o."actorUserId", o."actorAgentId", o."actorFounderId", o."actorDonorId",
      o."action", o."entityType", o."entityId", o."before"::text, o."after"::text, o."createdAt"::text
    ) AS record_hash
  FROM ordered o
  JOIN chain ON o."rn" = chain."rn" + 1
)
UPDATE "audit_logs" SET "previousHash" = chain.previous_hash, "recordHash" = chain.record_hash
FROM chain WHERE "audit_logs"."id" = chain."id";

-- 4. Redefine the insert trigger to pass the new parameter.
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
    NEW."actorDonorId",
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

-- Trigger itself is unchanged (still BEFORE INSERT, same function name) —
-- only the function body above changed, so no DROP/CREATE TRIGGER needed.

-- 5. Redefine self-service verification to match the new formula.
-- Postgres won't let CREATE OR REPLACE change a function's declared
-- return row type (OUT parameter types) — has to be dropped first, same
-- as 20260909055500_audit_log_sequence_as_int's own comment on this.
-- sequence is INTEGER here (not the original migration's BIGINT — see
-- that later migration's own fix), matching the column's actual current
-- type; getting this wrong is exactly what made the first attempt at
-- this migration fail with "cannot change return type of existing
-- function".
DROP FUNCTION IF EXISTS audit_logs_verify_chain();

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
          t."actorFounderId", t."actorDonorId", t."action", t."entityType", t."entityId",
          t."before"::text, t."after"::text, t."createdAt"::text
        )
$$ LANGUAGE sql STABLE;
