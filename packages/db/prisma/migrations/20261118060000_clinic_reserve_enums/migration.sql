-- Clinic waqf equipment replacement reserve (2026-11-17, slice 9). On its
-- own: Postgres won't use a new enum value in the migration that adds it.
ALTER TYPE "ClinicSpendKind" ADD VALUE 'reserve_replacement';
ALTER TYPE "ClinicJournalEntrySource" ADD VALUE 'reserve_set_aside';
