-- CreateEnum
CREATE TYPE "ClinicReportStatus" AS ENUM ('draft', 'published', 'discarded');

-- AlterTable
ALTER TABLE "clinic_waqfs" ADD COLUMN     "endowmentTarget" DECIMAL(65,30),
ADD COLUMN     "runningMonthlyTarget" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "clinic_monthly_reports" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "visits" INTEGER NOT NULL,
    "childrenImmunised" INTEGER NOT NULL,
    "testsRun" INTEGER NOT NULL,
    "referrals" INTEGER NOT NULL,
    "status" "ClinicReportStatus" NOT NULL DEFAULT 'draft',
    "recordedByUserId" TEXT NOT NULL,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_monthly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinic_monthly_reports_clinicWaqfId_period_idx" ON "clinic_monthly_reports"("clinicWaqfId", "period");

-- AddForeignKey
ALTER TABLE "clinic_monthly_reports" ADD CONSTRAINT "clinic_monthly_reports_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_monthly_reports" ADD CONSTRAINT "clinic_monthly_reports_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_monthly_reports" ADD CONSTRAINT "clinic_monthly_reports_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==== Rules (2026-11-17, clinic slice 8: public targets and monthly reports) ====

ALTER TABLE "clinic_waqfs"
  ADD CONSTRAINT "clinic_waqfs_targets_positive" CHECK (
    ("endowmentTarget" IS NULL OR "endowmentTarget" > 0) AND ("runningMonthlyTarget" IS NULL OR "runningMonthlyTarget" > 0)
  );

ALTER TABLE "clinic_monthly_reports"
  ADD CONSTRAINT "clinic_monthly_reports_period_format" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "clinic_monthly_reports_counts_not_negative" CHECK (
    "visits" >= 0 AND "childrenImmunised" >= 0 AND "testsRun" >= 0 AND "referrals" >= 0
  ),
  -- Published by a second person, never whoever recorded it.
  ADD CONSTRAINT "clinic_monthly_reports_publisher_not_recorder" CHECK ("publishedByUserId" IS NULL OR "publishedByUserId" <> "recordedByUserId"),
  ADD CONSTRAINT "clinic_monthly_reports_status_consistent" CHECK (
    ("status" = 'published' AND "publishedByUserId" IS NOT NULL AND "publishedAt" IS NOT NULL)
    OR ("status" IN ('draft', 'discarded') AND "publishedByUserId" IS NULL AND "publishedAt" IS NULL)
  );

-- One published report, and one draft, per clinic per month.
CREATE UNIQUE INDEX "clinic_monthly_reports_one_published" ON "clinic_monthly_reports" ("clinicWaqfId", "period") WHERE "status" = 'published';
CREATE UNIQUE INDEX "clinic_monthly_reports_one_draft" ON "clinic_monthly_reports" ("clinicWaqfId", "period") WHERE "status" = 'draft';

-- The figures never change once recorded (a correction is a new draft,
-- before publishing); status moves only draft -> published | discarded;
-- never deleted.
CREATE OR REPLACE FUNCTION clinic_monthly_reports_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic monthly report is never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId" OR NEW."period" IS DISTINCT FROM OLD."period"
     OR NEW."visits" IS DISTINCT FROM OLD."visits" OR NEW."childrenImmunised" IS DISTINCT FROM OLD."childrenImmunised"
     OR NEW."testsRun" IS DISTINCT FROM OLD."testsRun" OR NEW."referrals" IS DISTINCT FROM OLD."referrals"
     OR NEW."recordedByUserId" IS DISTINCT FROM OLD."recordedByUserId" THEN
    RAISE EXCEPTION 'A clinic monthly report''s figures never change; discard the draft and record it again';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (OLD."status" = 'draft' AND NEW."status" IN ('published', 'discarded')) THEN
    RAISE EXCEPTION 'A clinic monthly report can''t go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_monthly_reports_before_change
  BEFORE UPDATE OR DELETE ON "clinic_monthly_reports"
  FOR EACH ROW EXECUTE FUNCTION clinic_monthly_reports_check_change();
