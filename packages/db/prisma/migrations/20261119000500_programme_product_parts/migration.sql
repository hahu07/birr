-- A waqf programme's product is fixed for good, and a product's own parts
-- are refused on any other product (shared layer step 3, deferred until a
-- second product existed; 2026-11-19). The product list in @birr/shared is
-- the source; programme-product-parts.spec.ts checks these rules agree.

-- 1. The product never changes, so the rules below can't be sidestepped.
CREATE OR REPLACE FUNCTION public.waqf_programmes_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A waqf programme is never deleted';
  END IF;
  IF NEW."slug" IS DISTINCT FROM OLD."slug" THEN
    RAISE EXCEPTION 'A waqf programme''s address (slug) never changes';
  END IF;
  IF NEW."product" IS DISTINCT FROM OLD."product" THEN
    RAISE EXCEPTION 'A waqf programme''s product never changes';
  END IF;
  IF OLD."status" = 'established' AND (
       NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."establishedAt" IS DISTINCT FROM OLD."establishedAt"
       OR NEW."establishedActionId" IS DISTINCT FROM OLD."establishedActionId"
       OR NEW."jurisdiction" IS DISTINCT FROM OLD."jurisdiction") THEN
    RAISE EXCEPTION 'An established waqf programme can''t be un-established, and its establishment and jurisdiction never change';
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. The equipment replacement reserve is a clinic's part.
ALTER TABLE "waqf_programmes" ADD CONSTRAINT "waqf_programmes_reserve_clinic_only"
  CHECK ("reserveSharePercent" = 0 OR "product" = 'clinic');

-- 3. A clinic's own tables take rows for clinics only.
CREATE OR REPLACE FUNCTION public.programme_part_clinic_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  p "WaqfProgrammeProduct";
BEGIN
  SELECT "product" INTO p FROM "waqf_programmes" WHERE "id" = NEW."programmeId";
  IF p IS DISTINCT FROM 'clinic' THEN
    RAISE EXCEPTION '% belong to clinics only, not a % programme', TG_TABLE_NAME, p;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "clinic_price_lists_clinic_only" BEFORE INSERT ON "clinic_price_lists"
  FOR EACH ROW EXECUTE FUNCTION programme_part_clinic_only();
CREATE TRIGGER "clinic_claims_clinic_only" BEFORE INSERT ON "clinic_claims"
  FOR EACH ROW EXECUTE FUNCTION programme_part_clinic_only();
CREATE TRIGGER "clinic_monthly_reports_clinic_only" BEFORE INSERT ON "clinic_monthly_reports"
  FOR EACH ROW EXECUTE FUNCTION programme_part_clinic_only();

-- 4. Works projects and endowment payments only of the kinds a product
-- lists (WAQF_PROGRAMME_PRODUCTS[product].spendKinds): a clinic every
-- kind; the need-based waqf only investment placements.
CREATE OR REPLACE FUNCTION public.programme_spend_kind_allowed(p "WaqfProgrammeProduct", k "ProgrammeSpendKind")
 RETURNS boolean
 LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p
    WHEN 'clinic' THEN true
    WHEN 'need_based' THEN k = 'investment'
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.programme_spends_kind_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  p "WaqfProgrammeProduct";
BEGIN
  SELECT "product" INTO p FROM "waqf_programmes" WHERE "id" = NEW."programmeId";
  IF NOT programme_spend_kind_allowed(p, NEW."kind") THEN
    RAISE EXCEPTION 'A % programme makes no % payments', p, NEW."kind";
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "programme_spends_kind_allowed" BEFORE INSERT ON "programme_spends"
  FOR EACH ROW EXECUTE FUNCTION programme_spends_kind_check();

CREATE OR REPLACE FUNCTION public.programme_works_kind_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  p "WaqfProgrammeProduct";
BEGIN
  SELECT "product" INTO p FROM "waqf_programmes" WHERE "id" = NEW."programmeId";
  IF NOT programme_spend_kind_allowed(p, 'works_stage') THEN
    RAISE EXCEPTION 'A % programme has no works projects', p;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "programme_works_projects_kind_allowed" BEFORE INSERT ON "programme_works_projects"
  FOR EACH ROW EXECUTE FUNCTION programme_works_kind_check();
