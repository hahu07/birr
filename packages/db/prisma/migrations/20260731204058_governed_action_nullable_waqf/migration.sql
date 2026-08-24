-- DropForeignKey
ALTER TABLE "governed_actions" DROP CONSTRAINT "governed_actions_waqfId_fkey";

-- AlterTable
ALTER TABLE "governed_actions" ALTER COLUMN "waqfId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "governed_actions" ADD CONSTRAINT "governed_actions_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
