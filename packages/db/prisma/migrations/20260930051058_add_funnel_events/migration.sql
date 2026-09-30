-- CreateEnum
CREATE TYPE "FunnelName" AS ENUM ('founder', 'vault');

-- CreateTable
CREATE TABLE "funnel_events" (
    "id" TEXT NOT NULL,
    "funnel" "FunnelName" NOT NULL,
    "step" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "founderId" TEXT,
    "waqfId" TEXT,
    "vaultId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funnel_events_funnel_step_occurredAt_idx" ON "funnel_events"("funnel", "step", "occurredAt");

-- CreateIndex
CREATE INDEX "funnel_events_sessionId_idx" ON "funnel_events"("sessionId");

-- CreateIndex
CREATE INDEX "funnel_events_founderId_idx" ON "funnel_events"("founderId");

-- CreateIndex
CREATE INDEX "funnel_events_waqfId_idx" ON "funnel_events"("waqfId");

-- CreateIndex
CREATE INDEX "funnel_events_vaultId_idx" ON "funnel_events"("vaultId");

-- AddForeignKey
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE SET NULL ON UPDATE CASCADE;
