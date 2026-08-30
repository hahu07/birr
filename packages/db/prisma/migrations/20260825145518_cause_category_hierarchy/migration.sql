-- AlterTable
ALTER TABLE "cause_categories" ADD COLUMN     "parentId" TEXT;

-- AddForeignKey
ALTER TABLE "cause_categories" ADD CONSTRAINT "cause_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "cause_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
