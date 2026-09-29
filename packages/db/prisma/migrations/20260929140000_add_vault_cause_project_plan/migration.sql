-- Brief cause-specific write-up of how a Vault Cause's money is used —
-- see VaultCause.projectPlan's own schema comment for why this is
-- cause-level, not another Vault-level field alongside
-- feasibilityReportUrl.
ALTER TABLE "vault_causes" ADD COLUMN     "projectPlan" TEXT;
