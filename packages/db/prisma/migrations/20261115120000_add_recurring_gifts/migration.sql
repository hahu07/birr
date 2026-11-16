-- CreateEnum
CREATE TYPE "RecurringGiftKind" AS ENUM ('vault', 'waqf', 'zakah');

-- CreateEnum
CREATE TYPE "RecurringGiftStatus" AS ENUM ('pending_setup', 'active', 'paused', 'cancelled', 'ended');

-- CreateEnum
CREATE TYPE "RecurringGiftPauseReason" AS ENUM ('card_failed', 'card_expired', 'needs_identity', 'terms_changed', 'below_minimum');

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "recurringGiftId" TEXT,
ADD COLUMN     "recurringPeriod" TEXT;

-- AlterTable
ALTER TABLE "vault_contributions" ADD COLUMN     "recurringGiftId" TEXT,
ADD COLUMN     "recurringPeriod" TEXT;

-- AlterTable
ALTER TABLE "zakah_payments" ADD COLUMN     "recurringGiftId" TEXT,
ADD COLUMN     "recurringPeriod" TEXT;

-- CreateTable
CREATE TABLE "recurring_gifts" (
    "id" TEXT NOT NULL,
    "kind" "RecurringGiftKind" NOT NULL,
    "status" "RecurringGiftStatus" NOT NULL DEFAULT 'pending_setup',
    "pauseReason" "RecurringGiftPauseReason",
    "email" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "dayOfMonth" INTEGER NOT NULL,
    "nextPeriod" TEXT NOT NULL,
    "nextChargeAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "processingUntil" TIMESTAMP(3),
    "vaultId" TEXT,
    "vaultCauseId" TEXT,
    "waqfId" TEXT,
    "founderId" TEXT,
    "coverFee" BOOLEAN NOT NULL DEFAULT false,
    "wakalahConsentVersion" TEXT,
    "zakahRulesetKey" TEXT,
    "zakahRulesetVersion" INTEGER,
    "zakahMetalPriceId" TEXT,
    "authorizationEncrypted" TEXT,
    "cardLast4" TEXT,
    "cardBrand" TEXT,
    "cardExpMonth" INTEGER,
    "cardExpYear" INTEGER,
    "pendingCardReference" TEXT,
    "manageTokenHash" TEXT,
    "lastReminderPeriod" TEXT,
    "activatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recurring_gifts_pendingCardReference_key" ON "recurring_gifts"("pendingCardReference");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_gifts_manageTokenHash_key" ON "recurring_gifts"("manageTokenHash");

-- CreateIndex
CREATE INDEX "recurring_gifts_status_nextChargeAt_idx" ON "recurring_gifts"("status", "nextChargeAt");

-- CreateIndex
CREATE INDEX "recurring_gifts_email_idx" ON "recurring_gifts"("email");

-- CreateIndex
CREATE INDEX "recurring_gifts_founderId_idx" ON "recurring_gifts"("founderId");

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_recurringGiftId_fkey" FOREIGN KEY ("recurringGiftId") REFERENCES "recurring_gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_contributions" ADD CONSTRAINT "vault_contributions_recurringGiftId_fkey" FOREIGN KEY ("recurringGiftId") REFERENCES "recurring_gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakah_payments" ADD CONSTRAINT "zakah_payments_recurringGiftId_fkey" FOREIGN KEY ("recurringGiftId") REFERENCES "recurring_gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_vaultCauseId_fkey" FOREIGN KEY ("vaultCauseId") REFERENCES "vault_causes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_waqfId_fkey" FOREIGN KEY ("waqfId") REFERENCES "waqfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Monthly giving (owner's decisions, 2026-11-15). The rules below are the
-- database's own, so no code path can break them.

-- Naira only, a positive amount, and a day every month has.
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_ngn_only" CHECK ("currency" = 'NGN');
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_day_of_month" CHECK ("dayOfMonth" BETWEEN 1 AND 28);
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_next_period_format" CHECK ("nextPeriod" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Each kind carries exactly its own target.
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_target_matches_kind" CHECK (
  ("kind" = 'vault' AND "vaultId" IS NOT NULL AND "waqfId" IS NULL AND "founderId" IS NULL AND "wakalahConsentVersion" IS NULL)
  OR ("kind" = 'waqf' AND "waqfId" IS NOT NULL AND "founderId" IS NOT NULL AND "vaultId" IS NULL AND "vaultCauseId" IS NULL AND "wakalahConsentVersion" IS NULL)
  OR ("kind" = 'zakah' AND "wakalahConsentVersion" IS NOT NULL AND "vaultId" IS NULL AND "vaultCauseId" IS NULL AND "waqfId" IS NULL AND "founderId" IS NULL)
);

-- Only an active gift is charged, and it can't be active without a saved card.
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_active_has_card" CHECK (
  "status" <> 'active' OR ("authorizationEncrypted" IS NOT NULL AND "nextChargeAt" IS NOT NULL)
);
-- A pause always says why, and nothing else carries a pause reason.
ALTER TABLE "recurring_gifts" ADD CONSTRAINT "recurring_gifts_pause_reason" CHECK (
  ("status" = 'paused') = ("pauseReason" IS NOT NULL)
);

-- A month is only ever named together with its gift. A gift without a
-- month is a card-update checkout (see RecurringGiftsCoreService
-- .afterPaymentConfirmed): it counts as the month due when it confirms.
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_recurring_pair" CHECK ("recurringPeriod" IS NULL OR "recurringGiftId" IS NOT NULL);
ALTER TABLE "vault_contributions" ADD CONSTRAINT "vault_contributions_recurring_pair" CHECK ("recurringPeriod" IS NULL OR "recurringGiftId" IS NOT NULL);
ALTER TABLE "zakah_payments" ADD CONSTRAINT "zakah_payments_recurring_pair" CHECK ("recurringPeriod" IS NULL OR "recurringGiftId" IS NOT NULL);

-- At most one charge per gift per month that isn't a failure: the
-- database itself stops a month being collected twice, whatever the
-- scheduler does.
CREATE UNIQUE INDEX "contributions_one_charge_per_gift_month" ON "contributions" ("recurringGiftId", "recurringPeriod") WHERE "recurringPeriod" IS NOT NULL AND "status" <> 'failed';
CREATE UNIQUE INDEX "vault_contributions_one_charge_per_gift_month" ON "vault_contributions" ("recurringGiftId", "recurringPeriod") WHERE "recurringPeriod" IS NOT NULL AND "status" <> 'failed';
CREATE UNIQUE INDEX "zakah_payments_one_charge_per_gift_month" ON "zakah_payments" ("recurringGiftId", "recurringPeriod") WHERE "recurringPeriod" IS NOT NULL AND "status" <> 'failed';

-- Founder isolation, as on contributions (20260830152938): inside a
-- founder's scope only their own Waqf Fund top-ups are visible.
ALTER TABLE "recurring_gifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring_gifts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "founder_isolation" ON "recurring_gifts"
  USING (
    NULLIF(current_setting('app.current_founder_id', true), '') IS NULL
    OR "founderId" = current_setting('app.current_founder_id', true)
  );
