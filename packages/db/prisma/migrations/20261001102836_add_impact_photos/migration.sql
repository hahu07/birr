-- CreateTable
CREATE TABLE "impact_photos" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "altText" TEXT NOT NULL,
    "credit" TEXT,
    "consentConfirmed" BOOLEAN NOT NULL,
    "status" "BlogArticleStatus" NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedByName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "impact_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impact_photos_status_publishedAt_idx" ON "impact_photos"("status", "publishedAt");

-- AddForeignKey
ALTER TABLE "impact_photos" ADD CONSTRAINT "impact_photos_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impact_photos" ADD CONSTRAINT "impact_photos_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same guarantees as blog_articles, enforced by the database, not only by
-- ImpactPhotosService: a published photo must carry the human who approved
-- it, that approver can never be the uploader, and nothing can exist
-- without the uploader's consent/rights attestation.
ALTER TABLE "impact_photos" ADD CONSTRAINT "impact_photos_published_has_reviewer"
  CHECK ("status" <> 'published' OR ("reviewedByUserId" IS NOT NULL AND "reviewedByName" IS NOT NULL AND "publishedAt" IS NOT NULL));

ALTER TABLE "impact_photos" ADD CONSTRAINT "impact_photos_reviewer_not_uploader"
  CHECK ("reviewedByUserId" IS NULL OR "reviewedByUserId" <> "createdByUserId");

ALTER TABLE "impact_photos" ADD CONSTRAINT "impact_photos_consent_confirmed"
  CHECK ("consentConfirmed" = true);
