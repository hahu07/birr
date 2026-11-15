import { randomBytes } from "crypto";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IsEmail, IsNumberString } from "class-validator";
import { prisma, Prisma, type RecurringGift, type RecurringGiftKind, type RecurringGiftPauseReason } from "@birr/db";
import { MAX_PUBLIC_CONTRIBUTION_AMOUNT, MaxDecimal } from "../../common/validation/max-decimal";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { VaultContributionsService, type VaultDonorIdentityInput } from "../vaults/vault-contributions.service";
import { RecurringGiftsCoreService, hashManageToken, snapshot } from "./recurring-gifts-core.service";
import { GiftNeedsGiver, type MonthlyGiftCharge, type MonthlyGiftProduct } from "./monthly-gift-product";
import { VaultMonthlyProduct } from "./vault-monthly.product";
import { addMonths, cardExpiredBy, chargeDateFor } from "./recurring-gift-dates";
import { cancelledEmail, chargeFailedEmail, endedEmail, manageLinksEmail, pausedEmail, reminderEmail } from "./recurring-gift-emails";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A declined month is tried three times: now, a day later, three days after that. */
const RETRY_DELAYS_MS = [1 * DAY_MS, 3 * DAY_MS];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REMINDER_LEAD_MS = 3 * DAY_MS;
/** A first payment not completed by then is treated as abandoned. */
const SETUP_ABANDONED_MS = 2 * DAY_MS;
/** How long a scheduler run holds a gift it's working on. */
const CLAIM_MS = 5 * 60 * 1000;
/** A charge Paystack left pending is asked about again after this. */
const PENDING_RECHECK_MS = 30 * 60 * 1000;
/** A charge stopped by something on Birr's side (Paystack unreachable) is tried again after this. */
const TRANSIENT_RETRY_MS = 60 * 60 * 1000;
const DUE_BATCH = 50;

export class ChangeRecurringGiftAmountInput {
  @IsNumberString()
  @MaxDecimal(MAX_PUBLIC_CONTRIBUTION_AMOUNT)
  @IsPositiveDecimal()
  amount!: string;
}

export class RequestManageLinksInput {
  @IsEmail()
  email!: string;
}

type Who = { type: "giver" } | { type: "system" } | { type: "staff"; userId: string };

/**
 * Monthly giving's schedule and its givers' own actions (see
 * RecurringGift's schema comment). tick() is run by the scheduler; each
 * month's charge goes through the product's own service (see
 * MonthlyGiftProduct), so it passes every check a one-off gift does. The
 * database allows one non-failed payment per gift per month, so a second
 * scheduler instance or a retry can never collect a month twice.
 */
@Injectable()
export class RecurringGiftsService {
  private readonly logger = new Logger(RecurringGiftsService.name);
  private readonly products: Map<RecurringGiftKind, MonthlyGiftProduct>;

  constructor(
    private readonly core: RecurringGiftsCoreService,
    private readonly vaultContributions: VaultContributionsService,
    vaultProduct: VaultMonthlyProduct,
  ) {
    this.products = new Map<RecurringGiftKind, MonthlyGiftProduct>([["vault", vaultProduct]]);
  }

  private product(gift: RecurringGift): MonthlyGiftProduct {
    const product = this.products.get(gift.kind);
    if (!product) throw new Error(`Monthly ${gift.kind} giving isn't available yet.`);
    return product;
  }

  // ─── The schedule ────────────────────────────────────────────────────

  /** One scheduler run: settle first payments, send reminders, charge what's due. */
  async tick(now = new Date()): Promise<void> {
    await this.settleCardCheckouts(now);
    await this.sendReminders(now);
    const due = await prisma.recurringGift.findMany({
      where: { status: "active", nextChargeAt: { lte: now } },
      orderBy: { nextChargeAt: "asc" },
      take: DUE_BATCH,
    });
    for (const gift of due) {
      try {
        await this.processDue(gift.id, now);
      } catch (err) {
        this.logger.error(`Monthly gift "${gift.id}" couldn't be processed:`, err instanceof Error ? err.stack : String(err));
      }
    }
  }

  /**
   * A card checkout (first payment, or a card update) whose confirmation
   * didn't reach afterPaymentConfirmed (the server restarted, Paystack's
   * webhook was late): finish it from the payment's own status. One never
   * completed ends a new gift, or leaves a paused one waiting.
   */
  private async settleCardCheckouts(now: Date) {
    const waiting = await prisma.recurringGift.findMany({
      where: { pendingCardReference: { not: null }, updatedAt: { lte: new Date(now.getTime() - 10 * 60 * 1000) } },
      take: DUE_BATCH,
    });
    for (const gift of waiting) {
      const product = this.products.get(gift.kind);
      if (!product) continue;
      const charge = (await product.charges(gift.id)).find((c) => c.providerReference === gift.pendingCardReference);
      if (charge?.status === "pending") await product.reconcile(charge.id).catch(() => null);
      const settled = (await product.charges(gift.id)).find((c) => c.providerReference === gift.pendingCardReference);
      if (settled?.status === "confirmed") {
        await this.core.afterPaymentConfirmed(settled.providerReference, settled.recurringPeriod);
      } else if (gift.status === "pending_setup" && (settled?.status === "failed" || now.getTime() - gift.createdAt.getTime() > SETUP_ABANDONED_MS)) {
        await this.transition(gift, { type: "system" }, "recurring_gift.ended", {
          status: "ended",
          pendingCardReference: null,
          endedAt: now,
          endedReason: "setup_not_completed",
        });
      } else if (gift.status === "paused" && (settled?.status === "failed" || now.getTime() - gift.updatedAt.getTime() > SETUP_ABANDONED_MS)) {
        await this.transition(gift, { type: "system" }, "recurring_gift.card_update_abandoned", { pendingCardReference: null });
      }
    }
  }

  private async sendReminders(now: Date) {
    const upcoming = await prisma.recurringGift.findMany({
      where: { status: "active", nextChargeAt: { gt: now, lte: new Date(now.getTime() + REMINDER_LEAD_MS) } },
      take: DUE_BATCH,
    });
    for (const gift of upcoming) {
      if (gift.lastReminderPeriod === gift.nextPeriod) continue;
      const updated = await this.transition(gift, { type: "system" }, "recurring_gift.reminder_sent", { lastReminderPeriod: gift.nextPeriod }, {
        lastReminderPeriod: gift.lastReminderPeriod,
      });
      if (updated) await this.core.sendSafely(reminderEmail(updated, await this.core.targetOf(updated), await this.giverLink(updated)));
    }
  }

  /** Charges one due gift for its next month, or decides why not. Claimed first, so two runs never overlap on it. */
  async processDue(giftId: string, now = new Date()): Promise<void> {
    const claim = await prisma.recurringGift.updateMany({
      where: { id: giftId, status: "active", OR: [{ processingUntil: null }, { processingUntil: { lt: now } }] },
      data: { processingUntil: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claim.count !== 1) return;
    try {
      await this.chargeOrDecide(await prisma.recurringGift.findUniqueOrThrow({ where: { id: giftId } }), now);
    } finally {
      await prisma.recurringGift.updateMany({ where: { id: giftId }, data: { processingUntil: null } });
    }
  }

  private async chargeOrDecide(gift: RecurringGift, now: Date) {
    const product = this.product(gift);
    const period = gift.nextPeriod;
    let thisMonth = (await product.charges(gift.id)).filter((c) => c.recurringPeriod === period);

    // Already collected (the webhook confirmed a charge after the last run): move on.
    if (thisMonth.some((c) => c.status === "confirmed")) return this.advance(gift);

    const pending = thisMonth.find((c) => c.status === "pending");
    if (pending) {
      if (now.getTime() - pending.createdAt.getTime() < PENDING_RECHECK_MS) return this.retryAt(gift, new Date(now.getTime() + PENDING_RECHECK_MS));
      await product.reconcile(pending.id).catch(() => null);
      thisMonth = (await product.charges(gift.id)).filter((c) => c.recurringPeriod === period);
      if (thisMonth.some((c) => c.status === "confirmed")) return this.advance(gift);
      if (thisMonth.some((c) => c.status === "pending")) return this.retryAt(gift, new Date(now.getTime() + PENDING_RECHECK_MS));
    }

    // Declines so far this month, from the payments themselves, so a
    // failure the webhook reported late still counts.
    const declined = thisMonth.filter((c) => c.status === "failed");
    if (declined.length >= MAX_ATTEMPTS) return this.pause(gift, "card_failed");
    if (declined.length > 0) {
      const retryAt = new Date(declined[0].createdAt.getTime() + RETRY_DELAYS_MS[declined.length - 1]);
      if (now < retryAt) return this.retryAt(gift, retryAt);
    }

    if (cardExpiredBy(gift.cardExpMonth, gift.cardExpYear, now)) return this.pause(gift, "card_expired");

    const precheck = await product.precheck(gift);
    if ("pause" in precheck) return this.pause(gift, precheck.pause);
    if ("end" in precheck) return this.end(gift, precheck.end, precheck.reason);

    let outcome;
    try {
      outcome = await product.charge(gift, period);
    } catch (err) {
      if (err instanceof GiftNeedsGiver) return this.pause(gift, err.reason);
      // Something on Birr's or Paystack's side, not the giver's card: try
      // again later without counting it as a decline.
      this.logger.error(`Monthly gift "${gift.id}" charge didn't run:`, err instanceof Error ? err.stack : String(err));
      return this.retryAt(gift, new Date(now.getTime() + TRANSIENT_RETRY_MS));
    }

    if (outcome.status === "confirmed") return this.advance(gift);
    if (outcome.status === "pending") return this.retryAt(gift, new Date(now.getTime() + PENDING_RECHECK_MS));

    const attempts = declined.length + 1;
    if (attempts >= MAX_ATTEMPTS) return this.pause(gift, "card_failed", outcome.gatewayResponse);
    const retryAt = new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]);
    const updated = await this.transition(gift, { type: "system" }, "recurring_gift.charge_declined", {
      failedAttempts: attempts,
      nextChargeAt: retryAt,
    });
    if (updated) await this.core.sendSafely(chargeFailedEmail(updated, await this.core.targetOf(updated), await this.giverLink(updated), retryAt));
  }

  /** The month is collected: on to the next. */
  private async advance(gift: RecurringGift) {
    const nextPeriod = addMonths(gift.nextPeriod, 1);
    await this.transition(
      gift,
      { type: "system" },
      "recurring_gift.month_collected",
      { nextPeriod, nextChargeAt: chargeDateFor(nextPeriod, gift.dayOfMonth), failedAttempts: 0 },
      { nextPeriod: gift.nextPeriod },
    );
  }

  private async retryAt(gift: RecurringGift, at: Date) {
    // Bookkeeping only (when to look again), so no audit row.
    await prisma.recurringGift.updateMany({ where: { id: gift.id, status: "active" }, data: { nextChargeAt: at } });
  }

  private async pause(gift: RecurringGift, reason: RecurringGiftPauseReason, detail?: string) {
    const updated = await this.transition(gift, { type: "system" }, "recurring_gift.paused", {
      status: "paused",
      pauseReason: reason,
      nextChargeAt: null,
      ...(reason === "card_failed" && { failedAttempts: MAX_ATTEMPTS }),
    }, { status: "active" }, detail);
    if (!updated) return;
    const target = await this.core.targetOf(updated);
    const link = await this.giverLink(updated);
    await this.core.sendSafely(reason === "card_failed" ? chargeFailedEmail(updated, target, link, null) : pausedEmail(updated, target, link));
  }

  private async end(gift: RecurringGift, reasonCode: string, reasonText: string) {
    const updated = await this.transition(gift, { type: "system" }, "recurring_gift.ended", {
      status: "ended",
      pauseReason: null,
      nextChargeAt: null,
      pendingCardReference: null,
      endedAt: new Date(),
      endedReason: reasonCode,
    });
    if (updated) await this.core.sendSafely(endedEmail(updated, await this.core.targetOf(updated), reasonText));
  }

  /**
   * One audited change to a gift. `expect` guards against a change made
   * in the meantime (another run, the giver): if the gift no longer
   * matches, nothing is written and null comes back.
   */
  private async transition(
    gift: RecurringGift,
    who: Who,
    action: string,
    data: Prisma.RecurringGiftUpdateManyMutationInput,
    expect: Prisma.RecurringGiftWhereInput = {},
    detail?: string,
  ): Promise<RecurringGift | null> {
    return prisma.$transaction(async (tx) => {
      const claim = await tx.recurringGift.updateMany({ where: { id: gift.id, ...expect }, data });
      if (claim.count !== 1) return null;
      const after = await tx.recurringGift.findUniqueOrThrow({ where: { id: gift.id } });
      await this.core.audit(tx, gift, who, action, gift, detail ? ({ ...after, detail } as RecurringGift) : after);
      return after;
    });
  }

  /** The link in an email: a fresh private link can't be shown (only its hash is kept), so the general manage page. */
  private async giverLink(gift: RecurringGift): Promise<string> {
    return this.core.manageUrl(gift, null);
  }

  // ─── The giver's own actions, by their private link ──────────────────

  private async byToken(token: string): Promise<RecurringGift> {
    const gift = token ? await prisma.recurringGift.findUnique({ where: { manageTokenHash: hashManageToken(token) } }) : null;
    if (!gift || gift.kind === "waqf") throw new NotFoundException("This link isn't valid. Ask for a new one below.");
    return gift;
  }

  async view(token: string) {
    return this.present(await this.byToken(token));
  }

  /** What a giver sees of their gift: never the saved card itself, only its last four digits. */
  async present(gift: RecurringGift) {
    const product = this.product(gift);
    const charges = (await product.charges(gift.id)).slice(0, 12);
    return {
      kind: gift.kind,
      status: gift.status,
      pauseReason: gift.pauseReason,
      email: gift.email,
      amount: gift.amount.toString(),
      currency: gift.currency,
      dayOfMonth: gift.dayOfMonth,
      nextChargeAt: gift.nextChargeAt,
      card: gift.cardLast4 ? { last4: gift.cardLast4, brand: gift.cardBrand, expMonth: gift.cardExpMonth, expYear: gift.cardExpYear } : null,
      cardUpdateInProgress: gift.pendingCardReference != null && gift.status === "paused",
      target: await product.describe(gift),
      minimumAmount: (await product.minimum()).toString(),
      charges: charges.map((c: MonthlyGiftCharge) => ({
        id: c.id,
        period: c.recurringPeriod,
        amount: c.amount.toString(),
        status: c.status,
        date: c.confirmedAt ?? c.createdAt,
      })),
      createdAt: gift.createdAt,
      cancelledAt: gift.cancelledAt,
      endedReason: gift.endedReason,
    };
  }

  async changeAmount(token: string, input: ChangeRecurringGiftAmountInput) {
    return this.present(await this.applyAmount(await this.byToken(token), input.amount, { type: "giver" }));
  }

  /** Shared with the founder's waqf top-up: a new amount, from the next charge. Resumes a gift paused for being below the minimum. */
  async applyAmount(gift: RecurringGift, amountText: string, who: Who): Promise<RecurringGift> {
    if (gift.status !== "active" && gift.status !== "paused") throw new BadRequestException("This monthly gift has stopped.");
    const amount = new Prisma.Decimal(amountText);
    if (amount.decimalPlaces() > 2) throw new BadRequestException("Please give an amount in naira and kobo.");
    const minimum = await this.product(gift).minimum();
    if (amount.lt(minimum)) throw new BadRequestException(`The minimum monthly gift is ₦${minimum.toFixed(0)}.`);
    const resume = gift.status === "paused" && gift.pauseReason === "below_minimum";
    const updated = await this.transition(
      gift,
      who,
      "recurring_gift.amount_changed",
      { amount, ...(resume && this.resumeData(gift)) },
      { status: gift.status, amount: gift.amount },
    );
    if (!updated) throw new BadRequestException("This monthly gift changed just now. Please reload and try again.");
    return updated;
  }

  async cancel(token: string) {
    return this.present(await this.applyCancel(await this.byToken(token), { type: "giver" }));
  }

  /** Stops a gift for good. Payments already made are untouched. */
  async applyCancel(gift: RecurringGift, who: Who, reason?: string): Promise<RecurringGift> {
    if (gift.status === "cancelled" || gift.status === "ended") return gift;
    const updated = await this.transition(
      gift,
      who,
      "recurring_gift.cancelled",
      {
        status: "cancelled",
        pauseReason: null,
        nextChargeAt: null,
        pendingCardReference: null,
        cancelledAt: new Date(),
        cancelledBy: who.type === "staff" ? "staff" : gift.kind === "waqf" ? "founder" : "giver",
      },
      { status: gift.status },
      reason,
    );
    if (!updated) throw new BadRequestException("This monthly gift changed just now. Please reload and try again.");
    // Never says why when staff stopped it (no tipping off).
    await this.core.sendSafely(cancelledEmail(updated, await this.core.targetOf(updated)));
    return updated;
  }

  async startCardUpdate(token: string) {
    return this.applyCardUpdate(await this.byToken(token));
  }

  async applyCardUpdate(gift: RecurringGift) {
    if (gift.status !== "paused" || (gift.pauseReason !== "card_failed" && gift.pauseReason !== "card_expired")) {
      throw new BadRequestException("Your card can be updated here when a payment fails or the card expires.");
    }
    return this.product(gift).startCardUpdate(gift);
  }

  async provideIdentity(token: string, input: VaultDonorIdentityInput) {
    const gift = await this.byToken(token);
    if (gift.kind !== "vault" || gift.status !== "paused" || gift.pauseReason !== "needs_identity") {
      throw new BadRequestException("This monthly gift isn't waiting for your ID.");
    }
    await this.vaultContributions.recordDonorIdentity(gift.email, input);
    const updated = await this.transition(gift, { type: "giver" }, "recurring_gift.resumed", this.resumeData(gift), {
      status: "paused",
      pauseReason: "needs_identity",
    });
    return this.present(updated ?? gift);
  }

  /** Back to active, charging the month it's due straight away if its day has passed. */
  private resumeData(gift: RecurringGift): Prisma.RecurringGiftUpdateManyMutationInput {
    const due = chargeDateFor(gift.nextPeriod, gift.dayOfMonth);
    return { status: "active", pauseReason: null, nextChargeAt: due > new Date() ? due : new Date() };
  }

  /**
   * "Email me my links": fresh private links for every running gift under
   * this email, replacing the old ones. Always answers the same way, so
   * it never reveals whether an email gives monthly.
   */
  async requestManageLinks(input: RequestManageLinksInput): Promise<{ sent: true }> {
    const email = input.email.trim().toLowerCase();
    const gifts = await prisma.recurringGift.findMany({
      where: { email, kind: { in: ["vault", "zakah"] }, status: { in: ["active", "paused"] } },
    });
    const links: { label: string; url: string }[] = [];
    for (const gift of gifts) {
      const token = randomBytes(32).toString("base64url");
      const updated = await this.transition(gift, { type: "giver" }, "recurring_gift.manage_link_reissued", {
        manageTokenHash: hashManageToken(token),
      });
      if (!updated) continue;
      const target = await this.product(gift).describe(gift);
      links.push({ label: `${target.name}${target.detail ? ` (${target.detail})` : ""}: ₦${Number(gift.amount).toLocaleString("en-NG")} a month`, url: this.core.manageUrl(gift, token) });
    }
    if (links.length > 0) await this.core.sendSafely(manageLinksEmail(email, links));
    return { sent: true };
  }

  /** For tests and the Ops list: a gift as the audit trail records it. */
  static snapshot = snapshot;
}
