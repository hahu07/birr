-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actorFounderId" TEXT;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorFounderId_fkey" FOREIGN KEY ("actorFounderId") REFERENCES "founders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
