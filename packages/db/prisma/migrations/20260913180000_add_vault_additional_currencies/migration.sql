-- AlterTable
ALTER TABLE "vaults" ADD COLUMN     "additionalCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[];

