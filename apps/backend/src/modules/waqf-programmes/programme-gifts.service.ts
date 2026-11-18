import { EmailField, HasDigits, HasLetters, IdField, TextField, Trimmed } from "../../common/validation/fields";
import { randomUUID } from "crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { IsBoolean, IsEnum, IsIn, IsNumberString, IsOptional, IsString, MaxLength } from "class-validator";
import { WaqfProgrammePot, WaqfProgrammeProduct, ContributionProvider, IdType, prisma, Prisma, type RecurringGift } from "@birr/db";
import { processingFeeCover } from "@birr/zakah";
import { FIELD_LIMITS } from "@birr/shared";
import { type GiverContact, hasContact, lockGiverContact, moneyText, paystackEmailForGift, whatsAppNotice } from "../../common/giving/giver-contact";
import { GiverWhatsAppService } from "../../common/whatsapp/giver-whatsapp.service";
import { TwilioWhatsAppAdapter } from "../../common/whatsapp/twilio-whatsapp.adapter";
import { SettingsService } from "../../common/settings/settings.service";
import { MAX_PUBLIC_CONTRIBUTION_AMOUNT, MaxDecimal } from "../../common/validation/max-decimal";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { ProgrammeLedgerService } from "./programme-ledger.service";
import { productOf } from "./programme-products";
import { assertFounderVerified, findPrimaryContactMembership } from "../../common/auth/current-founder";
import { RecurringGiftsCoreService } from "../recurring-gifts/recurring-gifts-core.service";
import type { SavedCardChargeResult } from "../contributions/providers/payment-provider.interface";
import { ResendProgrammeReceiptEmailAdapter } from "./programme-receipt-email.adapter";

const CURRENCY = "NGN";
/** The smallest public gift, and a Founder's later gifts (owner's decisions, 2026-11-17). */
export const CLINIC_PUBLIC_MINIMUM_NGN = "5000";
/** A Founder's first gift to a clinic waqf is at least this; later ones, CLINIC_PUBLIC_MINIMUM_NGN. */
export const CLINIC_FOUNDER_FIRST_GIFT_MINIMUM_NGN = "250000";
const VERIFY_MIN_INTERVAL_MS = 5_000;

/** Where each pot's gift is booked: its cash account, and what it's credited to. */
const GIFT_ACCOUNTS: Record<WaqfProgrammePot, { cash: string; credit: string }> = {
  endowment: { cash: "1000", credit: "3000" }, // Endowment cash / Endowment capital
  running: { cash: "1100", credit: "4000" }, // Running fund cash / Gifts to the running fund
};

export class InitiateProgrammeGiftInput {
  @TextField(100)
  slug!: string;

  @IsIn(["endowment", "running"])
  pot!: WaqfProgrammePot;

  // Public route: MaxDecimal is a blunt sanity ceiling, not a business rule.
  @IsNumberString()
  @MaxDecimal(MAX_PUBLIC_CONTRIBUTION_AMOUNT)
  @IsPositiveDecimal()
  amount!: string;

  /** Add the processing fee on top; otherwise Birr pays it. Either way the full amount reaches the pot. */
  @IsBoolean()
  coverFee!: boolean;

  // Endowment gifts: the approved deed version the giver read, and its
  // hash. Refused if it isn't the current approved version, word for word.
  @IsOptional()
  @IdField()
  deedId?: string;

  @IsOptional()
  @TextField(FIELD_LIMITS.code)
  deedTextHash?: string;

  @IsOptional()
  @EmailField()
  donorEmail?: string;

  // Only used once confirmed: whatsappProof comes from POST /giving/whatsapp/confirm.
  @Trimmed()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  donorWhatsApp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  whatsappProof?: string;

  @Trimmed()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @HasLetters()
  donorFullName?: string;

  @IsOptional()
  @IsEnum(IdType)
  idType?: IdType;

  @Trimmed()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @HasDigits()
  idNumber?: string;

  /** Give this every month, by card (slice 4b): needs an email or WhatsApp number. */
  @IsOptional()
  @IsBoolean()
  monthly?: boolean;
}

/** A Founder's gift (slice 4a): the giver and receipt contacts come from their signed-in account. */
export class InitiateFounderProgrammeGiftInput {
  @TextField(100)
  slug!: string;

  @IsIn(["endowment", "running"])
  pot!: WaqfProgrammePot;

  @IsNumberString()
  @MaxDecimal(MAX_PUBLIC_CONTRIBUTION_AMOUNT)
  @IsPositiveDecimal()
  amount!: string;

  @IsBoolean()
  coverFee!: boolean;

  @IsOptional()
  @IdField()
  deedId?: string;

  @IsOptional()
  @TextField(FIELD_LIMITS.code)
  deedTextHash?: string;

  /** Give this every month, by card (slice 4b). */
  @IsOptional()
  @IsBoolean()
  monthly?: boolean;
}

/**
 * initiate()'s monthly modes (slice 4b), never taken from the request
 * body. "setup" starts a monthly gift with a card-only checkout; "charge"
 * is a later month on the saved card; "card_update" is a card-only
 * checkout for the month a paused gift is due, which saves the new card.
 * Same modes as Vault and zakah.
 */
export type ProgrammeMonthlyMode =
  | { type: "setup" }
  | { type: "charge"; gift: RecurringGift; period: string }
  | { type: "card_update"; gift: RecurringGift };

/** Who a gift's audit rows name: a public giver, or a Founder's user. */
type GiftActor = { type: "public_donor"; donorId: string | null } | { type: "founder_user"; userId: string; founderId: string };

function normalizeEmail(email: string | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * Giving to a clinic waqf, one-off (2026-11-17, clinic slice 3). Mirrors
 * ZakahPaymentsService: reserve the row, then call Paystack; confirm
 * exactly once, from the webhook or the giver's return. Owner's
 * decisions: gifts settle into the clinic waqf's own Paystack subaccount
 * (none is taken until it's set), and the giver may add the processing fee
 * on top, otherwise Birr pays it, so the full gift reaches its pot. An
 * endowment gift is given under the approved deed, as worded; the database
 * checks that too. The giver is a VaultDonor, so Vault and clinic giving
 * count together toward the AML ID threshold.
 *
 * Audit rows use actorType "public_donor" with the donor as actorDonorId.
 */
@Injectable()
export class ProgrammeGiftsService {
  private readonly logger = new Logger(ProgrammeGiftsService.name);
  private readonly lastVerifiedAt = new Map<string, number>();

  constructor(
    private readonly settings: SettingsService,
    private readonly paystack: PaystackAdapter,
    private readonly ledger: ProgrammeLedgerService,
    private readonly receiptEmail: ResendProgrammeReceiptEmailAdapter,
    private readonly vaultContributions: VaultContributionsService,
    private readonly recurring: RecurringGiftsCoreService,
    // Last, so tests that never use WhatsApp needn't pass them.
    private readonly giverWhatsApp?: GiverWhatsAppService,
    private readonly whatsApp?: TwilioWhatsAppAdapter,
  ) {}

  /**
   * The Paystack subaccount a programme's gifts settle into: its own,
   * set by an approved waqf_programme.subaccount_set (need-based NB2,
   * 2026-11-19). Undefined until then, and no gift is taken.
   */
  private subaccount(programme: { paystackSubaccountCode: string | null }): string | undefined {
    return programme.paystackSubaccountCode ?? undefined;
  }

  /** Established clinic waqfs, for a Founder choosing where to give. */
  /**
   * Established programmes of one product, for its public list (e.g. /clinics)
   * and a Founder's Clinic support page. `available` is the same test the
   * giving page uses: an approved deed, and the subaccount set.
   */
  async publicProgrammes(product: WaqfProgrammeProduct) {
    const programmes = await prisma.waqfProgramme.findMany({
      where: { status: "established", product },
      orderBy: { establishedAt: "asc" },
      select: {
        name: true,
        slug: true,
        city: true,
        description: true,
        paystackSubaccountCode: true,
        deeds: { where: { status: "approved" }, select: { id: true } },
      },
    });
    return programmes.map(({ deeds, paystackSubaccountCode, ...p }) => ({
      ...p,
      available: deeds.length > 0 && this.subaccount({ paystackSubaccountCode }) !== undefined,
    }));
  }

  /** What the public giving page needs: the clinic, whether it's taking gifts, and the deed to accept. */
  async givingTerms(slug: string) {
    const clinic = await prisma.waqfProgramme.findUnique({
      where: { slug },
      include: { deeds: { where: { status: "approved" }, select: { id: true, version: true, text: true, textHash: true } } },
    });
    if (!clinic) throw new NotFoundException("Clinic not found.");
    const deed = clinic.deeds[0] ?? null;
    return {
      clinic: { name: clinic.name, slug: clinic.slug, city: clinic.city, description: clinic.description },
      available: clinic.status === "established" && deed !== null && this.subaccount(clinic) !== undefined,
      currency: CURRENCY,
      minimumAmount: CLINIC_PUBLIC_MINIMUM_NGN,
      deed,
    };
  }

  async initiate(input: InitiateProgrammeGiftInput, ipAddress?: string, monthly?: ProgrammeMonthlyMode) {
    if (input.monthly && !monthly) monthly = { type: "setup" };
    const scheduled = monthly && monthly.type !== "setup" ? monthly.gift : null;
    if (monthly?.type === "setup" && !input.donorEmail && !input.donorWhatsApp) {
      throw new BadRequestException("Giving monthly needs your email or WhatsApp number, for receipts and to manage or cancel it.");
    }
    const { clinic, subaccount } = await this.openClinic(scheduled ? { id: scheduled.programmeId! } : { slug: input.slug });
    const what = this.whatIsGiven(scheduled, input, CLINIC_PUBLIC_MINIMUM_NGN);
    const deed = await this.acceptedDeed(clinic, what);
    const feeCover = this.feeCoverFor(what.amount, what.coverFee);
    // A later month reuses the gift's own contacts; anything a giver starts must prove a WhatsApp number first.
    const contact: GiverContact = scheduled
      ? { email: scheduled.email, whatsapp: scheduled.whatsappNumber }
      : {
          email: normalizeEmail(input.donorEmail),
          whatsapp: input.donorWhatsApp ? await this.requireGiverWhatsApp().assertProof(input.donorWhatsApp, input.whatsappProof) : null,
        };
    const id = randomUUID();

    // Reserve the row before calling Paystack, under the same per-giver
    // lock Vault gifts take (prefix ""), so a Vault gift and a clinic gift
    // started together see each other in the threshold check.
    let recurringGift: RecurringGift | null = scheduled;
    const gift = await prisma.$transaction(async (tx) => {
      await lockGiverContact(tx, "", contact);
      const donor = hasContact(contact)
        ? await this.vaultContributions.findOrCreateDonor(
            tx,
            contact,
            { currency: CURRENCY, donorFullName: input.donorFullName, idType: input.idType, idNumber: input.idNumber },
            what.amount,
            { scheduledCharge: scheduled !== null },
          )
        : null;
      const recurringLink = await this.linkMonthly(tx, monthly, id, {
        email: contact.email,
        whatsappNumber: contact.whatsapp,
        programmeId: clinic.id,
        pot: what.pot,
        deed,
        amount: what.amount,
        coverFee: what.coverFee,
      });
      if (recurringLink.gift) recurringGift = recurringLink.gift;
      const created = await tx.programmeGift.create({
        data: {
          id,
          programmeId: clinic.id,
          pot: what.pot,
          donorId: donor?.id,
          contactEmail: contact.email,
          contactWhatsApp: contact.whatsapp,
          amount: what.amount,
          feeCover,
          currency: CURRENCY,
          provider: "paystack",
          providerReference: id,
          settlementSubaccount: subaccount,
          deedId: deed?.id,
          deedTextHash: deed?.textHash,
          recurringGiftId: recurringLink.recurringGiftId,
          recurringPeriod: recurringLink.recurringPeriod,
          ipAddress,
        },
      });
      await this.audit(tx, "programme_gift.initiated", created.id, { type: "public_donor", donorId: created.donorId }, null, created);
      return created;
    });
    return this.checkout(gift, clinic, subaccount, { type: "public_donor", donorId: gift.donorId }, monthly, recurringGift);
  }

  /**
   * What a signed-in Founder's giving form needs: the same terms, with
   * their own minimum — ₦250,000 for their first gift to this clinic,
   * ₦5,000 after (owner's decision, 2026-11-17).
   */
  async founderGivingTerms(founderId: string, slug: string) {
    const terms = await this.givingTerms(slug);
    const clinic = await prisma.waqfProgramme.findUniqueOrThrow({ where: { slug } });
    return { ...terms, minimumAmount: await this.founderMinimum(founderId, clinic.id) };
  }

  /**
   * A Founder's gift (2026-11-17, slice 4a): recorded as theirs, given by
   * their primary contact (the controller checks), who must have verified
   * their email and WhatsApp, like every Founder self-service payment.
   * No AML ID threshold: a Founder is a verified account holder, as for
   * Waqf Fund contributions. The receipt goes to the signed-in user. A
   * later month of a monthly gift (slice 4b) is given by whoever is the
   * primary contact when it's charged.
   */
  async initiateAsFounder(founderId: string, userId: string | null, input: InitiateFounderProgrammeGiftInput, ipAddress?: string, monthly?: ProgrammeMonthlyMode) {
    if (input.monthly && !monthly) monthly = { type: "setup" };
    const scheduled = monthly && monthly.type !== "setup" ? monthly.gift : null;
    await assertFounderVerified(prisma, founderId);
    const giverUserId = userId ?? (await findPrimaryContactMembership(prisma, founderId))?.userId;
    if (!giverUserId) throw new BadRequestException("This Founder has no active primary contact to give.");
    const { clinic, subaccount } = await this.openClinic(scheduled ? { id: scheduled.programmeId! } : { slug: input.slug });
    const what = this.whatIsGiven(scheduled, input, await this.founderMinimum(founderId, clinic.id));
    const deed = await this.acceptedDeed(clinic, what);
    const feeCover = this.feeCoverFor(what.amount, what.coverFee);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: giverUserId } });
    const actor: GiftActor = { type: "founder_user", userId: giverUserId, founderId };
    const id = randomUUID();

    let recurringGift: RecurringGift | null = scheduled;
    const gift = await prisma.$transaction(async (tx) => {
      // A monthly gift's card is saved under the account email, which also gets its reminders.
      const recurringLink = await this.linkMonthly(tx, monthly, id, {
        email: user.email,
        whatsappNumber: null,
        founderId,
        programmeId: clinic.id,
        pot: what.pot,
        deed,
        amount: what.amount,
        coverFee: what.coverFee,
      });
      if (recurringLink.gift) recurringGift = recurringLink.gift;
      const created = await tx.programmeGift.create({
        data: {
          id,
          programmeId: clinic.id,
          pot: what.pot,
          founderId,
          initiatedByUserId: giverUserId,
          contactEmail: user.email,
          contactWhatsApp: user.whatsappVerifiedAt ? user.whatsappNumber : null,
          amount: what.amount,
          feeCover,
          currency: CURRENCY,
          provider: "paystack",
          providerReference: id,
          settlementSubaccount: subaccount,
          deedId: deed?.id,
          deedTextHash: deed?.textHash,
          recurringGiftId: recurringLink.recurringGiftId,
          recurringPeriod: recurringLink.recurringPeriod,
          ipAddress,
        },
      });
      await this.audit(tx, "programme_gift.initiated", created.id, actor, null, created);
      return created;
    });
    return this.checkout(gift, clinic, subaccount, actor, monthly, recurringGift);
  }

  /** The amount, pot, fee choice and deed: from the monthly gift for a later month, else from the giver's form. */
  private whatIsGiven(
    scheduled: RecurringGift | null,
    input: { pot: WaqfProgrammePot; amount: string; coverFee: boolean; deedId?: string; deedTextHash?: string },
    minimum: string,
  ) {
    if (scheduled) {
      return {
        pot: scheduled.programmePot!,
        amount: new Prisma.Decimal(scheduled.amount),
        coverFee: scheduled.coverFee,
        deedId: scheduled.programmeDeedId ?? undefined,
        deedTextHash: scheduled.programmeDeedTextHash ?? undefined,
      };
    }
    return { pot: input.pot, amount: this.checkedAmount(input.amount, minimum), coverFee: input.coverFee, deedId: input.deedId, deedTextHash: input.deedTextHash };
  }

  /**
   * Ties the payment being reserved to its monthly gift: creates the gift
   * (setup), claims a paused gift's card update, or names the month a
   * scheduled charge collects. Inside the payment's own transaction.
   */
  private async linkMonthly(
    tx: Prisma.TransactionClient,
    monthly: ProgrammeMonthlyMode | undefined,
    reference: string,
    setup: {
      email: string | null;
      whatsappNumber: string | null;
      founderId?: string;
      programmeId: string;
      pot: WaqfProgrammePot;
      deed: { id: string; textHash: string } | null;
      amount: Prisma.Decimal;
      coverFee: boolean;
    },
  ): Promise<{ recurringGiftId?: string; recurringPeriod: string | null; gift?: RecurringGift }> {
    if (!monthly) return { recurringPeriod: null };
    if (monthly.type === "charge") return { recurringGiftId: monthly.gift.id, recurringPeriod: monthly.period };
    if (monthly.type === "card_update") {
      if (!(await this.recurring.startCardUpdate(tx, monthly.gift, reference))) {
        throw new BadRequestException("This monthly gift isn't waiting for a new card.");
      }
      return { recurringGiftId: monthly.gift.id, recurringPeriod: null };
    }
    const gift = await this.recurring.createSetup(tx, {
      kind: "programme",
      email: setup.email,
      whatsappNumber: setup.whatsappNumber,
      amount: setup.amount,
      reference,
      founderId: setup.founderId,
      coverFee: setup.coverFee,
      programmeId: setup.programmeId,
      programmePot: setup.pot,
      programmeDeedId: setup.deed?.id,
      programmeDeedTextHash: setup.deed?.textHash,
    });
    return { recurringGiftId: gift.id, recurringPeriod: gift.nextPeriod, gift };
  }

  /** A monthly gift's payments, newest first (MonthlyGiftProduct.charges). */
  chargesForGift(recurringGiftId: string) {
    return prisma.programmeGift.findMany({
      where: { recurringGiftId },
      orderBy: { createdAt: "desc" },
      select: { id: true, providerReference: true, amount: true, currency: true, status: true, recurringPeriod: true, createdAt: true, confirmedAt: true },
    });
  }

  /** A Founder's gifts to every clinic waqf, newest first, and what's confirmed in each pot. */
  async listForFounder(founderId: string) {
    const gifts = await prisma.programmeGift.findMany({
      where: { founderId },
      orderBy: { createdAt: "desc" },
      include: { programme: { select: { name: true, slug: true, city: true } }, deed: { select: { version: true } } },
    });
    const totals = new Map<string, { clinic: { name: string; slug: string; city: string }; endowment: Prisma.Decimal; running: Prisma.Decimal }>();
    for (const g of gifts) {
      if (g.status !== "confirmed") continue;
      const t = totals.get(g.programmeId) ?? { clinic: g.programme, endowment: new Prisma.Decimal(0), running: new Prisma.Decimal(0) };
      t[g.pot] = t[g.pot].plus(g.amount);
      totals.set(g.programmeId, t);
    }
    return {
      clinics: [...totals.values()].map((t) => ({ clinic: t.clinic, endowment: t.endowment.toFixed(2), running: t.running.toFixed(2) })),
      gifts: gifts.map((g) => ({
        ...this.publicView(g, g.programme),
        deedVersion: g.deed?.version ?? null,
      })),
    };
  }

  private async founderMinimum(founderId: string, programmeId: string): Promise<string> {
    const given = await prisma.programmeGift.count({ where: { founderId, programmeId, status: "confirmed" } });
    return given > 0 ? CLINIC_PUBLIC_MINIMUM_NGN : CLINIC_FOUNDER_FIRST_GIFT_MINIMUM_NGN;
  }

  private async openClinic(where: { slug: string } | { id: string }) {
    const clinic = await prisma.waqfProgramme.findUnique({ where });
    if (!clinic) throw new NotFoundException("Clinic not found.");
    if (clinic.status !== "established") throw new BadRequestException(`${clinic.name} isn't taking gifts yet.`);
    const subaccount = this.subaccount(clinic);
    if (!subaccount) {
      // Owner's decision: clinic waqf money never settles into Birr's main
      // balance, so no gift is taken until its own account is set up.
      throw new ServiceUnavailableException(`Gifts to ${clinic.name} aren't open yet.`);
    }
    return { clinic, subaccount };
  }

  private checkedAmount(raw: string, minimum: string) {
    const amount = new Prisma.Decimal(raw);
    if (amount.lt(minimum) || amount.decimalPlaces() > 2) {
      throw new BadRequestException(`Please give at least ₦${Number(minimum).toLocaleString("en-NG")}, in naira and kobo.`);
    }
    return amount;
  }

  private feeCoverFor(amount: Prisma.Decimal, coverFee: boolean) {
    return new Prisma.Decimal(coverFee ? processingFeeCover(amount.toFixed(2)) : "0");
  }

  /** An endowment gift's deed: the approved version, exactly as the giver read it. */
  private async acceptedDeed(clinic: { id: string }, input: { pot: WaqfProgrammePot; deedId?: string; deedTextHash?: string }) {
    if (input.pot !== "endowment") return null;
    const approved = await prisma.waqfProgrammeDeed.findFirst({ where: { programmeId: clinic.id, status: "approved" } });
    if (!approved || approved.id !== input.deedId || approved.textHash !== input.deedTextHash) {
      throw new BadRequestException({
        statusCode: 400,
        code: "DEED_CHANGED",
        message: "The waqf's deed has changed since you read it. Please reload the page and read it again.",
      });
    }
    return approved;
  }

  /**
   * Paystack for a reserved gift, into the clinic waqf's subaccount: a
   * checkout (card only when it starts or updates a monthly gift), or a
   * charge on the monthly gift's saved card.
   */
  private async checkout(
    gift: { id: string; amount: Prisma.Decimal; feeCover: Prisma.Decimal; contactEmail: string | null; pot: WaqfProgrammePot; currency: string; status: string; createdAt: Date; confirmedAt: Date | null },
    clinic: { name: string; slug: string },
    subaccount: string,
    actor: GiftActor,
    monthly?: ProgrammeMonthlyMode,
    recurringGift?: RecurringGift | null,
  ) {
    const id = gift.id;
    // Into the clinic waqf's subaccount; only the fee cover to Birr's main account.
    const split = { subaccount, mainAccountShareMinorUnits: Number(gift.feeCover.times(100).toFixed(0)) };
    const amount = gift.amount.plus(gift.feeCover).toFixed(2);
    let result;
    let charge: SavedCardChargeResult | undefined;
    try {
      if (monthly?.type === "charge") {
        charge = await this.paystack.chargeSavedCard({
          authorizationCode: this.recurring.decryptAuthorization(monthly.gift),
          email: paystackEmailForGift(monthly.gift),
          amount,
          currency: CURRENCY,
          reference: id,
          split,
        });
        result = { providerReference: id, clientPayload: null };
      } else {
        result = await this.paystack.createPayment({
          amount,
          currency: CURRENCY,
          reference: id,
          // A monthly gift's card is saved under the gift's email, or its stand-in.
          payerEmail: recurringGift ? paystackEmailForGift(recurringGift) : (gift.contactEmail ?? undefined),
          returnPath: "clinic-gifts",
          split,
          cardOnly: monthly !== undefined,
        });
      }
    } catch (err) {
      // Don't leave a reservation counting toward the giver's threshold.
      await prisma.$transaction(async (tx) => {
        const failed = await tx.programmeGift.update({ where: { id }, data: { status: "failed" } });
        await this.audit(tx, "programme_gift.failed", id, actor, gift, failed);
      });
      throw err;
    }

    if (charge) {
      // Usually settled straight away; "pending" waits for the webhook.
      const settled =
        charge.status === "pending" ? this.publicView(gift, clinic) : ((await this.applyProviderOutcome(id, charge.status, charge.providerPaymentId)) ?? this.publicView(gift, clinic));
      return { gift: settled, clientPayload: null, charge };
    }
    if (result.providerReference === id) return { gift: this.publicView(gift, clinic), clientPayload: result.clientPayload };
    const withReference = await prisma.$transaction(async (tx) => {
      const updated = await tx.programmeGift.update({ where: { id }, data: { providerReference: result.providerReference } });
      await this.audit(tx, "programme_gift.payment_created", id, actor, gift, updated);
      return updated;
    });
    return { gift: this.publicView(withReference, clinic), clientPayload: result.clientPayload };
  }

  /**
   * Joins ContributionsController's webhook chain: null when the reference
   * isn't a clinic gift (or the event isn't Paystack), so the chain carries on.
   */
  async handleWebhook(provider: ContributionProvider, rawBody: Buffer, headers: Record<string, string | undefined>) {
    if (provider !== "paystack") return null;
    const result = await this.paystack.verifyAndParseWebhook(rawBody, headers);
    if (!result) throw new UnauthorizedException("Invalid webhook signature.");
    const gift = await prisma.programmeGift.findUnique({ where: { providerReference: result.providerReference }, select: { id: true } });
    if (!gift) return null;
    return this.applyProviderOutcome(result.providerReference, result.status, result.providerPaymentId);
  }

  /**
   * Called by the giver's return page, and by daily reconciliation: asks
   * Paystack directly, so a gift never stays pending because a webhook was
   * lost. Confirms only when Paystack charged exactly the gift plus fee cover.
   */
  async reconcile(id: string) {
    const gift = await prisma.programmeGift.findUnique({ where: { id } });
    if (!gift) return null;
    const last = this.lastVerifiedAt.get(id) ?? 0;
    if (gift.status === "pending" && this.paystack.verifyPayment && Date.now() - last >= VERIFY_MIN_INTERVAL_MS) {
      this.lastVerifiedAt.set(id, Date.now());
      const verified = await this.paystack.verifyPayment(gift.providerReference);
      if (verified && verified.status !== "pending") {
        const expectedMinor = Number(gift.amount.plus(gift.feeCover).times(100).toFixed(0));
        const matches = verified.amountMinorUnits === expectedMinor && verified.currency === gift.currency;
        if (verified.status === "confirmed" && !matches) {
          this.logger.error(
            `ProgrammeGift "${id}" verify mismatch: Paystack reports ${verified.amountMinorUnits} ${verified.currency}, ` +
              `record is ${expectedMinor} ${gift.currency} — left pending for review.`,
          );
        } else {
          await this.applyProviderOutcome(gift.providerReference, verified.status, verified.providerPaymentId);
        }
      }
    }
    return this.findPublicStatus(id);
  }

  /**
   * The one place a pending gift becomes confirmed or failed. A conditional
   * claim on "pending", so a retried webhook can never post it twice; the
   * ledger's unique (source, sourceId) is the second guard.
   */
  private async applyProviderOutcome(providerReference: string, status: "confirmed" | "failed", providerPaymentId?: string) {
    const gift = await prisma.programmeGift.findUnique({ where: { providerReference }, include: { programme: true, deed: { select: { version: true } } } });
    if (!gift) return null;
    if (gift.status !== "pending") return this.publicView(gift, gift.programme);

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await tx.programmeGift.updateMany({
        where: { id: gift.id, status: "pending" },
        data:
          status === "confirmed"
            ? { status: "confirmed", confirmedAt: new Date(), providerPaymentId: providerPaymentId ?? gift.providerPaymentId }
            : { status: "failed" },
      });
      if (claim.count !== 1) return null;
      const after = await tx.programmeGift.findUniqueOrThrow({ where: { id: gift.id } });
      if (status === "confirmed") {
        // Only the gift itself: the fee cover settled to Birr's main account.
        const accounts = GIFT_ACCOUNTS[after.pot];
        await this.ledger.post(tx, {
          programmeId: after.programmeId,
          description: after.pot === "endowment" ? "Gift to the endowment (Paystack)" : "Gift to the running fund (Paystack)",
          currency: after.currency,
          source: "gift",
          sourceId: after.id,
          actorType: "system",
          lines: [
            { accountCode: accounts.cash, debit: after.amount },
            { accountCode: accounts.credit, credit: after.amount },
          ],
        });
      }
      const { programme: _clinic, deed: _deed, ...before } = gift;
      // The webhook or a return page settles it, not the giver, so a Founder's gift is logged against their user.
      const actor: GiftActor =
        gift.founderId && gift.initiatedByUserId
          ? { type: "founder_user", userId: gift.initiatedByUserId, founderId: gift.founderId }
          : { type: "public_donor", donorId: gift.donorId };
      await this.audit(tx, `programme_gift.${status}`, gift.id, actor, before, after);
      return after;
    });

    if (!outcome) return this.findPublicStatus(gift.id);
    // A monthly gift's card checkout: save the card and schedule the next month.
    if (status === "confirmed" && outcome.recurringGiftId) {
      this.recurring.afterPaymentConfirmed(outcome.providerReference, outcome.recurringPeriod).catch((err) => {
        this.logger.error(`Failed to save the card for monthly clinic gift "${outcome.recurringGiftId}":`, err instanceof Error ? err.stack : String(err));
      });
    }
    if (status === "confirmed") this.sendReceipts(outcome, gift.programme, gift.deed?.version ?? null);
    return this.publicView(outcome, gift.programme);
  }

  /** Only to what was given with this gift; never holds up the confirmation. */
  private sendReceipts(
    gift: { id: string; pot: WaqfProgrammePot; amount: Prisma.Decimal; feeCover: Prisma.Decimal; contactEmail: string | null; contactWhatsApp: string | null },
    programme: { name: string; product: WaqfProgrammeProduct },
    deedVersion: number | null,
  ) {
    const fail = (channel: string) => (err: unknown) =>
      this.logger.error(`Failed to send the ${channel} receipt for clinic gift "${gift.id}":`, err instanceof Error ? err.stack : String(err));
    if (gift.contactEmail) {
      this.receiptEmail
        .sendReceipt({
          to: gift.contactEmail,
          clinicName: programme.name,
          product: programme.product,
          pot: gift.pot,
          amount: gift.amount.toFixed(2),
          feeCover: gift.feeCover.toFixed(2),
          giftId: gift.id,
          deedVersion,
        })
        .catch(fail("email"));
    }
    if (gift.contactWhatsApp && this.whatsApp) {
      const amount = moneyText(gift.amount);
      const givenTo = `${programme.name} (${productOf(programme).potLabels[gift.pot].toLowerCase()})`;
      const text = whatsAppNotice("Thank you for your gift", [`We received ${amount} for ${givenTo}.`, `Receipt reference: ${gift.id}`]);
      this.whatsApp.sendTemplate(gift.contactWhatsApp, "gift_receipt", [amount, givenTo, gift.id], text).catch(fail("WhatsApp"));
    }
  }

  private requireGiverWhatsApp(): GiverWhatsAppService {
    if (!this.giverWhatsApp) throw new BadRequestException("Giving by WhatsApp isn't available.");
    return this.giverWhatsApp;
  }

  private audit(tx: Prisma.TransactionClient, action: string, entityId: string, actor: GiftActor, before: unknown, after: unknown) {
    return tx.auditLog.create({
      data: {
        ...(actor.type === "public_donor"
          ? { actorType: "public_donor" as const, actorDonorId: actor.donorId ?? undefined }
          : { actorType: "founder_user" as const, actorUserId: actor.userId, actorFounderId: actor.founderId }),
        action,
        entityType: "ProgrammeGift",
        entityId,
        before: (before ?? undefined) as any,
        after: after as any,
      },
    });
  }

  // The id travels in the giver's return URL, so only an allow-list of
  // fields: never the giver, contacts, IP or settlement account.
  private publicView(
    g: { id: string; pot: WaqfProgrammePot; amount: Prisma.Decimal; feeCover: Prisma.Decimal; currency: string; status: string; createdAt: Date; confirmedAt: Date | null },
    clinic: { name: string; slug: string },
  ) {
    return {
      id: g.id,
      clinic: { name: clinic.name, slug: clinic.slug },
      pot: g.pot,
      amount: g.amount.toFixed(2),
      feeCover: g.feeCover.toFixed(2),
      currency: g.currency,
      status: g.status,
      createdAt: g.createdAt,
      confirmedAt: g.confirmedAt,
    };
  }

  async findPublicStatus(id: string) {
    const gift = await prisma.programmeGift.findUnique({
      where: { id },
      include: { programme: { select: { name: true, slug: true } }, recurringGift: { select: { status: true } } },
    });
    // Whether this was the first payment of a monthly gift, for the thank-you page.
    return gift ? { ...this.publicView(gift, gift.programme), recurringGift: gift.recurringGift } : null;
  }

  /** Staff: a clinic waqf's gifts, newest first, with who gave where known. */
  listForClinic(programmeId: string) {
    return prisma.programmeGift.findMany({
      where: { programmeId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        pot: true,
        amount: true,
        feeCover: true,
        currency: true,
        status: true,
        createdAt: true,
        confirmedAt: true,
        contactEmail: true,
        contactWhatsApp: true,
        deed: { select: { version: true } },
        donor: { select: { id: true, fullName: true } },
      },
    });
  }
}
