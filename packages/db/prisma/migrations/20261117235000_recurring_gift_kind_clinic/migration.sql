-- Monthly clinic waqf gifts (2026-11-17, clinic slice 4b). On its own:
-- Postgres won't use a new enum value in the migration that adds it.
ALTER TYPE "RecurringGiftKind" ADD VALUE 'clinic';
