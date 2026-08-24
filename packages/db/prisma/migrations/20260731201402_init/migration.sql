-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('invited', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "FounderKind" AS ENUM ('institution', 'individual');

-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('islamic_bank', 'university', 'corporate_foundation', 'ngo', 'family_office', 'government', 'awqaf_authority', 'other');

-- CreateEnum
CREATE TYPE "FounderStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "FounderPermissionLevel" AS ENUM ('primary_contact', 'viewer', 'requester');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "BirrStaffRole" AS ENUM ('mutawalli_officer', 'investment_committee', 'shariah_board_member', 'audit_committee', 'compliance_officer', 'legal_adviser', 'platform_admin');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "WaqfType" AS ENUM ('investment', 'asset', 'project', 'hybrid');

-- CreateEnum
CREATE TYPE "WaqfStatus" AS ENUM ('draft', 'active', 'suspended', 'dissolved');

-- CreateEnum
CREATE TYPE "CaseAssignmentRole" AS ENUM ('mutawalli_officer', 'investment_officer', 'compliance_reviewer', 'shariah_reviewer', 'auditor');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('active', 'reassigned', 'closed');

-- CreateEnum
CREATE TYPE "AgentTaskType" AS ENUM ('compliance_monitoring', 'caseload_triage', 'anomaly_detection', 'investment_research', 'founder_onboarding', 'beneficiary_verification', 'business_development', 'other');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "MakerType" AS ENUM ('human', 'ai_agent');

-- CreateEnum
CREATE TYPE "GovernedActionStatus" AS ENUM ('proposed', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "CoiStatus" AS ENUM ('declared', 'reviewed', 'cleared', 'escalated');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('birr_staff', 'founder_user', 'system', 'ai_agent');

-- CreateEnum
CREATE TYPE "InviteeKind" AS ENUM ('founder_user', 'birr_staff');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "authProviderId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'invited',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "founders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FounderKind" NOT NULL,
    "institutionType" "InstitutionType",
    "homeJurisdiction" TEXT,
    "status" "FounderStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "founders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "founder_memberships" (
    "id" TEXT NOT NULL,
    "founderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionLevel" "FounderPermissionLevel" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "founder_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birr_staff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffRole" "BirrStaffRole" NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "birr_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "requiresMakerChecker" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "canMaker" BOOLEAN NOT NULL DEFAULT false,
    "canChecker" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "waqfs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WaqfType" NOT NULL,
    "purpose" TEXT,
    "jurisdiction" TEXT NOT NULL,
    "status" "WaqfStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "waqfs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waqf_founders" (
    "waqfId" TEXT NOT NULL,
    "founderId" TEXT NOT NULL,
    "contributionNote" TEXT,

    CONSTRAINT "waqf_founders_pkey" PRIMARY KEY ("waqfId","founderId")
);

-- CreateTable
CREATE TABLE "waqf_case_assignments" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "birrStaffId" TEXT NOT NULL,
    "assignmentRole" "CaseAssignmentRole" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'active',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "waqf_case_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskType" "AgentTaskType" NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governed_actions" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "makerType" "MakerType" NOT NULL,
    "makerUserId" TEXT,
    "makerAgentId" TEXT,
    "checkerUserId" TEXT,
    "status" "GovernedActionStatus" NOT NULL DEFAULT 'proposed',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "governed_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_of_interest_declarations" (
    "id" TEXT NOT NULL,
    "birrStaffId" TEXT NOT NULL,
    "waqfId" TEXT,
    "declarationText" TEXT NOT NULL,
    "status" "CoiStatus" NOT NULL DEFAULT 'declared',
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "conflict_of_interest_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT,
    "actorUserId" TEXT,
    "actorAgentId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "inviteeKind" "InviteeKind" NOT NULL,
    "email" TEXT NOT NULL,
    "founderId" TEXT,
    "roleKey" TEXT,
    "invitedBy" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "founder_memberships_founderId_userId_key" ON "founder_memberships"("founderId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "birr_staff_userId_key" ON "birr_staff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "waqf_case_assignments_waqfId_birrStaffId_assignmentRole_key" ON "waqf_case_assignments"("waqfId", "birrStaffId", "assignmentRole");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_name_key" ON "ai_agents"("name");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- AddForeignKey
ALTER TABLE "founder_memberships" ADD CONSTRAINT "founder_memberships_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "founder_memberships" ADD CONSTRAINT "founder_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "founder_memberships" ADD CONSTRAINT "founder_memberships_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "birr_staff" ADD CONSTRAINT "birr_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_founders" ADD CONSTRAINT "waqf_founders_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_founders" ADD CONSTRAINT "waqf_founders_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_case_assignments" ADD CONSTRAINT "waqf_case_assignments_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_case_assignments" ADD CONSTRAINT "waqf_case_assignments_birrStaffId_fkey" FOREIGN KEY ("birrStaffId") REFERENCES "birr_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governed_actions" ADD CONSTRAINT "governed_actions_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governed_actions" ADD CONSTRAINT "governed_actions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governed_actions" ADD CONSTRAINT "governed_actions_makerUserId_fkey" FOREIGN KEY ("makerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governed_actions" ADD CONSTRAINT "governed_actions_makerAgentId_fkey" FOREIGN KEY ("makerAgentId") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governed_actions" ADD CONSTRAINT "governed_actions_checkerUserId_fkey" FOREIGN KEY ("checkerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_of_interest_declarations" ADD CONSTRAINT "conflict_of_interest_declarations_birrStaffId_fkey" FOREIGN KEY ("birrStaffId") REFERENCES "birr_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_of_interest_declarations" ADD CONSTRAINT "conflict_of_interest_declarations_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorAgentId_fkey" FOREIGN KEY ("actorAgentId") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
