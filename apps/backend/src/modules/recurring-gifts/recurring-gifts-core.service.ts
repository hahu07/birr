import { createHash, randomBytes } from "crypto";
import { TwilioWhatsAppAdapter } from "../../common/whatsapp/twilio-whatsapp.adapter";
import { plainTextFromHtml, whatsAppTextFromEmail } from "../../common/giving/giver-contact";
import { Injectable, Logger } from "@nestjs/common";
import { prisma, Prisma, type RecurringGift, type RecurringGiftKind } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { ResendRecurringGiftEmailAdapter, type RecurringGiftEmail } from "./email/resend-recurring-gift-email.adapter";
import { addMonths, chargeDateFor, dayOfMonthFor, periodOf } from "./recurring-gift-dates";
import { type GiftTarget, endedEmail, isFounderGift, setUpEmail } from "./recurring-gift-emails";

export interface RecurringGiftSetupInput {
  kind: RecurringGiftKind;
  /** At least one of email and whatsappNumber (a CHECK). */
  email: string | null;
  whatsappNumber?: string | null;
  amount: Prisma.Decimal | string;
  /** The first payment's own id: its confirmation saves the card. */
  reference: string;
  vaultId?: string;
  vaultCauseId?: string;
  waqfId?: string;
  founderId?: string;
  coverFee?: boolean;
  wakalahConsentVersion?: string;
  zakahRulesetKey?: string;
  zakahRulesetVersion?: number;
  zakahMetalPriceId?: string;
  zakahNisabBasis?: string | null;
  /** Clinic waqf gifts (2026-11-17): the clinic, the pot, and for the endowment the deed accepted. */
  programmeId?: string;
  programmePot?: "endowment" | "running";
  programmeDeedId?: string;
  programmeDeedTextHash?: string;
}

type Who = { type: "giver" } | { type: "system" } | { type: "staff"; userId: string };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function hashManageToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The part of monthly giving every product needs (see RecurringGift's
 * schema comment): starting a gift alongside its first payment, and saving
 * the card once a card checkout confirms. Kept apart from
 * RecurringGiftsService, which charges each month through the products'
 * own services, so the products can depend on this without a cycle.
 */
@Injectable()
export class RecurringGiftsCoreService {
  private readonly logger = new Logger(RecurringGiftsCoreService.name);

  constructor(
    private readonly paystack: PaystackAdapter,
    private readonly encryption: EncryptionService,
    private readonly emails: ResendRecurringGiftEmailAdapter,
    // Last, so tests that never send WhatsApp needn't pass it.
    private readonly whatsApp?: TwilioWhatsAppAdapter,
  ) {}

  /**
   * Called by a product's initiate() in its setup mode, inside its
   * transaction and before it creates the first payment row, which then
   * carries this gift's id and `nextPeriod`: the first payment is this
   * month's gift.
   */
  async createSetup(tx: Prisma.TransactionClient, input: RecurringGiftSetupInput): Promise<RecurringGift> {
    const now = new Date();
    const gift = await tx.recurringGift.create({
      data: {
        kind: input.kind,
        email: input.email,
        whatsappNumber: input.whatsappNumber ?? null,
        amount: input.amount,
        currency: "NGN",
        dayOfMonth: dayOfMonthFor(now),
        nextPeriod: periodOf(now),
        pendingCardReference: input.reference,
        vaultId: input.vaultId,
        vaultCauseId: input.vaultCauseId,
        waqfId: input.waqfId,
        founderId: input.founderId,
        coverFee: input.coverFee ?? false,
        wakalahConsentVersion: input.wakalahConsentVersion,
        zakahRulesetKey: input.zakahRulesetKey,
        zakahRulesetVersion: input.zakahRulesetVersion,
        zakahNisabBasis: input.zakahNisabBasis ?? null,
        zakahMetalPriceId: input.zakahMetalPriceId,
        programmeId: input.programmeId,
        programmePot: input.programmePot,
        programmeDeedId: input.programmeDeedId,
        programmeDeedTextHash: input.programmeDeedTextHash,
      },
    });
    await this.audit(tx, gift, { type: "giver" }, "recurring_gift.set_up_started", null, gift);
    return gift;
  }

  /**
   * After a product confirms a payment that belongs to a monthly gift. If
   * it was a card checkout this gift is waiting on (its setup, or a card
   * update), read back the card Paystack used and save it, then schedule
   * the next month. A card Paystack can't charge again ends the gift: the
   * payment itself still counts. Idempotent: only the first caller for a
   * reference does anything. Safe to call for every confirmation.
   *
   * `period` is the month the payment was for. A card-update checkout
   * carries none (see the migration's recurring_pair CHECK): it is the
   * month the paused gift is due for.
   */
  async afterPaymentConfirmed(reference: string, period: string | null): Promise<void> {
    const gift = await prisma.recurringGift.findUnique({ where: { pendingCardReference: reference } });
    if (!gift) return;
    const collected = period ?? gift.nextPeriod;

    const verified = await this.paystack.verifyPayment(reference);
    const card = verified?.authorization;
    const chargeable = card && card.reusable && card.channel === "card";
    const wasSetup = gift.status === "pending_setup";

    if (!chargeable) {
      const ended = await prisma.$transaction(async (tx) => {
        const claim = await tx.recurringGift.updateMany({
          where: { id: gift.id, pendingCardReference: reference },
          data: { status: "ended", pauseReason: null, pendingCardReference: null, nextChargeAt: null, endedAt: new Date(), endedReason: "card_not_reusable" },
        });
        if (claim.count !== 1) return null;
        const after = await tx.recurringGift.findUniqueOrThrow({ where: { id: gift.id } });
        await this.audit(tx, gift, { type: "system" }, "recurring_gift.ended", gift, after);
        return after;
      });
      if (ended) {
        await this.sendSafely(
          endedEmail(ended, await this.targetOf(ended), "the card used can't be charged again automatically. Your payment this month still went through"),
        );
      }
      return;
    }

    const nextPeriod = addMonths(collected, 1);
    // A Founder manages their gifts in the portal, so only a public giver gets a private link.
    const token = wasSetup && !isFounderGift(gift) ? randomBytes(32).toString("base64url") : null;
    const activated = await prisma.$transaction(async (tx) => {
      const claim = await tx.recurringGift.updateMany({
        where: { id: gift.id, pendingCardReference: reference },
        data: {
          status: "active",
          pauseReason: null,
          pendingCardReference: null,
          authorizationEncrypted: this.encryption.encrypt(card.authorizationCode),
          cardLast4: card.last4,
          cardBrand: card.brand,
          cardExpMonth: card.expMonth,
          cardExpYear: card.expYear,
          failedAttempts: 0,
          nextPeriod,
          nextChargeAt: chargeDateFor(nextPeriod, gift.dayOfMonth),
          activatedAt: gift.activatedAt ?? new Date(),
          ...(token && { manageTokenHash: hashManageToken(token) }),
        },
      });
      if (claim.count !== 1) return null;
      const after = await tx.recurringGift.findUniqueOrThrow({ where: { id: gift.id } });
      await this.audit(tx, gift, { type: "system" }, wasSetup ? "recurring_gift.activated" : "recurring_gift.card_updated", gift, after);
      return after;
    });
    if (activated && wasSetup) {
      await this.sendSafely(setUpEmail(activated, await this.targetOf(activated), this.manageUrl(activated, token)));
    }
  }

  decryptAuthorization(gift: RecurringGift): string {
    if (!gift.authorizationEncrypted) throw new Error(`Recurring gift "${gift.id}" has no saved card.`);
    return this.encryption.decrypt(gift.authorizationEncrypted);
  }

  /** Where the giver manages the gift: their private link, or the Founder Portal for a waqf top-up. */
  /**
   * Starts a card update on a gift paused for its card: called by a
   * product's initiate() in its card-update mode, inside its transaction,
   * before it creates the checkout row (which carries the gift but no
   * month). Returns false if the gift isn't paused for its card any more.
   */
  async startCardUpdate(tx: Prisma.TransactionClient, gift: RecurringGift, reference: string): Promise<boolean> {
    const claim = await tx.recurringGift.updateMany({
      where: { id: gift.id, status: "paused", pauseReason: { in: ["card_failed", "card_expired"] } },
      data: { pendingCardReference: reference },
    });
    if (claim.count !== 1) return false;
    const after = await tx.recurringGift.findUniqueOrThrow({ where: { id: gift.id } });
    await this.audit(tx, gift, { type: "giver" }, "recurring_gift.card_update_started", gift, after);
    return true;
  }

  manageUrl(gift: RecurringGift, token: string | null): string {
    const base = process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000";
    if (gift.kind === "waqf") return `${base}/portfolio/${gift.waqfId}`;
    if (isFounderGift(gift)) return `${base}/clinic-support`;
    return token ? `${base}/giving/manage/${token}` : `${base}/giving/manage`;
  }

  /** A sentence fragment naming what the gift goes to, HTML-escaped. */
  async targetOf(gift: RecurringGift): Promise<GiftTarget> {
    if (gift.kind === "vault" && gift.vaultId) {
      const vault = await prisma.vault.findUnique({ where: { id: gift.vaultId }, select: { name: true } });
      const cause = gift.vaultCauseId
        ? await prisma.vaultCause.findUnique({ where: { id: gift.vaultCauseId }, select: { name: true } })
        : null;
      return { phrase: `to ${escapeHtml(vault?.name ?? "the Vault")}${cause ? ` (${escapeHtml(cause.name)})` : ""}` };
    }
    if (gift.kind === "waqf" && gift.waqfId) {
      const waqf = await prisma.waqf.findUnique({ where: { id: gift.waqfId }, select: { name: true } });
      return { phrase: `to ${escapeHtml(waqf?.name ?? "your Waqf Fund")}` };
    }
    if (gift.kind === "programme" && gift.programmeId) {
      const clinic = await prisma.waqfProgramme.findUnique({ where: { id: gift.programmeId }, select: { name: true } });
      const pot = gift.programmePot === "endowment" ? "endowment" : "running fund";
      return { phrase: `to the ${pot} of ${escapeHtml(clinic?.name ?? "the clinic")}` };
    }
    return { phrase: "towards your zakah" };
  }

  /**
   * Sends a gift's message by email and/or WhatsApp, whichever the giver
   * gave (2026-11-16); a founder's top-up also goes to their verified
   * account number. Messages never hold up or undo a change already made.
   */
  async sendSafely(message: RecurringGiftEmail): Promise<void> {
    if (message.to) {
      try {
        await this.emails.send({ ...message, to: message.to });
      } catch (err) {
        this.logger.error(`Failed to email "${message.subject}":`, err instanceof Error ? err.stack : String(err));
      }
    }
    let whatsapp = message.whatsappTo ?? null;
    if (!whatsapp && message.founderAccountEmail) {
      try {
        whatsapp = await this.founderWhatsApp(message.founderAccountEmail);
      } catch (err) {
        this.logger.error(`Couldn't look up a founder's WhatsApp for "${message.subject}":`, err instanceof Error ? err.stack : String(err));
      }
    }
    if (whatsapp) {
      try {
        if (!this.whatsApp) throw new Error("WhatsApp isn't available here.");
        // A message without a button still needs a link in the template:
        // the founder's portfolio, or where a giver gets their manage links.
        const base = process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000";
        const link = message.ctaUrl ?? (message.founderAccountEmail ? `${base}/portfolio` : `${base}/giving/manage`);
        await this.whatsApp.sendTemplate(whatsapp, "monthly_gift_update", [message.heading, plainTextFromHtml(message.bodyHtml), link], whatsAppTextFromEmail(message));
      } catch (err) {
        this.logger.error(`Failed to send "${message.subject}" by WhatsApp:`, err instanceof Error ? err.stack : String(err));
      }
    }
  }

  /**
   * A founder's verified WhatsApp number for their top-up notices, unless
   * they've turned WhatsApp off for money notices in their notification
   * preferences (the same switch their other money notices honour).
   */
  private async founderWhatsApp(accountEmail: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { email: accountEmail }, select: { id: true, whatsappNumber: true, whatsappVerifiedAt: true } });
    if (!user?.whatsappNumber || !user.whatsappVerifiedAt) return null;
    const preference = await prisma.notificationPreference.findUnique({ where: { userId_category: { userId: user.id, category: "money" } } });
    return preference?.whatsappEnabled === false ? null : user.whatsappNumber;
  }

  /** One audit row per change to a gift. The saved card is never written to the trail. */
  async audit(
    tx: Prisma.TransactionClient,
    gift: RecurringGift,
    who: Who,
    action: string,
    before: RecurringGift | null,
    after: RecurringGift | null,
  ): Promise<void> {
    const actor =
      who.type === "staff"
        ? { actorType: "birr_staff" as const, actorUserId: who.userId }
        : who.type === "system"
          ? { actorType: "system" as const }
          : isFounderGift(gift)
            ? { actorType: "founder_user" as const, actorFounderId: gift.founderId }
            : { actorType: "public_donor" as const };
    await tx.auditLog.create({
      data: {
        ...actor,
        waqfId: gift.waqfId,
        vaultId: gift.vaultId,
        action,
        entityType: "RecurringGift",
        entityId: gift.id,
        before: before ? (snapshot(before) as Prisma.InputJsonValue) : undefined,
        after: after ? (snapshot(after) as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}

/** A gift for the audit trail: the saved card and the link hash are left out. */
export function snapshot(gift: RecurringGift) {
  const { authorizationEncrypted, manageTokenHash, ...rest } = gift;
  return { ...rest, cardSaved: authorizationEncrypted != null, manageLinkIssued: manageTokenHash != null };
}
