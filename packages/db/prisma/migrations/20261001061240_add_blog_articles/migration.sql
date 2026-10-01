-- CreateEnum
CREATE TYPE "BlogArticleStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateTable
CREATE TABLE "blog_articles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "illustration" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "status" "BlogArticleStatus" NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedByName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "blog_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blog_articles_slug_key" ON "blog_articles"("slug");

-- CreateIndex
CREATE INDEX "blog_articles_status_publishedAt_idx" ON "blog_articles"("status", "publishedAt");

-- AddForeignKey
ALTER TABLE "blog_articles" ADD CONSTRAINT "blog_articles_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_articles" ADD CONSTRAINT "blog_articles_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A published article must carry the human who approved it, and that
-- approver can never be the article's own author — enforced here, not
-- only in BlogService, same posture as governed_actions' checker_not_maker.
ALTER TABLE "blog_articles" ADD CONSTRAINT "blog_articles_published_has_reviewer"
  CHECK ("status" <> 'published' OR ("reviewedByUserId" IS NOT NULL AND "reviewedByName" IS NOT NULL AND "publishedAt" IS NOT NULL));

ALTER TABLE "blog_articles" ADD CONSTRAINT "blog_articles_reviewer_not_author"
  CHECK ("reviewedByUserId" IS NULL OR "reviewedByUserId" <> "createdByUserId");
