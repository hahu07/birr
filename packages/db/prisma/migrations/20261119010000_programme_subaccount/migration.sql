-- AlterTable
ALTER TABLE "waqf_programmes" ADD COLUMN     "paystackSubaccountActionId" TEXT,
ADD COLUMN     "paystackSubaccountCode" TEXT,
ADD COLUMN     "paystackSubaccountSetAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "waqf_programmes_paystackSubaccountActionId_key" ON "waqf_programmes"("paystackSubaccountActionId");

-- AddForeignKey
ALTER TABLE "waqf_programmes" ADD CONSTRAINT "waqf_programmes_paystackSubaccountActionId_fkey" FOREIGN KEY ("paystackSubaccountActionId") REFERENCES "governed_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A Paystack subaccount code (ACCT_ and letters or digits), set only with
-- the approval that set it (owner's decision: two people decide where a
-- waqf's money settles).
ALTER TABLE "waqf_programmes" ADD CONSTRAINT "waqf_programmes_subaccount_code_format"
  CHECK ("paystackSubaccountCode" IS NULL OR "paystackSubaccountCode" ~ '^ACCT_[A-Za-z0-9]+$');
ALTER TABLE "waqf_programmes" ADD CONSTRAINT "waqf_programmes_subaccount_approved"
  CHECK (("paystackSubaccountCode" IS NULL) = ("paystackSubaccountActionId" IS NULL)
     AND ("paystackSubaccountCode" IS NULL) = ("paystackSubaccountSetAt" IS NULL));

-- Changing the code needs a new approval; it's never cleared.
CREATE OR REPLACE FUNCTION public.waqf_programmes_subaccount_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."paystackSubaccountCode" IS DISTINCT FROM OLD."paystackSubaccountCode" THEN
    IF NEW."paystackSubaccountCode" IS NULL THEN
      RAISE EXCEPTION 'A waqf programme''s subaccount is never cleared, only changed by a new approval';
    END IF;
    IF NEW."paystackSubaccountActionId" IS NOT DISTINCT FROM OLD."paystackSubaccountActionId" THEN
      RAISE EXCEPTION 'A waqf programme''s subaccount changes only with a new approval';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "waqf_programmes_subaccount_check" BEFORE UPDATE ON "waqf_programmes"
  FOR EACH ROW EXECUTE FUNCTION waqf_programmes_subaccount_check();
