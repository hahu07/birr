-- 2026-09-26 advanced enhancement (see the Birr Codebase Audit report's
-- "Proposed advanced enhancements" section) — a non-blocking secondary
-- identity signal for the Vault donor anti-structuring gap CLAUDE.md's own
-- 2026-09-13/15 update accepted as a residual risk for v1: a donor giving
-- under a genuinely different email each time gets a genuinely different,
-- blank-history VaultDonor every time, with no way to link them.
--
-- This does NOT close that gap automatically, and deliberately never gates
-- a contribution on it — CLAUDE.md's own standing principle (argued for
-- Founder/Vault-donor sanctions screening, 2026-09-15) is that no automated
-- signal should ever hold up a real donor's own self-service action. This
-- column is purely observational: captured server-side from the request
-- (see VaultContributionsController.initiate, never client-supplied) and
-- read only by VaultContributionsService.getStructuringReview's new
-- ipClusters, for a compliance officer's own manual judgment — the exact
-- "off-platform review" posture the owner already chose over an automated
-- block, given a second, complementary signal to work from instead of
-- email alone.

-- AlterTable
ALTER TABLE "vault_contributions" ADD COLUMN "ipAddress" TEXT;

-- CreateIndex
CREATE INDEX "vault_contributions_ipAddress_idx" ON "vault_contributions"("ipAddress");
