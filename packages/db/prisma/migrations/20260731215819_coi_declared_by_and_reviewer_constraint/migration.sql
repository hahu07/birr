/*
  Warnings:

  - You are about to drop the column `reviewedBy` on the `conflict_of_interest_declarations` table. All the data in the column will be lost.
  - Added the required column `declaredByUserId` to the `conflict_of_interest_declarations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "conflict_of_interest_declarations" DROP COLUMN "reviewedBy",
ADD COLUMN     "declaredByUserId" TEXT NOT NULL,
ADD COLUMN     "reviewedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "conflict_of_interest_declarations" ADD CONSTRAINT "conflict_of_interest_declarations_declaredByUserId_fkey" FOREIGN KEY ("declaredByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_of_interest_declarations" ADD CONSTRAINT "conflict_of_interest_declarations_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A declarant can never also be their own reviewer. Same pattern as
-- checker_not_maker on governed_actions — this is the real enforcement,
-- the app-layer check in ConflictOfInterestDeclarationsService.review()
-- is a fail-fast duplicate, not the guarantee itself.
ALTER TABLE "conflict_of_interest_declarations"
  ADD CONSTRAINT "coi_reviewer_not_declarant"
  CHECK ("reviewedByUserId" IS NULL OR "declaredByUserId" IS NULL OR "reviewedByUserId" <> "declaredByUserId");
