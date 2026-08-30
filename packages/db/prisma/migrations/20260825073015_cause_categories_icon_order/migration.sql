-- AlterTable
ALTER TABLE "cause_categories" ADD COLUMN     "icon" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;
