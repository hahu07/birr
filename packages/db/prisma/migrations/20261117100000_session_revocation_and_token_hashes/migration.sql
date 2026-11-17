-- Security review, 2026-11-17 (docs/security-review-2026-11-17.md).

-- A two-factor code is accepted once: the step of the last one used.
ALTER TABLE "users" ADD COLUMN "mfaLastUsedStep" INTEGER;

-- Sessions issued before this are refused (password or two-factor reset).
ALTER TABLE "users" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);

-- Reset and verification tokens are stored as a SHA-256 hash from now on.
-- Hash the outstanding ones too, so links already emailed keep working.
UPDATE "users" SET "passwordResetToken" = encode(sha256(convert_to("passwordResetToken", 'UTF8')), 'hex')
  WHERE "passwordResetToken" IS NOT NULL;
UPDATE "users" SET "verificationToken" = encode(sha256(convert_to("verificationToken", 'UTF8')), 'hex')
  WHERE "verificationToken" IS NOT NULL;
