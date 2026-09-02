-- Birr — a dedicated, non-superuser runtime role for the application.
--
-- Found empirically (2026-08-31, running the test suite against a fresh
-- local Postgres for the first time): "birr" — the role every earlier
-- migration assumes is the app's runtime connection, per those
-- migrations' own comments — is a Postgres SUPERUSER whenever it's
-- created via the official postgres Docker image's POSTGRES_USER
-- bootstrap (see docker-compose.yml). A superuser unconditionally
-- bypasses Row-Level Security (no ALTER TABLE ... FORCE ROW LEVEL
-- SECURITY can override that) and also bypasses the REVOKE UPDATE,
-- DELETE ON audit_logs FROM "birr" added in
-- 20260731201431_governed_actions_constraints, since superusers bypass
-- all privilege checks. Every founder_isolation RLS test failed
-- identically against that setup — not a code bug, a role-topology one.
--
-- Fix: "birr" stays what it's always been — the schema owner, used only
-- for running migrations (DDL) — and the application now connects as
-- "birr_app" instead, a plain login role with exactly the DML privileges
-- it needs and nothing more. Being a non-owner, non-superuser role,
-- ENABLE ROW LEVEL SECURITY already applies to it without needing
-- FORCE (that flag only ever mattered for the owner role itself).
--
-- IF NOT EXISTS-guarded so this migration is safe to re-run/re-deploy
-- without erroring on a role that already exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'birr_app') THEN
    -- Dev-only password, committed here the same way docker-compose.yml
    -- already commits "birr_dev_password" for the "birr" role itself —
    -- rotate via ALTER ROLE before any shared/non-local use, same as
    -- every other dev-default secret in this codebase (see
    -- .env.example's own comments).
    CREATE ROLE birr_app WITH LOGIN PASSWORD 'birr_app_dev_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO birr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO birr_app;

-- Every table this schema creates from here on is granted to birr_app
-- automatically too — without this, a future migration adding a new
-- table would silently leave it unreachable by the app until someone
-- remembered to GRANT it by hand.
ALTER DEFAULT PRIVILEGES FOR ROLE birr IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO birr_app;

-- Same immutability guarantee as the "birr" REVOKE, now for the role
-- that actually needs it enforced against.
REVOKE UPDATE, DELETE ON "audit_logs" FROM birr_app;
