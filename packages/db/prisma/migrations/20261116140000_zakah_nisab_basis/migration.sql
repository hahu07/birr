-- AlterTable
ALTER TABLE "recurring_gifts" ADD COLUMN     "zakahNisabBasis" TEXT;

-- AlterTable
ALTER TABLE "zakah_payments" ADD COLUMN     "nisabBasis" TEXT;


-- The nisab a figure used (2026-11-16): the payer's choice where the ruleset
-- allowed one, else the ruleset's own basis.
ALTER TABLE "zakah_payments" ADD CONSTRAINT "zakah_payments_nisab_basis" CHECK ("nisabBasis" IS NULL OR "nisabBasis" IN ('gold', 'silver', 'lower_of'));
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_zakah_nisab_basis" CHECK ("zakahNisabBasis" IS NULL OR "zakahNisabBasis" IN ('gold', 'silver', 'lower_of'));
