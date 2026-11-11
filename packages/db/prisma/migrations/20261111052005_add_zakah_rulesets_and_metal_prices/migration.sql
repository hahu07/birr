-- CreateEnum
CREATE TYPE "ZakahMadhhab" AS ENUM ('maliki', 'hanafi', 'shafii', 'hanbali');

-- CreateEnum
CREATE TYPE "ZakahRulesetStatus" AS ENUM ('draft', 'approved', 'superseded');

-- CreateTable
CREATE TABLE "zakah_rulesets" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "madhhab" "ZakahMadhhab" NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "rulings" JSONB NOT NULL,
    "status" "ZakahRulesetStatus" NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedGovernedActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zakah_rulesets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zakah_metal_prices" (
    "id" TEXT NOT NULL,
    "goldPerGram" DECIMAL(65,30) NOT NULL,
    "silverPerGram" DECIMAL(65,30) NOT NULL,
    "asOf" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "governedActionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zakah_metal_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zakah_rulesets_approvedGovernedActionId_key" ON "zakah_rulesets"("approvedGovernedActionId");

-- CreateIndex
CREATE INDEX "zakah_rulesets_status_idx" ON "zakah_rulesets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "zakah_rulesets_key_version_key" ON "zakah_rulesets"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "zakah_metal_prices_governedActionId_key" ON "zakah_metal_prices"("governedActionId");

-- CreateIndex
CREATE INDEX "zakah_metal_prices_asOf_idx" ON "zakah_metal_prices"("asOf");

-- AddForeignKey
ALTER TABLE "zakah_rulesets" ADD CONSTRAINT "zakah_rulesets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_rulesets" ADD CONSTRAINT "zakah_rulesets_approvedGovernedActionId_fkey" FOREIGN KEY ("approvedGovernedActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_metal_prices" ADD CONSTRAINT "zakah_metal_prices_governedActionId_fkey" FOREIGN KEY ("governedActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Database-level rules (hand-written). The app layer checks these
-- too, for clear errors, but these are the real guarantee: a ruleset or
-- price that payers have been shown must stay exactly as it was, so any
-- stored calculation or receipt can be explained later.

ALTER TABLE "zakah_rulesets"
  ADD CONSTRAINT "zakah_rulesets_version_positive" CHECK ("version" >= 1),
  -- Approval details exist exactly when the ruleset has been approved.
  ADD CONSTRAINT "zakah_rulesets_approval_consistent" CHECK (
    ("status" = 'draft' AND "approvedAt" IS NULL AND "approvedGovernedActionId" IS NULL)
    OR ("status" <> 'draft' AND "approvedAt" IS NOT NULL AND "approvedGovernedActionId" IS NOT NULL)
  );

-- At most one draft and one live (approved) version per key.
CREATE UNIQUE INDEX "zakah_rulesets_one_draft_per_key" ON "zakah_rulesets"("key") WHERE "status" = 'draft';
CREATE UNIQUE INDEX "zakah_rulesets_one_approved_per_key" ON "zakah_rulesets"("key") WHERE "status" = 'approved';

-- A draft may be edited, or approved. An approved version may only be
-- superseded (status alone). A superseded version never changes again.
CREATE OR REPLACE FUNCTION zakah_rulesets_check_update() RETURNS trigger AS $$
BEGIN
  IF NEW."key" IS DISTINCT FROM OLD."key"
     OR NEW."madhhab" IS DISTINCT FROM OLD."madhhab"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'A zakah ruleset''s key, madhhab, version and creator never change';
  END IF;

  IF OLD."status" = 'draft' THEN
    IF NEW."status" NOT IN ('draft', 'approved') THEN
      RAISE EXCEPTION 'A draft zakah ruleset can only be edited or approved';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'approved'
     AND NEW."status" = 'superseded'
     AND NEW."label" IS NOT DISTINCT FROM OLD."label"
     AND NEW."rulings" IS NOT DISTINCT FROM OLD."rulings"
     AND NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt"
     AND NEW."approvedGovernedActionId" IS NOT DISTINCT FROM OLD."approvedGovernedActionId" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'An approved zakah ruleset can''t be edited — draft a new version instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zakah_rulesets_before_update
  BEFORE UPDATE ON "zakah_rulesets"
  FOR EACH ROW EXECUTE FUNCTION zakah_rulesets_check_update();

CREATE OR REPLACE FUNCTION zakah_rulesets_reject_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'zakah_rulesets rows are never deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zakah_rulesets_no_delete
  BEFORE DELETE ON "zakah_rulesets"
  FOR EACH ROW EXECUTE FUNCTION zakah_rulesets_reject_delete();

ALTER TABLE "zakah_metal_prices"
  ADD CONSTRAINT "zakah_metal_prices_positive" CHECK ("goldPerGram" > 0 AND "silverPerGram" > 0);

CREATE OR REPLACE FUNCTION zakah_metal_prices_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'zakah_metal_prices rows are append-only — approve a new price instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zakah_metal_prices_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "zakah_metal_prices"
  FOR EACH ROW EXECUTE FUNCTION zakah_metal_prices_append_only();
