-- CreateIndex
CREATE INDEX "assets_waqfId_idx" ON "assets"("waqfId");

-- CreateIndex
CREATE INDEX "audit_logs_waqfId_idx" ON "audit_logs"("waqfId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "beneficiaries_waqfId_idx" ON "beneficiaries"("waqfId");

-- CreateIndex
CREATE INDEX "beneficiary_nominations_waqfId_idx" ON "beneficiary_nominations"("waqfId");

-- CreateIndex
CREATE INDEX "beneficiary_nominations_proposedByFounderId_idx" ON "beneficiary_nominations"("proposedByFounderId");

-- CreateIndex
CREATE INDEX "cause_category_suggestions_waqfId_idx" ON "cause_category_suggestions"("waqfId");

-- CreateIndex
CREATE INDEX "cause_category_suggestions_proposedByFounderId_idx" ON "cause_category_suggestions"("proposedByFounderId");

-- CreateIndex
CREATE INDEX "conflict_of_interest_declarations_waqfId_idx" ON "conflict_of_interest_declarations"("waqfId");

-- CreateIndex
CREATE INDEX "contributions_waqfId_idx" ON "contributions"("waqfId");

-- CreateIndex
CREATE INDEX "distributions_waqfId_idx" ON "distributions"("waqfId");

-- CreateIndex
CREATE INDEX "distributions_causeId_idx" ON "distributions"("causeId");

-- CreateIndex
CREATE INDEX "foundation_founders_founderId_idx" ON "foundation_founders"("founderId");

-- CreateIndex
CREATE INDEX "governed_actions_waqfId_idx" ON "governed_actions"("waqfId");

-- CreateIndex
CREATE INDEX "governed_actions_status_idx" ON "governed_actions"("status");

-- CreateIndex
CREATE INDEX "governed_actions_permissionId_idx" ON "governed_actions"("permissionId");

-- CreateIndex
CREATE INDEX "investments_waqfId_idx" ON "investments"("waqfId");

-- CreateIndex
CREATE INDEX "invitations_founderId_idx" ON "invitations"("founderId");

-- CreateIndex
CREATE INDEX "invitations_foundationId_idx" ON "invitations"("foundationId");

-- CreateIndex
CREATE INDEX "waqf_case_assignments_birrStaffId_idx" ON "waqf_case_assignments"("birrStaffId");

-- CreateIndex
CREATE INDEX "waqf_proceeds_waqfId_idx" ON "waqf_proceeds"("waqfId");

-- CreateIndex
CREATE INDEX "waqfs_foundationId_idx" ON "waqfs"("foundationId");
