-- CreateEnum
CREATE TYPE "ZakahRecipientStatus" AS ENUM ('pending_approval', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "zakah_recipients" ADD COLUMN     "approvalActionId" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "pendingBankDetailsEncrypted" TEXT,
ADD COLUMN     "pendingCategories" "ZakahCategory"[] DEFAULT ARRAY[]::"ZakahCategory"[],
ADD COLUMN     "pendingChangeAt" TIMESTAMP(3),
ADD COLUMN     "pendingChangeByUserId" TEXT,
ADD COLUMN     "status" "ZakahRecipientStatus" NOT NULL DEFAULT 'pending_approval';

-- CreateIndex
CREATE UNIQUE INDEX "zakah_recipients_approvalActionId_key" ON "zakah_recipients"("approvalActionId");

-- AddForeignKey
ALTER TABLE "zakah_recipients" ADD CONSTRAINT "zakah_recipients_approvalActionId_fkey" FOREIGN KEY ("approvalActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_recipients" ADD CONSTRAINT "zakah_recipients_pendingChangeByUserId_fkey" FOREIGN KEY ("pendingChangeByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Hand-written database rules. No grandfathering: zakah hasn't
-- launched, so every existing recipient also starts awaiting approval.

ALTER TABLE "zakah_recipients"
  -- Approval details exist exactly when the recipient is approved.
  ADD CONSTRAINT "zakah_recipients_approval_consistent" CHECK (
    ("status" = 'approved' AND "approvedAt" IS NOT NULL AND "approvalActionId" IS NOT NULL)
    OR ("status" <> 'approved' AND "approvedAt" IS NULL AND "approvalActionId" IS NULL)
  ),
  -- A pending change is complete or absent, and only ever on an approved recipient.
  ADD CONSTRAINT "zakah_recipients_pending_change_consistent" CHECK (
    ("pendingChangeAt" IS NULL AND "pendingChangeByUserId" IS NULL AND "pendingBankDetailsEncrypted" IS NULL AND cardinality("pendingCategories") = 0)
    OR ("pendingChangeAt" IS NOT NULL AND "pendingChangeByUserId" IS NOT NULL AND cardinality("pendingCategories") > 0 AND "status" = 'approved')
  ),
  -- 100% of zakah reaches recipients: nobody is registered as an administrator.
  ADD CONSTRAINT "zakah_recipients_no_amilin" CHECK (
    NOT ('amilin' = ANY ("categories")) AND NOT ('amilin' = ANY ("pendingCategories"))
  );

-- Status only moves forward (pending → approved or rejected). Once a
-- recipient is approved, their categories and bank details change only by
-- applying the pending change a second person approved — never directly.
-- A rejected recipient's categories and bank details never change.
CREATE OR REPLACE FUNCTION zakah_recipients_check_update() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NOT (OLD."status" = 'pending_approval' AND NEW."status" IN ('approved', 'rejected')) THEN
    RAISE EXCEPTION 'A zakah recipient can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."status" <> 'pending_approval'
     AND (NEW."categories" IS DISTINCT FROM OLD."categories" OR NEW."bankDetailsEncrypted" IS DISTINCT FROM OLD."bankDetailsEncrypted") THEN
    IF OLD."status" = 'rejected'
       OR OLD."pendingChangeAt" IS NULL
       OR NEW."pendingChangeAt" IS NOT NULL
       OR NEW."categories" IS DISTINCT FROM OLD."pendingCategories"
       OR NEW."bankDetailsEncrypted" IS DISTINCT FROM COALESCE(OLD."pendingBankDetailsEncrypted", OLD."bankDetailsEncrypted") THEN
      RAISE EXCEPTION 'An approved zakah recipient''s categories and bank details change only through an approved change request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zakah_recipients_before_update
  BEFORE UPDATE ON "zakah_recipients"
  FOR EACH ROW EXECUTE FUNCTION zakah_recipients_check_update();
