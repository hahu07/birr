-- AlterTable
ALTER TABLE "clinic_spends" ADD COLUMN     "replacesAssetId" TEXT;

-- AlterTable
ALTER TABLE "clinic_waqfs" ADD COLUMN     "reserveShareActionId" TEXT,
ADD COLUMN     "reserveSharePercent" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "clinic_waqfs_reserveShareActionId_key" ON "clinic_waqfs"("reserveShareActionId");

-- AddForeignKey
ALTER TABLE "clinic_waqfs" ADD CONSTRAINT "clinic_waqfs_reserveShareActionId_fkey" FOREIGN KEY ("reserveShareActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_replacesAssetId_fkey" FOREIGN KEY ("replacesAssetId") REFERENCES "clinic_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==== Rules (2026-11-17, clinic slice 9: equipment replacement reserve) ====

-- Three accounts: the reserve's cash (running fund, set aside from the
-- endowment's income); what the reserve spent (running fund); and the
-- endowment capital the replacement equipment adds (endowment). A
-- replacement's entry balances within each pot: the running fund pays
-- (5200 / 1150) and the endowment gains the equipment (1500 / 3100).
INSERT INTO "clinic_ledger_accounts" ("id", "code", "name", "type", "pot", "isSystemDefault")
VALUES
  (gen_random_uuid()::text, '1150', 'Equipment replacement reserve', 'asset', 'running', true),
  (gen_random_uuid()::text, '5200', 'Equipment replaced from the reserve', 'expense', 'running', true),
  (gen_random_uuid()::text, '3100', 'Endowment capital from the reserve', 'equity', 'endowment', true);

ALTER TABLE "clinic_waqfs"
  ADD CONSTRAINT "clinic_waqfs_reserve_share_range" CHECK ("reserveSharePercent" BETWEEN 0 AND 100),
  -- Only ever set by an approved governed action.
  ADD CONSTRAINT "clinic_waqfs_reserve_share_approved" CHECK ("reserveSharePercent" = 0 OR "reserveShareActionId" IS NOT NULL);

-- A payment's kind says what it's for: a works stage names its project, an
-- investment its investment, a reserve replacement the asset it replaces,
-- equipment none of them.
ALTER TABLE "clinic_spends" DROP CONSTRAINT "clinic_spends_kind_target";
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_kind_target" CHECK (
  ("kind" = 'works_stage' AND "worksProjectId" IS NOT NULL AND "investmentId" IS NULL AND "replacesAssetId" IS NULL)
  OR ("kind" = 'investment' AND "investmentId" IS NOT NULL AND "worksProjectId" IS NULL AND "replacesAssetId" IS NULL)
  OR ("kind" = 'reserve_replacement' AND "replacesAssetId" IS NOT NULL AND "worksProjectId" IS NULL AND "investmentId" IS NULL)
  OR ("kind" = 'equipment' AND "worksProjectId" IS NULL AND "investmentId" IS NULL AND "replacesAssetId" IS NULL)
);

-- Equipment and reserve replacements both buy an asset once paid.
ALTER TABLE "clinic_spends" DROP CONSTRAINT "clinic_spends_asset";
ALTER TABLE "clinic_spends" ADD CONSTRAINT "clinic_spends_asset" CHECK (
  "assetId" IS NULL OR ("kind" IN ('equipment', 'reserve_replacement') AND "status" = 'paid')
);

-- One live replacement per asset.
CREATE UNIQUE INDEX "clinic_spends_one_replacement" ON "clinic_spends" ("replacesAssetId")
  WHERE "replacesAssetId" IS NOT NULL AND "status" <> 'rejected';

-- The same rule as before, plus: which asset it replaces never changes.
CREATE OR REPLACE FUNCTION clinic_spends_check_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic spend is never deleted';
  END IF;
  IF NEW."clinicWaqfId" IS DISTINCT FROM OLD."clinicWaqfId" OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."worksProjectId" IS DISTINCT FROM OLD."worksProjectId" OR NEW."investmentId" IS DISTINCT FROM OLD."investmentId"
     OR NEW."replacesAssetId" IS DISTINCT FROM OLD."replacesAssetId"
     OR NEW."payeeId" IS DISTINCT FROM OLD."payeeId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."description" IS DISTINCT FROM OLD."description"
     OR NEW."supportingReference" IS DISTINCT FROM OLD."supportingReference" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'A clinic spend''s payee, amount and purpose never change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'pending_approval' AND NEW."status" IN ('approved', 'rejected'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'paid')) THEN
    RAISE EXCEPTION 'A clinic spend can''t go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
