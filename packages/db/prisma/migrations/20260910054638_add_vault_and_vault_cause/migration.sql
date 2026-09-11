-- CreateEnum
CREATE TYPE "VaultType" AS ENUM ('investment', 'project');

-- CreateEnum
CREATE TYPE "VaultStatus" AS ENUM ('draft', 'open', 'closed', 'archived');

-- CreateTable
CREATE TABLE "vaults" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "type" "VaultType" NOT NULL,
    "status" "VaultStatus" NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL,
    "targetAmount" DECIMAL(65,30),
    "jurisdiction" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_causes" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "causeCategoryId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vault_causes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vaults_slug_key" ON "vaults"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vault_causes_vaultId_name_key" ON "vault_causes"("vaultId", "name");

-- AddForeignKey
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_causes" ADD CONSTRAINT "vault_causes_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_causes" ADD CONSTRAINT "vault_causes_causeCategoryId_fkey" FOREIGN KEY ("causeCategoryId") REFERENCES "cause_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

