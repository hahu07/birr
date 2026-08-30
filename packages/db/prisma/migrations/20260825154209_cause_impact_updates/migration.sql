-- CreateTable
CREATE TABLE "cause_impact_updates" (
    "id" TEXT NOT NULL,
    "waqfCauseId" TEXT NOT NULL,
    "reportedByUserId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "metricValue" INTEGER,
    "metricLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cause_impact_updates_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "cause_impact_updates" ADD CONSTRAINT "cause_impact_updates_waqfCauseId_fkey" FOREIGN KEY ("waqfCauseId") REFERENCES "waqf_causes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cause_impact_updates" ADD CONSTRAINT "cause_impact_updates_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
