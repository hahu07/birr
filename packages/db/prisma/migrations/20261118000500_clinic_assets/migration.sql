-- CreateEnum
CREATE TYPE "ClinicAssetKind" AS ENUM ('land', 'building', 'equipment', 'vehicle', 'other');

-- CreateEnum
CREATE TYPE "ClinicAssetStatus" AS ENUM ('proposed', 'active', 'rejected', 'disposed');

-- CreateTable
CREATE TABLE "clinic_assets" (
    "id" TEXT NOT NULL,
    "clinicWaqfId" TEXT NOT NULL,
    "kind" "ClinicAssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "value" DECIMAL(65,30) NOT NULL,
    "valuationNote" TEXT NOT NULL,
    "donorName" TEXT,
    "acquiredOn" DATE NOT NULL,
    "serialNumber" TEXT,
    "location" TEXT,
    "warrantyUntil" DATE,
    "lastServicedOn" DATE,
    "nextServiceDue" DATE,
    "status" "ClinicAssetStatus" NOT NULL DEFAULT 'proposed',
    "createdByUserId" TEXT NOT NULL,
    "approvalActionId" TEXT,
    "disposalActionId" TEXT,
    "disposedOn" DATE,
    "disposalNote" TEXT,
    "disposalProceeds" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_assets_approvalActionId_key" ON "clinic_assets"("approvalActionId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_assets_disposalActionId_key" ON "clinic_assets"("disposalActionId");

-- CreateIndex
CREATE INDEX "clinic_assets_clinicWaqfId_idx" ON "clinic_assets"("clinicWaqfId");

-- AddForeignKey
ALTER TABLE "clinic_assets" ADD CONSTRAINT "clinic_assets_clinicWaqfId_fkey" FOREIGN KEY ("clinicWaqfId") REFERENCES "clinic_waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_assets" ADD CONSTRAINT "clinic_assets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_assets" ADD CONSTRAINT "clinic_assets_approvalActionId_fkey" FOREIGN KEY ("approvalActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_assets" ADD CONSTRAINT "clinic_assets_disposalActionId_fkey" FOREIGN KEY ("disposalActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Hand-written database rules (2026-11-17, clinic slice 5a).

ALTER TABLE "clinic_assets"
  ADD CONSTRAINT "clinic_assets_value_positive" CHECK ("value" > 0 AND "value" = round("value", 2)),
  ADD CONSTRAINT "clinic_assets_text_present" CHECK (length(btrim("name")) > 0 AND length(btrim("valuationNote")) > 0),
  ADD CONSTRAINT "clinic_assets_proceeds_valid" CHECK ("disposalProceeds" IS NULL OR ("disposalProceeds" >= 0 AND "disposalProceeds" = round("disposalProceeds", 2))),
  -- Each status carries exactly what decided it.
  ADD CONSTRAINT "clinic_assets_status_consistent" CHECK (
    ("status" = 'proposed' AND "approvalActionId" IS NULL AND "disposalActionId" IS NULL)
    OR ("status" = 'rejected' AND "approvalActionId" IS NULL AND "disposalActionId" IS NULL)
    OR ("status" = 'active' AND "approvalActionId" IS NOT NULL AND "disposalActionId" IS NULL AND "disposedOn" IS NULL)
    OR ("status" = 'disposed' AND "approvalActionId" IS NOT NULL AND "disposalActionId" IS NOT NULL
        AND "disposedOn" IS NOT NULL AND "disposalProceeds" IS NOT NULL AND length(btrim(coalesce("disposalNote", ''))) > 0)
  );

-- What an asset is and what it was valued at never change; status only
-- moves proposed -> active | rejected, and active -> disposed; never deleted.
CREATE OR REPLACE FUNCTION clinic_assets_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic waqf asset is never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."name" IS DISTINCT FROM OLD."name"
     OR NEW."value" IS DISTINCT FROM OLD."value"
     OR NEW."valuationNote" IS DISTINCT FROM OLD."valuationNote"
     OR NEW."donorName" IS DISTINCT FROM OLD."donorName"
     OR NEW."acquiredOn" IS DISTINCT FROM OLD."acquiredOn"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'What a clinic waqf asset is, and its value, never change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'proposed' AND NEW."status" IN ('active', 'rejected'))
       OR (OLD."status" = 'active' AND NEW."status" = 'disposed')) THEN
    RAISE EXCEPTION 'A clinic waqf asset can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."status" IN ('rejected', 'disposed') AND (
       NEW."location" IS DISTINCT FROM OLD."location" OR NEW."serialNumber" IS DISTINCT FROM OLD."serialNumber"
       OR NEW."warrantyUntil" IS DISTINCT FROM OLD."warrantyUntil" OR NEW."lastServicedOn" IS DISTINCT FROM OLD."lastServicedOn"
       OR NEW."nextServiceDue" IS DISTINCT FROM OLD."nextServiceDue" OR NEW."description" IS DISTINCT FROM OLD."description") THEN
    RAISE EXCEPTION 'A % clinic waqf asset can''t be changed', OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinic_assets_before_change
  BEFORE UPDATE OR DELETE ON "clinic_assets"
  FOR EACH ROW EXECUTE FUNCTION clinic_assets_check_change();
