-- CreateEnum
CREATE TYPE "SuccessionKind" AS ENUM ('handover', 'unreachable');

-- CreateEnum
CREATE TYPE "SuccessionStatus" AS ENUM ('requested', 'approved', 'completed', 'rejected', 'cancelled', 'objected');

-- CreateTable
CREATE TABLE "primary_contact_successions" (
    "id" TEXT NOT NULL,
    "founderId" TEXT NOT NULL,
    "kind" "SuccessionKind" NOT NULL,
    "status" "SuccessionStatus" NOT NULL DEFAULT 'requested',
    "outgoingMembershipId" TEXT NOT NULL,
    "newMembershipId" TEXT,
    "newEmail" TEXT,
    "newFullName" TEXT,
    "reason" TEXT NOT NULL,
    "evidenceNote" TEXT,
    "requestedByUserId" TEXT,
    "recordedByUserId" TEXT,
    "outgoingNotifiedAt" TIMESTAMP(3),
    "earliestApprovalAt" TIMESTAMP(3) NOT NULL,
    "objectedAt" TIMESTAMP(3),
    "objectionNote" TEXT,
    "governedActionId" TEXT,
    "invitationId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "primary_contact_successions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "primary_contact_successions_governedActionId_key" ON "primary_contact_successions"("governedActionId");

-- CreateIndex
CREATE UNIQUE INDEX "primary_contact_successions_invitationId_key" ON "primary_contact_successions"("invitationId");

-- CreateIndex
CREATE INDEX "primary_contact_successions_founderId_idx" ON "primary_contact_successions"("founderId");

-- AddForeignKey
ALTER TABLE "primary_contact_successions" ADD CONSTRAINT "primary_contact_successions_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "primary_contact_successions" ADD CONSTRAINT "primary_contact_successions_outgoingMembershipId_fkey" FOREIGN KEY ("outgoingMembershipId") REFERENCES "founder_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "primary_contact_successions" ADD CONSTRAINT "primary_contact_successions_newMembershipId_fkey" FOREIGN KEY ("newMembershipId") REFERENCES "founder_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "primary_contact_successions" ADD CONSTRAINT "primary_contact_successions_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "primary_contact_successions" ADD CONSTRAINT "primary_contact_successions_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "primary_contact_successions" ADD CONSTRAINT "primary_contact_successions_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one active primary contact per Founder: the database itself
-- refuses a second, so a succession can only ever swap, never add.
CREATE UNIQUE INDEX "founder_memberships_one_active_primary_contact" ON "founder_memberships" ("founderId") WHERE "permissionLevel" = 'primary_contact' AND "status" = 'active';

-- One open succession per Founder at a time.
CREATE UNIQUE INDEX "primary_contact_successions_one_open" ON "primary_contact_successions" ("founderId") WHERE "status" IN ('requested', 'approved', 'objected');

-- The new primary contact is always named: an existing member, or a new
-- person's email and name (whose membership is recorded too once they
-- accept and the case completes).
ALTER TABLE "primary_contact_successions" ADD CONSTRAINT "primary_contact_successions_new_person" CHECK (
  "newMembershipId" IS NOT NULL OR ("newEmail" IS NOT NULL AND "newFullName" IS NOT NULL)
);
-- An unreachable case always carries the evidence Birr relied on.
ALTER TABLE "primary_contact_successions" ADD CONSTRAINT "primary_contact_successions_evidence" CHECK (
  "kind" <> 'unreachable' OR length(trim(coalesce("evidenceNote", ''))) >= 10
);

-- Founder isolation, as on the other founder tables (20260830152938):
-- inside a founder's scope only their own Founder's cases are visible.
ALTER TABLE "primary_contact_successions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "primary_contact_successions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "primary_contact_successions"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "founderId" = current_setting('app.current_founder_id', true)
  );
