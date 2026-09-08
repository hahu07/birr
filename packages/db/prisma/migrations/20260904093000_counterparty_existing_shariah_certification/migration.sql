-- Adds Counterparty.existingShariahCertification — factual supporting
-- evidence (name/reference of any Shariah board/certification the
-- counterparty already holds elsewhere) for the shariah_board_member
-- reviewer, captured alongside businessActivities at registration.
-- Companion fix: businessActivities becomes required going forward
-- (enforced at the DTO/form layer, not a DB constraint, so existing
-- rows with none aren't broken) — the actual gap this addresses was
-- that a reviewer had nothing substantive to read before
-- recordShariahApproval, found 2026-09-04.
ALTER TABLE "counterparties" ADD COLUMN     "existingShariahCertification" TEXT;
