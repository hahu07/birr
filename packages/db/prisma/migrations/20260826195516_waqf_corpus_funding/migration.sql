-- CreateEnum
CREATE TYPE "WaqfFundingPlan" AS ENUM ('lump_sum', 'installment');

-- AlterTable
ALTER TABLE "waqfs" ADD COLUMN     "corpusAmount" DECIMAL(65,30),
ADD COLUMN     "corpusCurrency" TEXT,
ADD COLUMN     "fundingPlan" "WaqfFundingPlan" NOT NULL DEFAULT 'lump_sum';

-- CreateTable
CREATE TABLE "corpus_minimums" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "minAmount" DECIMAL(65,30) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corpus_minimums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waqf_funding_settings" (
    "id" TEXT NOT NULL,
    "installmentMinimumPercent" DECIMAL(65,30) NOT NULL DEFAULT 25,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waqf_funding_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "corpus_minimums_currency_key" ON "corpus_minimums"("currency");
