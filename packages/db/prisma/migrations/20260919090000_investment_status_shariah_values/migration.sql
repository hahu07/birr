-- Split into its own migration on purpose: Postgres won't let a newly
-- added enum value be used (e.g. in a column DEFAULT) within the same
-- transaction that adds it. This migration only adds the two new
-- InvestmentStatus values; the next migration is what actually uses
-- them as the new default.
ALTER TYPE "InvestmentStatus" ADD VALUE 'pending_shariah_review';
ALTER TYPE "InvestmentStatus" ADD VALUE 'shariah_rejected';
