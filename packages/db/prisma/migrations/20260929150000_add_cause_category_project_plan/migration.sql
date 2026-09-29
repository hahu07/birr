-- Default project-plan template, copied into a new VaultCause at
-- selection time — see CauseCategory.projectPlan's own schema comment.
ALTER TABLE "cause_categories" ADD COLUMN     "projectPlan" TEXT;
