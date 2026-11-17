-- Clinic waqf endowment spending (2026-11-17, slice 5b). On its own:
-- Postgres won't use a new enum value in the migration that adds it.
ALTER TYPE "ClinicJournalEntrySource" ADD VALUE 'spend_paid';
