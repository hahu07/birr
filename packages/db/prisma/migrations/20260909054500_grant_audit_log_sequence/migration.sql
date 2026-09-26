-- Correction to 20260909053819_add_audit_log_hash_chain: that migration
-- created "audit_logs_sequence_seq" as the schema owner ("birr") but
-- never granted the runtime app role USAGE on it. The prior
-- 20260831180000_add_birr_app_runtime_role migration's
-- `ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES TO birr_app` only
-- covers tables, not sequences — Postgres tracks default privileges for
-- sequences separately. Confirmed directly: an insert as birr_app failed
-- with "permission denied for sequence audit_logs_sequence_seq", since
-- every insert needs nextval() on it for the sequence column's default.
GRANT USAGE, SELECT ON SEQUENCE "audit_logs_sequence_seq" TO birr_app;

-- Same gap would hit any future @default(autoincrement()) field on a
-- table birr_app writes to — close it prospectively too.
--
-- 2026-09-26: same "FOR ROLE birr" portability fix as
-- 20260831180000_add_birr_app_runtime_role's own — see that migration's
-- comment for the full reasoning. current_user is whichever role is
-- actually running this migration, which is always the correct target
-- here, on any environment.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO birr_app',
    current_user
  );
END
$$;
