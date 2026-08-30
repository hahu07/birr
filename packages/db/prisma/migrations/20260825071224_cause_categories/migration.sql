-- AlterTable
ALTER TABLE "waqf_causes" ADD COLUMN     "causeCategoryId" TEXT;

-- CreateTable
CREATE TABLE "cause_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "cause_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cause_categories_name_key" ON "cause_categories"("name");

-- AddForeignKey
ALTER TABLE "waqf_causes" ADD CONSTRAINT "waqf_causes_causeCategoryId_fkey" FOREIGN KEY ("causeCategoryId") REFERENCES "cause_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
