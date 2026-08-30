-- CreateEnum
CREATE TYPE "CauseSuggestionStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "cause_category_suggestions" (
    "id" TEXT NOT NULL,
    "proposedByFounderId" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "waqfId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CauseSuggestionStatus" NOT NULL DEFAULT 'pending',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "resultingCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cause_category_suggestions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "cause_category_suggestions" ADD CONSTRAINT "cause_category_suggestions_proposedByFounderId_fkey" FOREIGN KEY ("proposedByFounderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cause_category_suggestions" ADD CONSTRAINT "cause_category_suggestions_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cause_category_suggestions" ADD CONSTRAINT "cause_category_suggestions_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cause_category_suggestions" ADD CONSTRAINT "cause_category_suggestions_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cause_category_suggestions" ADD CONSTRAINT "cause_category_suggestions_resultingCategoryId_fkey" FOREIGN KEY ("resultingCategoryId") REFERENCES "cause_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
