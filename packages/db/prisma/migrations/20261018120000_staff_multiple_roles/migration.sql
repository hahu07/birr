-- A Birr staff member may hold several roles (owner decision, 2026-10-18).
-- Replaces birr_staff."staffRole" with one birr_staff_roles row per role
-- held. Every existing staff member keeps exactly the role they had.

-- CreateTable
CREATE TABLE "birr_staff_roles" (
    "birrStaffId" TEXT NOT NULL,
    "role" "BirrStaffRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "birr_staff_roles_pkey" PRIMARY KEY ("birrStaffId","role")
);

-- CreateIndex
CREATE INDEX "birr_staff_roles_role_idx" ON "birr_staff_roles"("role");

-- AddForeignKey
ALTER TABLE "birr_staff_roles" ADD CONSTRAINT "birr_staff_roles_birrStaffId_fkey" FOREIGN KEY ("birrStaffId") REFERENCES "birr_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: each staff member's current single role becomes their first
-- (and, for now, only) row. Runs before the column is dropped.
INSERT INTO "birr_staff_roles" ("birrStaffId", "role", "createdAt")
SELECT "id", "staffRole", "createdAt" FROM "birr_staff";

-- AlterTable
ALTER TABLE "birr_staff" DROP COLUMN "staffRole";

-- Enforced in the database, not just the app, the same posture as
-- checker_not_maker on governed_actions:
--
-- 1. external_auditor stands alone — an auditor can't hold any other role,
--    since they must stay independent of what they audit (owner decision,
--    2026-10-18).
-- 2. A staff member always keeps at least one role (unless the staff row
--    itself is deleted, which cascades to its roles).
-- 3. A row is never edited in place — a role is added or removed, so the
--    audit trail of each change stays a plain insert or delete.
--
-- Both checks lock the staff member's birr_staff row first, so two
-- concurrent changes to the same person are serialized and can't both
-- slip past the check (e.g. one adding external_auditor while another
-- adds a second role).
CREATE OR REPLACE FUNCTION birr_staff_roles_check_insert() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM "birr_staff" WHERE "id" = NEW."birrStaffId" FOR UPDATE;
  IF NEW."role" = 'external_auditor' THEN
    IF EXISTS (SELECT 1 FROM "birr_staff_roles" WHERE "birrStaffId" = NEW."birrStaffId" AND "role" <> 'external_auditor') THEN
      RAISE EXCEPTION 'An external_auditor cannot hold any other staff role';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM "birr_staff_roles" WHERE "birrStaffId" = NEW."birrStaffId" AND "role" = 'external_auditor') THEN
    RAISE EXCEPTION 'An external_auditor cannot hold any other staff role';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER birr_staff_roles_before_insert
  BEFORE INSERT ON "birr_staff_roles"
  FOR EACH ROW EXECUTE FUNCTION birr_staff_roles_check_insert();

CREATE OR REPLACE FUNCTION birr_staff_roles_check_delete() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM "birr_staff" WHERE "id" = OLD."birrStaffId" FOR UPDATE;
  -- The staff row itself is being deleted (the cascade from birr_staff):
  -- its roles go with it. Staff are soft-deleted in practice (CLAUDE.md),
  -- so this is test-fixture cleanup, not a way around the rule.
  IF NOT FOUND THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "birr_staff_roles" WHERE "birrStaffId" = OLD."birrStaffId") THEN
    RAISE EXCEPTION 'A staff member must keep at least one role';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER birr_staff_roles_after_delete
  AFTER DELETE ON "birr_staff_roles"
  FOR EACH ROW EXECUTE FUNCTION birr_staff_roles_check_delete();

CREATE OR REPLACE FUNCTION birr_staff_roles_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'birr_staff_roles rows are added or removed, never edited';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER birr_staff_roles_no_update
  BEFORE UPDATE ON "birr_staff_roles"
  FOR EACH ROW EXECUTE FUNCTION birr_staff_roles_reject_update();
