-- AlterTable
ALTER TABLE "users" ADD COLUMN     "whatsappNumber" TEXT,
ADD COLUMN     "whatsappVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "contribution_minimums" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "minAmount" DECIMAL(65,30) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribution_minimums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_otps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waqf_deeds" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "signedByUserId" TEXT NOT NULL,
    "signedByFounderId" TEXT NOT NULL,
    "typedLegalName" TEXT NOT NULL,
    "deedTemplateVersion" TEXT NOT NULL,
    "deedText" TEXT NOT NULL,
    "affirmed" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waqf_deeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contribution_minimums_currency_key" ON "contribution_minimums"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "waqf_deeds_waqfId_key" ON "waqf_deeds"("waqfId");

-- AddForeignKey
ALTER TABLE "whatsapp_otps" ADD CONSTRAINT "whatsapp_otps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_deeds" ADD CONSTRAINT "waqf_deeds_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_deeds" ADD CONSTRAINT "waqf_deeds_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_deeds" ADD CONSTRAINT "waqf_deeds_signedByFounderId_fkey" FOREIGN KEY ("signedByFounderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable signed record, same reasoning and same pattern as audit_logs
-- (see 20260731201431_governed_actions_constraints/migration.sql): once a
-- waqf deed is signed it must never be editable or erasable, enforced at
-- the database role level rather than just in application code.
--
-- 2026-09-26: guarded the same way and for the same reason as that same
-- migration's own REVOKE — see its comment. This one's real effect gets
-- reversed two migrations later anyway (see
-- 20260803180000_waqf_deeds_immutable_via_trigger's own comment on why
-- REVOKE broke the incoming FK from waqfs), so the guard changes nothing
-- either way once the whole 3-migration sequence has run.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'birr') THEN
    REVOKE UPDATE, DELETE ON "waqf_deeds" FROM "birr";
  END IF;
END
$$;
