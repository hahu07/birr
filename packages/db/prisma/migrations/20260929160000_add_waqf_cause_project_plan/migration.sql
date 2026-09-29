-- Cause-specific, Birr-staff-authored project plan — mirrors
-- VaultCause.projectPlan; see WaqfCause.projectPlan's own schema comment.
ALTER TABLE "waqf_causes" ADD COLUMN     "projectPlan" TEXT;
