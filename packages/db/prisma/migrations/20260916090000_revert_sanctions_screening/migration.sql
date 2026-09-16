-- Reverts the sanctions/PEP screening (ScreenShield) integration added
-- in 20260915140000_add_sanctions_screening — owner's decision,
-- 2026-09-16: Birr does not run ScreenShield for now; the actual
-- engineering work waits for a successful launch or a specific
-- regulatory ask (see CLAUDE.md). Confirmed 0 rows in
-- sanctions_screenings and no Counterparty in "under_review" before
-- this migration was written — safe to drop with no data loss.

-- DropForeignKey
ALTER TABLE "sanctions_screenings" DROP CONSTRAINT "sanctions_screenings_counterpartyId_fkey";

-- DropForeignKey
ALTER TABLE "sanctions_screenings" DROP CONSTRAINT "sanctions_screenings_resolvedByUserId_fkey";

-- DropTable
DROP TABLE "sanctions_screenings";

-- DropEnum
DROP TYPE "SanctionsScreeningProvider";

-- DropEnum
DROP TYPE "SanctionsScreeningStatus";
