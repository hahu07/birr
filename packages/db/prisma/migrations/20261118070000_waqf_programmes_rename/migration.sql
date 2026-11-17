-- A clinic waqf becomes the first "waqf programme" (2026-11-17, owner's
-- decision). The general parts (the waqf and its deed, pots and ledger,
-- gifts, assets, spending, investments) are renamed for any product; the
-- clinic's own parts (price lists, claims, monthly figures) keep their
-- names and now point at a programme. Names only: no behaviour changes,
-- and every rule below carries over as it was.

-- ---- Types

ALTER TYPE "ClinicWaqfDeedStatus" RENAME TO "WaqfProgrammeDeedStatus";
ALTER TYPE "ClinicWaqfStatus" RENAME TO "WaqfProgrammeStatus";
ALTER TYPE "ClinicPot" RENAME TO "WaqfProgrammePot";
ALTER TYPE "ClinicJournalEntrySource" RENAME TO "ProgrammeJournalEntrySource";
ALTER TYPE "ClinicGiftStatus" RENAME TO "ProgrammeGiftStatus";
ALTER TYPE "ClinicAssetKind" RENAME TO "ProgrammeAssetKind";
ALTER TYPE "ClinicAssetAcquisition" RENAME TO "ProgrammeAssetAcquisition";
ALTER TYPE "ClinicAssetStatus" RENAME TO "ProgrammeAssetStatus";
ALTER TYPE "ClinicWorksRoute" RENAME TO "ProgrammeWorksRoute";
ALTER TYPE "ClinicWorksStatus" RENAME TO "ProgrammeWorksStatus";
ALTER TYPE "ClinicSpendKind" RENAME TO "ProgrammeSpendKind";
ALTER TYPE "ClinicSpendStatus" RENAME TO "ProgrammeSpendStatus";
ALTER TYPE "ClinicInvestmentStatus" RENAME TO "ProgrammeInvestmentStatus";
ALTER TYPE "RecurringGiftKind" RENAME VALUE 'clinic' TO 'programme';

-- What kind of waqf programme this is; the clinic is the first.
CREATE TYPE "WaqfProgrammeProduct" AS ENUM ('clinic');

-- ---- Tables and columns

ALTER TABLE "clinic_waqf_deeds" RENAME TO "waqf_programme_deeds";
ALTER TABLE "clinic_waqfs" RENAME TO "waqf_programmes";
ALTER TABLE "clinic_ledger_accounts" RENAME TO "programme_ledger_accounts";
ALTER TABLE "clinic_journal_entry_lines" RENAME TO "programme_journal_entry_lines";
ALTER TABLE "clinic_journal_entries" RENAME TO "programme_journal_entries";
ALTER TABLE "clinic_gifts" RENAME TO "programme_gifts";
ALTER TABLE "clinic_assets" RENAME TO "programme_assets";
ALTER TABLE "clinic_works_projects" RENAME TO "programme_works_projects";
ALTER TABLE "clinic_spends" RENAME TO "programme_spends";
ALTER TABLE "clinic_investment_income" RENAME TO "programme_investment_income";
ALTER TABLE "clinic_investments" RENAME TO "programme_investments";

ALTER TABLE "waqf_programme_deeds" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "programme_journal_entries" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "programme_gifts" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "programme_assets" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "programme_works_projects" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "programme_spends" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "programme_investments" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "clinic_price_lists" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "clinic_claims" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "clinic_claim_lines" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "clinic_monthly_reports" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "recurring_gifts" RENAME COLUMN "clinicWaqfId" TO "programmeId";
ALTER TABLE "recurring_gifts" RENAME COLUMN "clinicPot" TO "programmePot";
ALTER TABLE "recurring_gifts" RENAME COLUMN "clinicDeedId" TO "programmeDeedId";
ALTER TABLE "recurring_gifts" RENAME COLUMN "clinicDeedTextHash" TO "programmeDeedTextHash";
ALTER TABLE "founders" RENAME COLUMN "clinicSupporter" TO "programmeSupporter";

ALTER TABLE "waqf_programmes" ADD COLUMN "product" "WaqfProgrammeProduct" NOT NULL DEFAULT 'clinic';
ALTER TABLE "waqf_programmes" ALTER COLUMN "product" DROP DEFAULT;
-- The operator, price lists, claims and monthly figures belong to clinics only.
ALTER TABLE "waqf_programmes" ADD CONSTRAINT "waqf_programmes_operator_clinic_only" CHECK ("operatorId" IS NULL OR "product" = 'clinic');

-- ---- Constraint, index and trigger names follow their tables and columns
DO $$
DECLARE
  prefixes text[][] := ARRAY[
    ARRAY['clinic_waqf_deeds_', 'waqf_programme_deeds_'],
    ARRAY['clinic_waqfs_', 'waqf_programmes_'],
    ARRAY['clinic_ledger_accounts_', 'programme_ledger_accounts_'],
    ARRAY['clinic_journal_entry_lines_', 'programme_journal_entry_lines_'],
    ARRAY['clinic_journal_entries_', 'programme_journal_entries_'],
    ARRAY['clinic_gifts_', 'programme_gifts_'],
    ARRAY['clinic_assets_', 'programme_assets_'],
    ARRAY['clinic_works_projects_', 'programme_works_projects_'],
    ARRAY['clinic_spends_', 'programme_spends_'],
    ARRAY['clinic_investment_income_', 'programme_investment_income_'],
    ARRAY['clinic_investments_', 'programme_investments_']
  ];
  parts text[][] := ARRAY[
    ARRAY['clinicWaqfId', 'programmeId'],
    ARRAY['clinicPot', 'programmePot'],
    ARRAY['clinicDeedTextHash', 'programmeDeedTextHash'],
    ARRAY['clinicDeedId', 'programmeDeedId'],
    ARRAY['clinicSupporter', 'programmeSupporter']
  ];
  r record;
  newname text;
  i int;
BEGIN
  FOR r IN SELECT c.relname AS tbl, x.conname AS name FROM pg_constraint x JOIN pg_class c ON c.oid = x.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' LOOP
    newname := r.name;
    FOR i IN 1 .. array_length(prefixes, 1) LOOP
      IF left(newname, length(prefixes[i][1])) = prefixes[i][1] THEN newname := prefixes[i][2] || substr(newname, length(prefixes[i][1]) + 1); END IF;
    END LOOP;
    FOR i IN 1 .. array_length(parts, 1) LOOP newname := replace(newname, parts[i][1], parts[i][2]); END LOOP;
    IF newname <> r.name THEN EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.name, newname); END IF;
  END LOOP;
  FOR r IN SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public' LOOP
    newname := r.name;
    FOR i IN 1 .. array_length(prefixes, 1) LOOP
      IF left(newname, length(prefixes[i][1])) = prefixes[i][1] THEN newname := prefixes[i][2] || substr(newname, length(prefixes[i][1]) + 1); END IF;
    END LOOP;
    FOR i IN 1 .. array_length(parts, 1) LOOP newname := replace(newname, parts[i][1], parts[i][2]); END LOOP;
    IF newname <> r.name THEN EXECUTE format('ALTER INDEX %I RENAME TO %I', r.name, newname); END IF;
  END LOOP;
  FOR r IN SELECT c.relname AS tbl, t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal LOOP
    newname := r.name;
    FOR i IN 1 .. array_length(prefixes, 1) LOOP
      IF left(newname, length(prefixes[i][1])) = prefixes[i][1] THEN newname := prefixes[i][2] || substr(newname, length(prefixes[i][1]) + 1); END IF;
    END LOOP;
    IF newname <> r.name THEN EXECUTE format('ALTER TRIGGER %I ON %I RENAME TO %I', r.name, r.tbl, newname); END IF;
  END LOOP;
END $$;

-- ---- Rule functions: renamed with their tables, and their bodies (which
-- name tables and columns as text) rewritten to match.

ALTER FUNCTION clinic_assets_check_change() RENAME TO programme_assets_check_change;
CREATE OR REPLACE FUNCTION public.programme_assets_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A programme asset is never deleted';
  END IF;
  IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."name" IS DISTINCT FROM OLD."name"
     OR NEW."value" IS DISTINCT FROM OLD."value"
     OR NEW."valuationNote" IS DISTINCT FROM OLD."valuationNote"
     OR NEW."donorName" IS DISTINCT FROM OLD."donorName"
     OR NEW."acquiredOn" IS DISTINCT FROM OLD."acquiredOn"
     OR NEW."acquisition" IS DISTINCT FROM OLD."acquisition"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'What a programme asset is, and its value, never change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'proposed' AND NEW."status" IN ('active', 'rejected'))
       OR (OLD."status" = 'active' AND NEW."status" = 'disposed')) THEN
    RAISE EXCEPTION 'A programme asset can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."status" IN ('rejected', 'disposed') AND (
       NEW."location" IS DISTINCT FROM OLD."location" OR NEW."serialNumber" IS DISTINCT FROM OLD."serialNumber"
       OR NEW."warrantyUntil" IS DISTINCT FROM OLD."warrantyUntil" OR NEW."lastServicedOn" IS DISTINCT FROM OLD."lastServicedOn"
       OR NEW."nextServiceDue" IS DISTINCT FROM OLD."nextServiceDue" OR NEW."description" IS DISTINCT FROM OLD."description") THEN
    RAISE EXCEPTION 'A % programme asset can''t be changed', OLD."status";
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_claim_lines_check_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  claim RECORD;
BEGIN
  SELECT "programmeId", "status", "period" INTO claim FROM "clinic_claims" WHERE "id" = NEW."claimId";
  IF claim."programmeId" IS DISTINCT FROM NEW."programmeId" THEN
    RAISE EXCEPTION 'A claim line belongs to its claim''s clinic';
  END IF;
  IF claim."status" <> 'submitted' THEN
    RAISE EXCEPTION 'Lines can''t be added to a % claim', claim."status";
  END IF;
  IF to_char(NEW."visitDate", 'YYYY-MM') <> claim."period" THEN
    RAISE EXCEPTION 'A claim line''s visit (%) must fall in the claim''s month (%)', NEW."visitDate", claim."period";
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_claim_lines_check_totals()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM clinic_claims_assert_totals(NEW."claimId");
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_claim_lines_refuse_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'A clinic claim line is never changed or deleted';
END;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_claims_assert_totals(claim_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  c RECORD;
  l RECORD;
BEGIN
  SELECT * INTO c FROM "clinic_claims" WHERE "id" = claim_id;
  SELECT count(*) AS n, coalesce(sum("price"), 0) AS price, coalesce(sum("patientPaid"), 0) AS paid,
         coalesce(sum("subsidy"), 0) AS subsidy, coalesce(sum("subsidy") FILTER (WHERE "zakahEligible"), 0) AS zakah
    INTO l FROM "clinic_claim_lines" WHERE "claimId" = claim_id;
  IF l.n <> c."lineCount" OR l.price <> c."totalPrice" OR l.paid <> c."patientPaid"
     OR l.subsidy <> c."subsidyTotal" OR l.zakah <> c."zakahAmount" THEN
    RAISE EXCEPTION 'Clinic claim %''s totals don''t match its lines', claim_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_claims_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic claim is never deleted';
  END IF;
  IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId" OR NEW."period" IS DISTINCT FROM OLD."period"
     OR NEW."operatorId" IS DISTINCT FROM OLD."operatorId" OR NEW."priceListId" IS DISTINCT FROM OLD."priceListId"
     OR NEW."lineCount" IS DISTINCT FROM OLD."lineCount" OR NEW."totalPrice" IS DISTINCT FROM OLD."totalPrice"
     OR NEW."patientPaid" IS DISTINCT FROM OLD."patientPaid" OR NEW."subsidyTotal" IS DISTINCT FROM OLD."subsidyTotal"
     OR NEW."runningFundAmount" IS DISTINCT FROM OLD."runningFundAmount" OR NEW."zakahAmount" IS DISTINCT FROM OLD."zakahAmount"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'A clinic claim''s lines and totals never change; discard it and upload a corrected one';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'submitted' AND NEW."status" IN ('approved', 'rejected', 'discarded'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'paid')) THEN
    RAISE EXCEPTION 'A clinic claim can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."zakahDistributionId" IS NOT NULL AND NEW."zakahDistributionId" IS DISTINCT FROM OLD."zakahDistributionId" THEN
    RAISE EXCEPTION 'A clinic claim''s zakah distribution never changes once linked';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_claims_check_totals()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM clinic_claims_assert_totals(NEW."id");
  RETURN NULL;
END;
$function$;

ALTER FUNCTION clinic_gifts_check_change() RENAME TO programme_gifts_check_change;
CREATE OR REPLACE FUNCTION public.programme_gifts_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'programme_gifts rows are never deleted';
  END IF;
  IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId"
     OR NEW."pot" IS DISTINCT FROM OLD."pot"
     OR NEW."donorId" IS DISTINCT FROM OLD."donorId"
     OR NEW."founderId" IS DISTINCT FROM OLD."founderId"
     OR NEW."initiatedByUserId" IS DISTINCT FROM OLD."initiatedByUserId"
     OR NEW."recurringGiftId" IS DISTINCT FROM OLD."recurringGiftId"
     OR NEW."recurringPeriod" IS DISTINCT FROM OLD."recurringPeriod"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."feeCover" IS DISTINCT FROM OLD."feeCover"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."settlementSubaccount" IS DISTINCT FROM OLD."settlementSubaccount"
     OR NEW."deedId" IS DISTINCT FROM OLD."deedId"
     OR NEW."deedTextHash" IS DISTINCT FROM OLD."deedTextHash"
     OR NEW."contactEmail" IS DISTINCT FROM OLD."contactEmail"
     OR NEW."contactWhatsApp" IS DISTINCT FROM OLD."contactWhatsApp" THEN
    RAISE EXCEPTION 'A programme gift''s amount, pot, giver, deed and settlement account never change';
  END IF;
  IF OLD."status" <> 'pending' AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."providerReference" IS DISTINCT FROM OLD."providerReference") THEN
    RAISE EXCEPTION 'A programme gift that is % can''t change', OLD."status";
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION clinic_gifts_check_insert() RENAME TO programme_gifts_check_insert;
CREATE OR REPLACE FUNCTION public.programme_gifts_check_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "waqf_programmes" WHERE "id" = NEW."programmeId" AND "status" = 'established') THEN
    RAISE EXCEPTION 'Waqf programme % isn''t established, so it can''t take gifts', NEW."programmeId";
  END IF;
  IF NEW."pot" = 'endowment' AND NOT EXISTS (
       SELECT 1 FROM "waqf_programme_deeds"
       WHERE "id" = NEW."deedId" AND "programmeId" = NEW."programmeId" AND "status" = 'approved' AND "textHash" = NEW."deedTextHash") THEN
    RAISE EXCEPTION 'An endowment gift must accept the waqf programme''s approved deed, as worded';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION clinic_investment_income_check() RENAME TO programme_investment_income_check;
CREATE OR REPLACE FUNCTION public.programme_investment_income_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Programme investment income is append-only; record an offsetting entry instead';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "programme_investments" WHERE "id" = NEW."investmentId" AND "status" IN ('placed', 'returned')) THEN
    RAISE EXCEPTION 'Income can only be recorded for an investment that was placed';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION clinic_investments_check_change() RENAME TO programme_investments_check_change;
CREATE OR REPLACE FUNCTION public.programme_investments_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A programme investment is never deleted';
  END IF;
  IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId" OR NEW."counterpartyId" IS DISTINCT FROM OLD."counterpartyId"
     OR NEW."name" IS DISTINCT FROM OLD."name" OR NEW."instrumentType" IS DISTINCT FROM OLD."instrumentType"
     OR NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."businessDescription" IS DISTINCT FROM OLD."businessDescription"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'What a programme investment is, and its amount, never change';
  END IF;
  IF OLD."shariahDecidedByUserId" IS NOT NULL AND (
       NEW."shariahDecidedByUserId" IS DISTINCT FROM OLD."shariahDecidedByUserId" OR NEW."shariahDecidedAt" IS DISTINCT FROM OLD."shariahDecidedAt"
       OR NEW."shariahNote" IS DISTINCT FROM OLD."shariahNote") THEN
    RAISE EXCEPTION 'A programme investment''s Shariah decision never changes';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'pending_shariah_review' AND NEW."status" IN ('shariah_approved', 'shariah_rejected'))
       OR (OLD."status" = 'shariah_approved' AND NEW."status" = 'placed')
       OR (OLD."status" = 'placed' AND NEW."status" = 'returned')) THEN
    RAISE EXCEPTION 'A programme investment can''t go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION clinic_journal_append_only() RENAME TO programme_journal_append_only;
CREATE OR REPLACE FUNCTION public.programme_journal_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'The programme ledger is append-only — post an offsetting entry instead';
END;
$function$;

ALTER FUNCTION clinic_journal_check_balanced() RENAME TO programme_journal_check_balanced;
CREATE OR REPLACE FUNCTION public.programme_journal_check_balanced()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  entry_id TEXT;
  unbalanced TEXT;
  line_count INT;
BEGIN
  IF TG_TABLE_NAME = 'programme_journal_entries' THEN
    entry_id := NEW."id";
  ELSE
    entry_id := NEW."journalEntryId";
  END IF;
  SELECT count(*) INTO line_count FROM "programme_journal_entry_lines" WHERE "journalEntryId" = entry_id;
  IF line_count < 2 THEN
    RAISE EXCEPTION 'Programme journal entry % needs at least a debit and a credit', entry_id;
  END IF;
  SELECT a."pot"::text INTO unbalanced
    FROM "programme_journal_entry_lines" l
    JOIN "programme_ledger_accounts" a ON a."id" = l."ledgerAccountId"
    WHERE l."journalEntryId" = entry_id
    GROUP BY a."pot"
    HAVING sum(l."debit") <> sum(l."credit")
    LIMIT 1;
  IF unbalanced IS NOT NULL THEN
    RAISE EXCEPTION 'Programme journal entry % doesn''t balance within the % pot; the endowment and the running fund never mix', entry_id, unbalanced;
  END IF;
  RETURN NULL;
END;
$function$;

ALTER FUNCTION clinic_ledger_accounts_check_change() RENAME TO programme_ledger_accounts_check_change;
CREATE OR REPLACE FUNCTION public.programme_ledger_accounts_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Programme ledger accounts are never deleted';
  END IF;
  IF NEW."code" IS DISTINCT FROM OLD."code" OR NEW."type" IS DISTINCT FROM OLD."type" OR NEW."pot" IS DISTINCT FROM OLD."pot" THEN
    RAISE EXCEPTION 'A programme ledger account''s code, type and pot never change';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_monthly_reports_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic monthly report is never deleted';
  END IF;
  IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId" OR NEW."period" IS DISTINCT FROM OLD."period"
     OR NEW."visits" IS DISTINCT FROM OLD."visits" OR NEW."childrenImmunised" IS DISTINCT FROM OLD."childrenImmunised"
     OR NEW."testsRun" IS DISTINCT FROM OLD."testsRun" OR NEW."referrals" IS DISTINCT FROM OLD."referrals"
     OR NEW."recordedByUserId" IS DISTINCT FROM OLD."recordedByUserId" THEN
    RAISE EXCEPTION 'A clinic monthly report''s figures never change; discard the draft and record it again';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (OLD."status" = 'draft' AND NEW."status" IN ('published', 'discarded')) THEN
    RAISE EXCEPTION 'A clinic monthly report can''t go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_price_lists_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A clinic price list version is never deleted';
  END IF;
  IF NEW."content" IS DISTINCT FROM OLD."content" OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."programmeId" IS DISTINCT FROM OLD."programmeId"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'A price list version''s content never changes; draft a new version instead';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'draft' AND NEW."status" IN ('approved', 'discarded'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'superseded')) THEN
    RAISE EXCEPTION 'A price list version can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."approvedActionId" IS NOT NULL AND (NEW."approvedActionId" IS DISTINCT FROM OLD."approvedActionId" OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt") THEN
    RAISE EXCEPTION 'A price list version''s approval never changes';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION clinic_spends_check_change() RENAME TO programme_spends_check_change;
CREATE OR REPLACE FUNCTION public.programme_spends_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A programme spend is never deleted';
  END IF;
  IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId" OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."worksProjectId" IS DISTINCT FROM OLD."worksProjectId" OR NEW."investmentId" IS DISTINCT FROM OLD."investmentId"
     OR NEW."replacesAssetId" IS DISTINCT FROM OLD."replacesAssetId"
     OR NEW."payeeId" IS DISTINCT FROM OLD."payeeId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."description" IS DISTINCT FROM OLD."description"
     OR NEW."supportingReference" IS DISTINCT FROM OLD."supportingReference" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'A programme spend''s payee, amount and purpose never change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'pending_approval' AND NEW."status" IN ('approved', 'rejected'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'paid')) THEN
    RAISE EXCEPTION 'A programme spend can''t go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION clinic_waqf_deeds_check_change() RENAME TO waqf_programme_deeds_check_change;
CREATE OR REPLACE FUNCTION public.waqf_programme_deeds_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A waqf programme deed version is never deleted';
  END IF;
  IF NEW."text" IS DISTINCT FROM OLD."text"
     OR NEW."textHash" IS DISTINCT FROM OLD."textHash"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."programmeId" IS DISTINCT FROM OLD."programmeId"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'A deed version''s wording never changes; draft a new version instead';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'draft' AND NEW."status" IN ('approved', 'discarded'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'superseded')) THEN
    RAISE EXCEPTION 'A deed version can''t go from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."approvedActionId" IS NOT NULL AND (
       NEW."approvedActionId" IS DISTINCT FROM OLD."approvedActionId"
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt") THEN
    RAISE EXCEPTION 'A deed version''s approval never changes';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION clinic_waqfs_check_change() RENAME TO waqf_programmes_check_change;
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

ALTER FUNCTION clinic_works_check_change() RENAME TO programme_works_check_change;
CREATE OR REPLACE FUNCTION public.programme_works_check_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A programme works project is never deleted';
  END IF;
  IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId" OR NEW."route" IS DISTINCT FROM OLD."route"
     OR NEW."contractorId" IS DISTINCT FROM OLD."contractorId" OR NEW."budget" IS DISTINCT FROM OLD."budget"
     OR NEW."budgetNote" IS DISTINCT FROM OLD."budgetNote" OR NEW."name" IS DISTINCT FROM OLD."name" THEN
    RAISE EXCEPTION 'A programme works project''s route, contractor and budget never change; propose a new one';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (OLD."status" = 'proposed' AND NEW."status" IN ('approved', 'rejected')) THEN
    RAISE EXCEPTION 'A programme works project can''t go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$function$;

