-- AlterTable
ALTER TABLE "waqf_causes" ADD COLUMN     "allocatedAmount" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "waqf_proceeds" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "investmentId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waqf_proceeds_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "waqf_proceeds" ADD CONSTRAINT "waqf_proceeds_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_proceeds" ADD CONSTRAINT "waqf_proceeds_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "investments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_proceeds" ADD CONSTRAINT "waqf_proceeds_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
