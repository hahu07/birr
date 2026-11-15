-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('running', 'clean', 'issues', 'failed');

-- CreateEnum
CREATE TYPE "ReconciliationDirection" AS ENUM ('in', 'out', 'refund');

-- CreateEnum
CREATE TYPE "ReconciliationIssueKind" AS ENUM ('in_missing_in_birr', 'in_missing_at_paystack', 'in_status_mismatch', 'in_amount_mismatch', 'out_missing_in_birr', 'out_missing_at_paystack', 'out_status_mismatch', 'out_amount_mismatch', 'refund_missing_in_birr', 'refund_missing_at_paystack');

-- CreateEnum
CREATE TYPE "ReconciliationIssueStatus" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "payment_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'running',
    "error" TEXT,
    "trigger" TEXT NOT NULL,
    "startedByUserId" TEXT,
    "counts" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "payment_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reconciliation_issues" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "direction" "ReconciliationDirection" NOT NULL,
    "kind" "ReconciliationIssueKind" NOT NULL,
    "providerReference" TEXT NOT NULL,
    "product" TEXT,
    "recordId" TEXT,
    "paystackStatus" TEXT,
    "paystackAmount" DECIMAL(65,30),
    "birrStatus" TEXT,
    "birrAmount" DECIMAL(65,30),
    "currency" TEXT,
    "detail" TEXT NOT NULL,
    "status" "ReconciliationIssueStatus" NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reconciliation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_reconciliation_runs_day_idx" ON "payment_reconciliation_runs"("day");

-- CreateIndex
CREATE INDEX "payment_reconciliation_issues_status_direction_idx" ON "payment_reconciliation_issues"("status", "direction");

-- AddForeignKey
ALTER TABLE "payment_reconciliation_runs" ADD CONSTRAINT "payment_reconciliation_runs_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_reconciliation_issues_runId_fkey" FOREIGN KEY ("runId") REFERENCES "payment_reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_reconciliation_issues_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A mismatch found again on a later run isn't opened twice.
CREATE UNIQUE INDEX "payment_reconciliation_issues_one_open" ON "payment_reconciliation_issues" ("kind", "providerReference") WHERE "status" = 'open';

-- One scheduled run per day at a time (a failed one can be retried).
CREATE UNIQUE INDEX "payment_reconciliation_runs_one_scheduled_per_day" ON "payment_reconciliation_runs" ("day") WHERE "trigger" = 'scheduler' AND "status" <> 'failed';

-- A resolved issue always says who resolved it, when, and why.
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_reconciliation_issues_resolution" CHECK (
  "status" = 'open' OR ("resolvedAt" IS NOT NULL AND "resolvedByUserId" IS NOT NULL AND length(trim("resolutionNote")) >= 5)
);
