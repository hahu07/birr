-- CreateIndex
-- Safe: contributions table has zero rows at the time of this migration
-- (verified directly before writing this file) — no duplicate-value
-- risk despite the interactive-only warning Prisma's CLI raises for
-- this class of change.
CREATE UNIQUE INDEX "contributions_providerReference_key" ON "contributions"("providerReference");
