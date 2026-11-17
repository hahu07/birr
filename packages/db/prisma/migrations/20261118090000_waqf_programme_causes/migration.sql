-- CreateTable
CREATE TABLE "waqf_programme_causes" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "causeCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waqf_programme_causes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waqf_programme_causes_causeCategoryId_idx" ON "waqf_programme_causes"("causeCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "waqf_programme_causes_programmeId_causeCategoryId_key" ON "waqf_programme_causes"("programmeId", "causeCategoryId");

-- AddForeignKey
ALTER TABLE "waqf_programme_causes" ADD CONSTRAINT "waqf_programme_causes_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "waqf_programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waqf_programme_causes" ADD CONSTRAINT "waqf_programme_causes_causeCategoryId_fkey" FOREIGN KEY ("causeCategoryId") REFERENCES "cause_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing clinics serve Healthcare, the clinic product's default cause.
INSERT INTO "waqf_programme_causes" ("id", "programmeId", "causeCategoryId")
SELECT gen_random_uuid()::text, p."id", c."id"
FROM "waqf_programmes" p
JOIN "cause_categories" c ON c."name" = 'Healthcare' AND c."deletedAt" IS NULL
WHERE p."product" = 'clinic'
ON CONFLICT DO NOTHING;
