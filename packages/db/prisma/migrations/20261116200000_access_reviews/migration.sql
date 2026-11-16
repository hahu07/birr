-- CreateTable
CREATE TABLE "access_reviews" (
    "id" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcomes" JSONB NOT NULL,
    "notes" TEXT,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,

    CONSTRAINT "access_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_reviews_completedAt_idx" ON "access_reviews"("completedAt");

-- AddForeignKey
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An access review is a record of what was attested, when: never edited
-- or deleted.
CREATE OR REPLACE FUNCTION access_reviews_insert_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'An access review is never changed or deleted — complete a new one instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER access_reviews_insert_only
  BEFORE UPDATE OR DELETE ON "access_reviews"
  FOR EACH ROW EXECUTE FUNCTION access_reviews_insert_only();
