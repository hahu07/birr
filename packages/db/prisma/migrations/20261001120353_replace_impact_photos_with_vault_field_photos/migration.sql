/*
  Warnings:

  - You are about to drop the `impact_photos` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "impact_photos" DROP CONSTRAINT "impact_photos_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "impact_photos" DROP CONSTRAINT "impact_photos_reviewedByUserId_fkey";

-- DropTable
DROP TABLE "impact_photos";

-- CreateTable
CREATE TABLE "vault_field_photos" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "vaultDistributionId" TEXT,
    "vaultMilestoneId" TEXT,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT,
    "consentConfirmed" BOOLEAN NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3),
    "hiddenByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vault_field_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_field_photos_vaultId_idx" ON "vault_field_photos"("vaultId");

-- CreateIndex
CREATE INDEX "vault_field_photos_vaultDistributionId_idx" ON "vault_field_photos"("vaultDistributionId");

-- CreateIndex
CREATE INDEX "vault_field_photos_vaultMilestoneId_idx" ON "vault_field_photos"("vaultMilestoneId");

-- AddForeignKey
ALTER TABLE "vault_field_photos" ADD CONSTRAINT "vault_field_photos_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_field_photos" ADD CONSTRAINT "vault_field_photos_vaultDistributionId_fkey" FOREIGN KEY ("vaultDistributionId") REFERENCES "vault_distributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_field_photos" ADD CONSTRAINT "vault_field_photos_vaultMilestoneId_fkey" FOREIGN KEY ("vaultMilestoneId") REFERENCES "vault_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_field_photos" ADD CONSTRAINT "vault_field_photos_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_field_photos" ADD CONSTRAINT "vault_field_photos_hiddenByUserId_fkey" FOREIGN KEY ("hiddenByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A field photo documents exactly ONE real event of its vault: a delivery
-- (distribution) or a project step (milestone). Enforced here, not only in
-- FieldPhotosService. (The event rows are soft-deleted, never hard-deleted,
-- so the ON DELETE SET NULL above can't be reached in practice; if it ever
-- were, this CHECK would refuse it rather than orphan the photo.)
ALTER TABLE "vault_field_photos" ADD CONSTRAINT "vault_field_photos_exactly_one_event"
  CHECK (("vaultDistributionId" IS NOT NULL) <> ("vaultMilestoneId" IS NOT NULL));

-- Nothing exists without the uploader's consent/rights attestation.
ALTER TABLE "vault_field_photos" ADD CONSTRAINT "vault_field_photos_consent_confirmed"
  CHECK ("consentConfirmed" = true);

-- The retired impact_photo.publish permission (manual, approval-gated
-- marketing photos — replaced by automatic field photos above). Removed
-- unless some governed action already references it, in which case the row
-- must stay as history.
DELETE FROM "role_permissions"
  WHERE "permissionId" IN (
    SELECT p."id" FROM "permissions" p
    WHERE p."key" = 'impact_photo.publish'
      AND NOT EXISTS (SELECT 1 FROM "governed_actions" g WHERE g."permissionId" = p."id")
  );
DELETE FROM "permissions" p
  WHERE p."key" = 'impact_photo.publish'
    AND NOT EXISTS (SELECT 1 FROM "governed_actions" g WHERE g."permissionId" = p."id");
