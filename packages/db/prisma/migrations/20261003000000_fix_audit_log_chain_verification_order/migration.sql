-- Fixes a false-positive bug in audit_logs_verify_chain() — found via a
-- 2026-10-02 codebase audit, root-caused and reproduced live. The chain
-- ITSELF was never broken; the verification function was checking it
-- the wrong way.
--
-- Root cause: "sequence" is assigned by DEFAULT nextval(...), which
-- Postgres evaluates BEFORE the audit_logs_chain_hash() trigger ever
-- runs — in particular, BEFORE that trigger acquires
-- pg_advisory_xact_lock('audit_logs_hash_chain'). Two transactions
-- racing to insert an audit_logs row can get their sequence numbers in
-- one order (whichever reaches its INSERT statement first) while the
-- advisory lock — and therefore the actual hash chain — gets built in a
-- DIFFERENT order (whichever finishes whatever work it does before its
-- own auditLog.create() call and wins the lock first). The chain itself
-- (previousHash -> recordHash linkage) is still perfectly correct and
-- gap-free; it just isn't guaranteed to run in the same order as
-- "sequence" under concurrent writes.
--
-- The old audit_logs_verify_chain() walked the table ORDER BY sequence
-- and compared each row's previousHash against the PRECEDING ROW BY
-- SEQUENCE's recordHash (a plain LAG() window function) — so under any
-- concurrent writes, it would compare two rows that aren't actually
-- adjacent in the real chain, and report a false "chain link broken" or
-- "record hash does not match" for both, even though nothing was
-- tampered with.
--
-- Confirmed live on this database: audit_logs_verify_chain() flagged
-- 1,632 of 10,445 rows (15.6%). A direct, sequence-independent check —
-- does every row's previousHash equal SOME other row's recordHash, are
-- there zero duplicate recordHash values, and is there exactly one row
-- with previousHash IS NULL — found zero orphans, zero duplicate
-- hashes, and exactly one root. The chain was always intact; only the
-- verification method's sequence-ordering assumption was wrong. A
-- concurrent 10-insert reproduction (outside this migration) introduced
-- new sequence-order breaks immediately, confirming this is a real,
-- reproducible concurrency pattern — not a one-off artifact of this
-- database's migration history.
--
-- This matters in practice, not just in theory: Vault's public donation
-- flow and any batch of concurrent governed-action approvals are
-- exactly the kind of traffic that triggers this. Before this fix, an
-- Audit Committee member or External Auditor running the self-service
-- verification CLAUDE.md specifically built for them would see
-- thousands of false "tampering" reports in ordinary operation — a
-- false-positive rate that makes the tool itself untrustworthy, which
-- defeats the entire point of building it.
--
-- Fix: walk the chain by actual hash LINKAGE (a recursive CTE starting
-- from the one previousHash IS NULL root, following
-- previousHash = recordHash forward) instead of by sequence. A row not
-- reachable this way is a genuine structural break (tampering, or an
-- actual bug) — the same reporting an unaffected row's own content
-- mismatch stays exactly as sensitive as before. The trigger and the
-- hash formula are untouched; only this read-only verification function
-- changes.

-- 1. Index previousHash — the recursive walk below does one lookup per
-- chain link; without this it's a full table scan per step, which only
-- gets worse as this table grows (it's explicitly append-only/ever-
-- growing — see this table's own existing indexes, added for the same
-- reason).
CREATE INDEX "audit_logs_previousHash_idx" ON "audit_logs" ("previousHash");

-- 2. Postgres won't let CREATE OR REPLACE change a function's declared
-- return row type's semantics here in a way it's happy with across a
-- full body rewrite of this shape — drop first, same pattern every
-- earlier audit-log migration touching this function already used.
DROP FUNCTION IF EXISTS audit_logs_verify_chain();

CREATE OR REPLACE FUNCTION audit_logs_verify_chain()
RETURNS TABLE(sequence INTEGER, id TEXT, issue TEXT) AS $$
  WITH RECURSIVE chain AS (
    SELECT a.id, a."recordHash"
    FROM "audit_logs" a
    WHERE a."previousHash" IS NULL
    UNION ALL
    SELECT a.id, a."recordHash"
    FROM "audit_logs" a
    JOIN chain c ON a."previousHash" = c."recordHash"
  ),
  checked AS (
    SELECT
      a.sequence,
      a.id,
      c.id IS NULL AS unreachable,
      a."recordHash" IS DISTINCT FROM audit_log_row_hash(
        a."previousHash", a.id, a."actorType"::text, a."actorUserId", a."actorAgentId",
        a."actorFounderId", a."actorDonorId", a.action, a."entityType", a."entityId",
        a.before::text, a.after::text, a."createdAt"::text
      ) AS content_mismatch
    FROM "audit_logs" a
    LEFT JOIN chain c ON c.id = a.id
  )
  SELECT sequence, id,
    CASE
      WHEN unreachable THEN 'not reachable from the chain root by hash linkage — possible tampering or a broken link'
      WHEN content_mismatch THEN 'record hash does not match this row''s current contents'
    END AS issue
  FROM checked
  WHERE unreachable OR content_mismatch
$$ LANGUAGE sql STABLE;
