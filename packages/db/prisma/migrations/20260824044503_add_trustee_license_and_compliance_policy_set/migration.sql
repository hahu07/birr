-- CreateEnum
CREATE TYPE "TrusteeLicenseStatus" AS ENUM ('active', 'pending', 'suspended', 'expired');

-- CreateTable
CREATE TABLE "trustee_licenses" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "status" "TrusteeLicenseStatus" NOT NULL DEFAULT 'pending',
    "licensingAuthority" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trustee_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_policy_sets" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "frameworkName" TEXT NOT NULL,
    "referenceUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_policy_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_policy_sets_jurisdiction_key" ON "compliance_policy_sets"("jurisdiction");
