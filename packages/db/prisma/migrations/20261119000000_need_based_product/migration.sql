-- The need-based waqf (approved 2026-11-18): the second waqf programme
-- product. Its own rules (which parts and payments it may have) are in the
-- next migration, since a new enum value can't be used in the transaction
-- that adds it.
ALTER TYPE "WaqfProgrammeProduct" ADD VALUE 'need_based';
