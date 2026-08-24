-- Founder -> Foundation -> Waqf Fund -> Cause restructuring, step A
-- (expand, all-nullable). See the plan this was built from for full
-- context. This migration only adds new tables/columns — it does not
-- touch founder_isolation, does not drop waqf_founders, and does not
-- enforce NOT NULL anywhere. It's safe to land inert: no application
-- code is deployed against the new columns until the backfill script
-- (packages/db/scripts/backfill-foundations-and-causes.ts) has run and
-- migrations C/D have landed.

CREATE TYPE "FoundationStatus" AS ENUM ('active', 'suspended');

CREATE TABLE "foundations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "purpose" TEXT,
  "jurisdiction" TEXT,
  "status" "FoundationStatus" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "foundations_pkey" PRIMARY KEY ("id")
);

-- Join, mirroring waqf_founders' own precedent one level up — a
-- Foundation can be jointly established by more than one Founder
-- (confirmed with the project stakeholder, not assumed).
CREATE TABLE "foundation_founders" (
  "foundationId" TEXT NOT NULL,
  "founderId" TEXT NOT NULL,
  "contributionNote" TEXT,
  CONSTRAINT "foundation_founders_pkey" PRIMARY KEY ("foundationId", "founderId")
);
ALTER TABLE "foundation_founders" ADD CONSTRAINT "foundation_founders_foundationId_fkey"
  FOREIGN KEY ("foundationId") REFERENCES "foundations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "foundation_founders" ADD CONSTRAINT "foundation_founders_founderId_fkey"
  FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nullable until migration C (enforce_foundation_and_cause_not_null) —
-- every Waqf must belong to a Foundation once the backfill script has
-- run for all pre-existing rows.
ALTER TABLE "waqfs" ADD COLUMN "foundationId" TEXT;
ALTER TABLE "waqfs" ADD CONSTRAINT "waqfs_foundationId_fkey"
  FOREIGN KEY ("foundationId") REFERENCES "foundations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A theme/purpose within one Waqf Fund's deed, not a separate legal
-- endowment — plain CRUD, no governed_actions involvement.
CREATE TABLE "waqf_causes" (
  "id" TEXT NOT NULL,
  "waqfId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "waqf_causes_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "waqf_causes" ADD CONSTRAINT "waqf_causes_waqfId_fkey"
  FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "waqf_causes_waqfId_name_key" ON "waqf_causes"("waqfId", "name");

-- Nullable — a beneficiary can qualify under the fund generally without
-- being pinned to one specific cause up front.
ALTER TABLE "beneficiaries" ADD COLUMN "causeId" TEXT;
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_causeId_fkey"
  FOREIGN KEY ("causeId") REFERENCES "waqf_causes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Nullable until migration C — every payout must be traceable to a
-- specific cause once the backfill script has run for pre-existing rows.
ALTER TABLE "distributions" ADD COLUMN "causeId" TEXT;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_causeId_fkey"
  FOREIGN KEY ("causeId") REFERENCES "waqf_causes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
