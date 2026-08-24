-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('real_estate', 'cash', 'securities', 'movable', 'intellectual_property', 'other');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('active', 'disposed');

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "waqfId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "estimatedValue" DECIMAL(65,30) NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'active',
    "disposedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
