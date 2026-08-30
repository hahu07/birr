-- AlterEnum
ALTER TYPE "InviteeKind" ADD VALUE 'co_founder';

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "foundationId" TEXT;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_foundationId_fkey" FOREIGN KEY ("foundationId") REFERENCES "foundations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
