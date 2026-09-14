-- CreateEnum
CREATE TYPE "FounderRequestType" AS ENUM ('distribution_approval', 'investment_change', 'beneficiary_criteria_change', 'asset_disposal', 'other');

-- CreateEnum
CREATE TYPE "FounderRequestStatus" AS ENUM ('pending', 'in_review', 'actioned', 'declined');

-- CreateTable
CREATE TABLE "founder_requests" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "founderId" TEXT NOT NULL,
    "type" "FounderRequestType" NOT NULL,
    "details" JSONB NOT NULL,
    "note" TEXT,
    "status" "FounderRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewedByStaffId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "founder_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "founder_requests_waqfId_idx" ON "founder_requests"("waqfId");

-- CreateIndex
CREATE INDEX "founder_requests_founderId_idx" ON "founder_requests"("founderId");

-- AddForeignKey
ALTER TABLE "founder_requests" ADD CONSTRAINT "founder_requests_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "founder_requests" ADD CONSTRAINT "founder_requests_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "founder_requests" ADD CONSTRAINT "founder_requests_reviewedByStaffId_fkey" FOREIGN KEY ("reviewedByStaffId") REFERENCES "birr_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Founder isolation RLS — same shape as assets/beneficiaries/distributions
-- in 20260830152938_expand_founder_isolation_rls: a founder session only
-- ever sees founder_requests rows for a waqf under one of their own
-- Foundations. reviewedByStaffId/reviewNote stay visible to that same
-- founder (it's their own request's status, not a staff-internal note),
-- unlike GovernedAction which is entirely staff-side.
ALTER TABLE "founder_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "founder_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "founder_requests"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "waqfId" IN (
      SELECT w."id" FROM "waqfs" w
      JOIN "foundation_founders" ff ON ff."foundationId" = w."foundationId"
      WHERE ff."founderId" = current_setting('app.current_founder_id', true)
    )
  );
