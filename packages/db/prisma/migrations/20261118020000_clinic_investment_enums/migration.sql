-- Clinic waqf investments (2026-11-17, slice 5c). On its own: Postgres
-- won't use a new enum value in the migration that adds it.
ALTER TYPE "ClinicSpendKind" ADD VALUE 'investment';
ALTER TYPE "ClinicJournalEntrySource" ADD VALUE 'investment_returned';
