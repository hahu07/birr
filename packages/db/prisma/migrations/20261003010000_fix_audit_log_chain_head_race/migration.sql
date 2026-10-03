-- Fixes a real concurrency bug in the audit-log hash chain's WRITE
-- path, found and reproduced live during a 2026-10-02/03 codebase
-- audit. Confirmed: 50 genuine fork points already exist in this
-- database's history (multiple rows legitimately storing the SAME
-- previousHash, inserted within milliseconds of each other — e.g. 5
-- concurrent vault.created rows). Reproduced on demand with 8 concurrent
-- inserts through the real application code path
-- (VaultsService.create()'s own prisma.$transaction shape).
--
-- Root cause: audit_logs_chain_hash() (from 20260909053819, last
-- touched by 20260910061500) used
--   PERFORM pg_advisory_xact_lock(hashtext('audit_logs_hash_chain'));
--   SELECT "recordHash" INTO prev_hash FROM "audit_logs"
--     ORDER BY "sequence" DESC LIMIT 1;
-- Under this database's default READ COMMITTED isolation, a statement's
-- MVCC snapshot is fixed for the statement's ENTIRE execution —
-- including however long it spends blocked waiting for a lock mid-
-- statement. So: transaction B blocks on the advisory lock while
-- transaction A holds it; A commits; B unblocks and runs its own plain
-- SELECT — but that SELECT still uses the snapshot taken when B's outer
-- INSERT began, which predates A's commit. B reads the same "last row"
-- A already read and chains off it too: a genuine fork, not a display
-- artifact. This is documented, known Postgres behavior for plain
-- SELECT under lock contention — it is NOT a race the advisory lock was
-- ever capable of closing by itself.
--
-- This is a different (deeper) finding than
-- 20261003000000_fix_audit_log_chain_verification_order, which fixed a
-- false-positive bug in the READ-side verification function
-- (audit_logs_verify_chain() assumed sequence order was chain order,
-- which isn't true under concurrency even when the chain itself is
-- intact). That fix stands on its own. This migration fixes the
-- WRITE-side bug that actually produced the handful of real forks in
-- this database's history.
--
-- What this migration deliberately does NOT do: rewrite history. The
-- ~50 existing fork points stay exactly as they happened — each row's
-- own content is, and always was, untouched and correctly hashed from
-- whatever previousHash it actually read at insert time; "fix" here
-- means "stop new forks," not "retroactively pick a winner" among
-- branches that already both really happened. audit_logs_verify_chain()
-- still correctly walks every row that's reachable from the one true
-- root; a forked branch is still reachable (previousHash still points
-- at a real prior recordHash), so this migration doesn't change what
-- that function reports for historical rows.
--
-- Fix: replace the advisory lock + plain SELECT with SELECT ... FOR
-- UPDATE on one dedicated, single-row table. This is the standard
-- Postgres-idiomatic pattern for "safely read-then-advance a running
-- pointer under concurrency" specifically because SELECT ... FOR UPDATE
-- (unlike a plain SELECT) is guaranteed to re-fetch a row's latest
-- COMMITTED version once its lock is actually granted — it does not
-- suffer the same fixed-snapshot problem a plain SELECT has, even
-- though both run inside the same READ COMMITTED statement. One
-- primitive now does both the locking and the fresh-read correctly,
-- replacing two primitives that only did the locking.

-- 1. The singleton table. Boolean primary key + CHECK("id") is the
-- standard idiom for "exactly one row, forever" — PRIMARY KEY already
-- forces uniqueness across the only two possible boolean values, and
-- the CHECK eliminates the id = false possibility, so there is
-- structurally no way for a second row to ever exist.
CREATE TABLE "audit_log_chain_head" (
  "id" BOOLEAN NOT NULL DEFAULT true,
  "lastHash" TEXT,
  CONSTRAINT "audit_log_chain_head_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_log_chain_head_singleton" CHECK ("id")
);

-- No explicit GRANT needed — the standing
-- `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ON
-- TABLES TO birr_app` from 20260831180000_add_birr_app_runtime_role
-- already covers every table created by migrations from that point on,
-- this one included. This table intentionally carries no tamper-
-- evidence protection of its own (no revoked UPDATE grant) — it holds
-- no independently meaningful audit content, only a working pointer to
-- the current chain tip, the same operational-state role
-- audit_logs_sequence_seq already plays for `sequence`.

-- 2. Seed it with the current true head, same notion of "head" the old
-- trigger already used (whatever MAX(sequence) points at) — this
-- migration changes HOW the head is read/updated going forward, not
-- what the chain's current tip actually is.
INSERT INTO "audit_log_chain_head" ("id", "lastHash")
SELECT true, "recordHash" FROM "audit_logs" ORDER BY "sequence" DESC LIMIT 1
ON CONFLICT DO NOTHING;

-- Covers a fresh/empty database (no audit_logs rows yet) — the above
-- INSERT...SELECT matches zero rows in that case, so explicitly ensure
-- the singleton row still exists with a NULL starting head.
INSERT INTO "audit_log_chain_head" ("id", "lastHash")
VALUES (true, NULL)
ON CONFLICT DO NOTHING;

-- 3. Redefine the trigger. Function name/signature unchanged (still
-- `audit_logs_chain_hash() RETURNS TRIGGER`), so the existing
-- `BEFORE INSERT ON audit_logs` trigger registration doesn't need to be
-- touched — only this function's body changes.
CREATE OR REPLACE FUNCTION audit_logs_chain_hash() RETURNS TRIGGER AS $$
DECLARE
  prev_hash TEXT;
BEGIN
  SELECT "lastHash" INTO prev_hash FROM "audit_log_chain_head" WHERE "id" = true FOR UPDATE;

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

  UPDATE "audit_log_chain_head" SET "lastHash" = NEW."recordHash" WHERE "id" = true;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger registration itself is unchanged (still BEFORE INSERT, same
-- function name) — no DROP/CREATE TRIGGER needed, same as
-- 20260910061500's own note on this.
