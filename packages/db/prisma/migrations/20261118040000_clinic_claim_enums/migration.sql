-- Clinic waqf monthly claims (2026-11-17, slice 7). On its own: Postgres
-- won't use a new enum value in the migration that adds it.
ALTER TYPE "ClinicJournalEntrySource" ADD VALUE 'claim_paid';
