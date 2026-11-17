-- Clinic waqf assets (2026-11-17, slice 5a). On its own: Postgres won't
-- use a new enum value in the migration that adds it.
ALTER TYPE "ClinicJournalEntrySource" ADD VALUE 'asset_added';
ALTER TYPE "ClinicJournalEntrySource" ADD VALUE 'asset_disposed';
