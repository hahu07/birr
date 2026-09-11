-- DropForeignKey
ALTER TABLE "vault_contributions" DROP CONSTRAINT "vault_contributions_donorId_fkey";

-- AlterTable
ALTER TABLE "vault_contributions" ALTER COLUMN "donorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "vault_contributions" ADD CONSTRAINT "vault_contributions_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "vault_donors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
