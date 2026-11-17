-- CreateEnum
CREATE TYPE "CounterpartyLicenseKind" AS ENUM ('health_facility_registration', 'medical_laboratory_registration', 'professional_indemnity_insurance', 'data_protection_registration', 'other');

-- AlterEnum
ALTER TYPE "CounterpartyType" ADD VALUE 'healthcare_provider';

-- CreateTable
CREATE TABLE "counterparty_licenses" (
    "id" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "kind" "CounterpartyLicenseKind" NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "issuingAuthority" TEXT NOT NULL,
    "issuedOn" DATE,
    "expiresOn" DATE NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "withdrawnByUserId" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawalReason" TEXT,
    "lastExpiryNoticeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counterparty_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counterparty_licenses_counterpartyId_kind_idx" ON "counterparty_licenses"("counterpartyId", "kind");

-- AddForeignKey
ALTER TABLE "counterparty_licenses" ADD CONSTRAINT "counterparty_licenses_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_licenses" ADD CONSTRAINT "counterparty_licenses_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_licenses" ADD CONSTRAINT "counterparty_licenses_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_licenses" ADD CONSTRAINT "counterparty_licenses_withdrawnByUserId_fkey" FOREIGN KEY ("withdrawnByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Hand-written database rules (2026-11-17, clinic slice 1).

ALTER TABLE "counterparty_licenses"
  -- A verification is complete (who, when, how they checked) or absent.
  ADD CONSTRAINT "counterparty_licenses_verification_consistent" CHECK (
    ("verifiedByUserId" IS NULL AND "verifiedAt" IS NULL AND "verificationNote" IS NULL)
    OR ("verifiedByUserId" IS NOT NULL AND "verifiedAt" IS NOT NULL AND length(btrim("verificationNote")) > 0)
  ),
  -- Two people: whoever recorded a licence never verifies it.
  ADD CONSTRAINT "counterparty_licenses_verifier_not_recorder" CHECK (
    "verifiedByUserId" IS NULL OR "verifiedByUserId" <> "recordedByUserId"
  ),
  -- A withdrawal is complete (who, when, why) or absent.
  ADD CONSTRAINT "counterparty_licenses_withdrawal_consistent" CHECK (
    ("withdrawnByUserId" IS NULL AND "withdrawnAt" IS NULL AND "withdrawalReason" IS NULL)
    OR ("withdrawnByUserId" IS NOT NULL AND "withdrawnAt" IS NOT NULL AND length(btrim("withdrawalReason")) > 0)
  ),
  ADD CONSTRAINT "counterparty_licenses_dates" CHECK ("issuedOn" IS NULL OR "issuedOn" <= "expiresOn"),
  ADD CONSTRAINT "counterparty_licenses_text_present" CHECK (
    length(btrim("licenseNumber")) > 0 AND length(btrim("issuingAuthority")) > 0
  ),
  ADD CONSTRAINT "counterparty_licenses_notice_days" CHECK (
    "lastExpiryNoticeDays" IS NULL OR "lastExpiryNoticeDays" IN (60, 30, 7, 0)
  );

-- What the certificate says, and who recorded it, never changes. A licence
-- is verified at most once and withdrawn at most once, and a withdrawn one
-- can't then be verified. Only the expiry-warning marker moves freely.
CREATE OR REPLACE FUNCTION counterparty_licenses_check_update() RETURNS trigger AS $$
BEGIN
  IF NEW."counterpartyId" IS DISTINCT FROM OLD."counterpartyId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."licenseNumber" IS DISTINCT FROM OLD."licenseNumber"
     OR NEW."issuingAuthority" IS DISTINCT FROM OLD."issuingAuthority"
     OR NEW."issuedOn" IS DISTINCT FROM OLD."issuedOn"
     OR NEW."expiresOn" IS DISTINCT FROM OLD."expiresOn"
     OR NEW."recordedByUserId" IS DISTINCT FROM OLD."recordedByUserId"
     OR NEW."recordedAt" IS DISTINCT FROM OLD."recordedAt" THEN
    RAISE EXCEPTION 'A recorded licence can''t be changed; withdraw it and record it again';
  END IF;
  IF OLD."verifiedByUserId" IS NOT NULL
     AND (NEW."verifiedByUserId" IS DISTINCT FROM OLD."verifiedByUserId"
          OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
          OR NEW."verificationNote" IS DISTINCT FROM OLD."verificationNote") THEN
    RAISE EXCEPTION 'A licence''s verification can''t be changed';
  END IF;
  IF OLD."withdrawnByUserId" IS NOT NULL
     AND (NEW."withdrawnByUserId" IS DISTINCT FROM OLD."withdrawnByUserId"
          OR NEW."withdrawnAt" IS DISTINCT FROM OLD."withdrawnAt"
          OR NEW."withdrawalReason" IS DISTINCT FROM OLD."withdrawalReason") THEN
    RAISE EXCEPTION 'A licence''s withdrawal can''t be changed';
  END IF;
  IF OLD."withdrawnByUserId" IS NOT NULL AND OLD."verifiedByUserId" IS NULL AND NEW."verifiedByUserId" IS NOT NULL THEN
    RAISE EXCEPTION 'A withdrawn licence can''t be verified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER counterparty_licenses_before_update
  BEFORE UPDATE ON "counterparty_licenses"
  FOR EACH ROW EXECUTE FUNCTION counterparty_licenses_check_update();

-- Licences are history: never deleted, only withdrawn.
CREATE OR REPLACE FUNCTION counterparty_licenses_refuse_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Counterparty licences are never deleted; withdraw one instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER counterparty_licenses_before_delete
  BEFORE DELETE ON "counterparty_licenses"
  FOR EACH ROW EXECUTE FUNCTION counterparty_licenses_refuse_delete();
