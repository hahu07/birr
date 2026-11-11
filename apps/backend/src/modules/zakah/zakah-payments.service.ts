import { randomUUID } from "crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { IsBoolean, IsEmail, IsEnum, IsInt, IsNumberString, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { ContributionProvider, IdType, prisma, Prisma } from "@birr/db";
import { processingFeeCover } from "@birr/zakah";
import { EncryptionService } from "../../common/settings/encryption.service";
import { SettingsService } from "../../common/settings/settings.service";
import { MAX_PUBLIC_CONTRIBUTION_AMOUNT, MaxDecimal } from "../../common/validation/max-decimal";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { ResendZakahReceiptEmailAdapter } from "./zakah-receipt-email.adapter";
import { ZAKAH_BANK_ACCOUNT_CODE, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE, ZakahLedgerService } from "./zakah-ledger.service";
import { ZAKAH_MINIMUM_PAYMENT_NGN, ZAKAH_WAKALAH_TERMS } from "./zakah-terms";

const CURRENCY = "NGN";

export class InitiateZakahPaymentInput {
  // Public route: MaxDecimal is a blunt sanity ceiling, not a business rule.
  @IsNumberString()
  @MaxDecimal(MAX_PUBLIC_CONTRIBUTION_AMOUNT)
  @IsPositiveDecimal()
  amount!: string;

  /** Add the processing fee on top, so the zakah reaches recipients in full without Birr paying the fee. */
  @IsBoolean()
  coverFee!: boolean;

  /** Must equal ZAKAH_WAKALAH_TERMS.version — the payer accepted exactly the current wording. */
  @IsString()
  wakalahConsentVersion!: string;

  // Optional, like Vault (owner's decision, 2026-11-11): no email means no
  // receipt and no AML threshold check — see ZakahPayer's schema comment.
  @IsOptional()
  @IsEmail()
  payerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  payerFullName?: string;

  @IsOptional()
  @IsEnum(IdType)
  idType?: IdType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  idNumber?: string;

  // Which ruleset version produced the figure, when it came from the
  // calculator. Recorded, never trusted for anything else.
  @IsOptional()
  @IsString()
  @MaxLength(49)
  rulesetKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  rulesetVersion?: number;
}

// Same as VaultContributionsService: a pending payment counts toward the
// payer's ID threshold for a day, then stops (an abandoned checkout).
const PENDING_COUNTS_TOWARD_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const VERIFY_MIN_INTERVAL_MS = 5_000;

function normalizeEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function normalizeIdNumber(idNumber: string): string {
  return idNumber.replace(/[\s-]/g, "").toUpperCase();
}

// Never write the (encrypted) ID number into the audit trail — only that one exists.
function payerAuditSnapshot<T extends { idNumberEncrypted: string | null }>(payer: T) {
  const { idNumberEncrypted, ...rest } = payer;
  return { ...rest, idNumberOnFile: idNumberEncrypted != null };
}

/**
 * Paying zakah through Birr. Birr receives it as the payer's agent
 * (wakil): it settles into a separate zakah bank account through a
 * Paystack subaccount, and is booked in zakah's own ledger as money held
 * for recipients. Mirrors VaultContributionsService's flow (reserve the
 * row, then call Paystack; confirm exactly once from either the webhook
 * or the payer's return), with three differences: no payment is taken
 * until the zakah subaccount is configured; the payer may add the
 * processing fee on top; and the payer must accept the current agency
 * (wakalah) wording.
 *
 * Audit rows use actorType "public_donor" with no actorDonorId (that
 * column points at VaultDonor); the payer is identified by payerId in
 * each row's snapshot.
 */
@Injectable()
export class ZakahPaymentsService {
  private readonly logger = new Logger(ZakahPaymentsService.name);
  private readonly lastVerifiedAt = new Map<string, number>();

  constructor(
    private readonly encryption: EncryptionService,
    private readonly settings: SettingsService,
    private readonly paystack: PaystackAdapter,
    private readonly ledger: ZakahLedgerService,
    private readonly receiptEmail: ResendZakahReceiptEmailAdapter,
  ) {}

  private async zakahSubaccount(): Promise<string | undefined> {
    const code = (await this.settings.get("paystack", "ZAKAH_SUBACCOUNT_CODE"))?.trim();
    return code ? code : undefined;
  }

  /** What the payment form needs before anyone pays: whether payments are open, and the exact wording to accept. */
  async paymentTerms() {
    return {
      available: (await this.zakahSubaccount()) !== undefined,
      currency: CURRENCY,
      minimumAmount: ZAKAH_MINIMUM_PAYMENT_NGN,
      wakalah: ZAKAH_WAKALAH_TERMS,
    };
  }

  async initiate(input: InitiateZakahPaymentInput, ipAddress?: string) {
    const subaccount = await this.zakahSubaccount();
    if (!subaccount) {
      // Owner's decision: zakah never settles into Birr's main account,
      // so no zakah payment is taken until the zakah account is set up.
      throw new ServiceUnavailableException("Zakah payments aren't open yet.");
    }
    if (input.wakalahConsentVersion !== ZAKAH_WAKALAH_TERMS.version) {
      throw new BadRequestException({
        statusCode: 400,
        code: "WAKALAH_TERMS_CHANGED",
        message: "The terms for paying zakah through Birr have changed. Please reload the page and read them again.",
      });
    }
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lt(ZAKAH_MINIMUM_PAYMENT_NGN) || amount.decimalPlaces() > 2) {
      throw new BadRequestException(`Please pay at least ₦${ZAKAH_MINIMUM_PAYMENT_NGN}, in naira and kobo.`);
    }
    const feeCover = new Prisma.Decimal(input.coverFee ? processingFeeCover(amount.toFixed(2)) : "0");
    const rulesetRef = await this.resolveRuleset(input);
    const metalPrice = await prisma.zakahMetalPrice.findFirst({ orderBy: [{ asOf: "desc" }, { createdAt: "desc" }] });

    const payerEmail = normalizeEmail(input.payerEmail);
    const id = randomUUID();

    // Reserve the row before calling Paystack, under a per-email lock, so
    // two payments started together see each other in the threshold check.
    const payment = await prisma.$transaction(async (tx) => {
      if (payerEmail) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"zakah_payer:" + payerEmail}))`;
      const payer = payerEmail ? await this.findOrCreatePayer(tx, payerEmail, input, amount) : null;
      const payment = await tx.zakahPayment.create({
        data: {
          id,
          payerId: payer?.id,
          amount,
          feeCover,
          currency: CURRENCY,
          provider: "paystack",
          providerReference: id,
          settlementSubaccount: subaccount,
          wakalahConsentVersion: input.wakalahConsentVersion,
          rulesetKey: rulesetRef?.key,
          rulesetVersion: rulesetRef?.version,
          metalPriceId: metalPrice?.id,
          ipAddress,
        },
      });
      await this.audit(tx, "zakah_payment.initiated", payment.id, null, payment);
      return payment;
    });

    let result;
    try {
      result = await this.paystack.createPayment({
        amount: amount.plus(feeCover).toFixed(2),
        currency: CURRENCY,
        reference: id,
        payerEmail,
        returnPath: "zakah-payments",
        split: { subaccount, mainAccountShareMinorUnits: Number(feeCover.times(100).toFixed(0)) },
      });
    } catch (err) {
      // Don't leave a reservation counting toward the payer's threshold
      // for a payment that never started.
      await prisma.$transaction(async (tx) => {
        const failed = await tx.zakahPayment.update({ where: { id }, data: { status: "failed" } });
        await this.audit(tx, "zakah_payment.failed", id, payment, failed);
      });
      throw err;
    }

    if (result.providerReference === id) return { payment: this.publicView(payment), clientPayload: result.clientPayload };
    const withReference = await prisma.$transaction(async (tx) => {
      const updated = await tx.zakahPayment.update({ where: { id }, data: { providerReference: result.providerReference } });
      await this.audit(tx, "zakah_payment.payment_created", id, payment, updated);
      return updated;
    });
    return { payment: this.publicView(withReference), clientPayload: result.clientPayload };
  }

  private async resolveRuleset(input: InitiateZakahPaymentInput) {
    if (!input.rulesetKey || !input.rulesetVersion) return null;
    const ruleset = await prisma.zakahRuleset.findUnique({
      where: { key_version: { key: input.rulesetKey, version: input.rulesetVersion } },
    });
    // A draft can never have produced a payer-facing figure.
    if (!ruleset || ruleset.status === "draft") {
      throw new BadRequestException("That ruleset version isn't one the calculator has used. Please reload the page.");
    }
    return { key: ruleset.key, version: ruleset.version };
  }

  /**
   * Find-or-create by email, and enforce the AML identity requirement:
   * once this payer's zakah (confirmed, plus pending from the last day)
   * reaches the NGN threshold in VaultDonorThreshold — Birr's one
   * per-currency AML threshold table — a full name and ID are required,
   * and an ID already on file must be re-entered and match. Existing
   * identity is never overwritten from this unauthenticated input, only
   * blank fields filled. Same rules, and the same accepted gaps, as
   * VaultContributionsService.findOrCreateDonor.
   */
  private async findOrCreatePayer(tx: Prisma.TransactionClient, email: string, input: InitiateZakahPaymentInput, amount: Prisma.Decimal) {
    const existing = await tx.zakahPayer.findUnique({ where: { email } });
    const threshold = await tx.vaultDonorThreshold.findUnique({ where: { currency: CURRENCY } });

    let total = amount;
    if (existing) {
      const prior = await tx.zakahPayment.aggregate({
        where: {
          payerId: existing.id,
          OR: [{ status: "confirmed" }, { status: "pending", createdAt: { gte: new Date(Date.now() - PENDING_COUNTS_TOWARD_THRESHOLD_MS) } }],
        },
        _sum: { amount: true },
      });
      total = total.plus(prior._sum.amount ?? 0);
    }

    const identifiedOnFile = existing?.idType != null && existing.idNumberEncrypted != null;
    if (threshold && threshold.thresholdAmount.gt(0) && total.gte(threshold.thresholdAmount)) {
      if (identifiedOnFile) {
        if (!input.idType || !input.idNumber) {
          throw new BadRequestException({
            statusCode: 400,
            code: "IDENTITY_CONFIRMATION_REQUIRED",
            message: "For a payment of this size we need to confirm your identity. Please re-enter the ID you gave us before.",
          });
        }
        const onFile = normalizeIdNumber(this.encryption.decrypt(existing!.idNumberEncrypted!));
        if (existing!.idType !== input.idType || onFile !== normalizeIdNumber(input.idNumber)) {
          throw new BadRequestException({
            statusCode: 400,
            code: "IDENTITY_MISMATCH",
            message: "Those ID details don't match what we have on file for this email. Please check them, or contact Birr.",
          });
        }
      } else if (!input.payerFullName || !input.idType || !input.idNumber) {
        throw new BadRequestException({
          statusCode: 400,
          code: "IDENTITY_REQUIRED",
          message: "Because of the total you've paid through Birr, we're required to confirm your identity. Please add your full name and an ID.",
        });
      }
    }

    const fill: Prisma.ZakahPayerUpdateInput = {};
    if (!existing?.fullName && input.payerFullName?.trim()) fill.fullName = input.payerFullName.trim();
    if (!identifiedOnFile && input.idType && input.idNumber) {
      fill.idType = input.idType;
      fill.idNumberEncrypted = this.encryption.encrypt(input.idNumber);
    }

    if (existing) {
      if (Object.keys(fill).length === 0) return existing;
      const updated = await tx.zakahPayer.update({ where: { id: existing.id }, data: fill });
      await tx.auditLog.create({
        data: {
          actorType: "public_donor",
          action: "zakah_payer.identity_captured",
          entityType: "ZakahPayer",
          entityId: existing.id,
          before: payerAuditSnapshot(existing) as any,
          after: payerAuditSnapshot(updated) as any,
        },
      });
      return updated;
    }
    const created = await tx.zakahPayer.create({
      data: {
        email,
        fullName: fill.fullName as string | undefined,
        idType: fill.idType as IdType | undefined,
        idNumberEncrypted: fill.idNumberEncrypted as string | undefined,
      },
    });
    await tx.auditLog.create({
      data: {
        actorType: "public_donor",
        action: "zakah_payer.created",
        entityType: "ZakahPayer",
        entityId: created.id,
        after: payerAuditSnapshot(created) as any,
      },
    });
    return created;
  }

  /**
   * Joins the end of ContributionsController's webhook chain: returns null
   * when the reference isn't a zakah payment (or the event isn't Paystack),
   * so the chain's "null means not mine" contract holds.
   */
  async handleWebhook(provider: ContributionProvider, rawBody: Buffer, headers: Record<string, string | undefined>) {
    if (provider !== "paystack") return null;
    const result = await this.paystack.verifyAndParseWebhook(rawBody, headers);
    if (!result) throw new UnauthorizedException("Invalid webhook signature.");
    return this.applyProviderOutcome(result.providerReference, result.status, result.providerPaymentId);
  }

  /**
   * Called by the public status page when the payer returns from
   * checkout: asks Paystack directly, so a payment never stays pending
   * just because its webhook was delayed or lost. Confirms only when
   * Paystack's charged amount matches the zakah plus fee cover exactly.
   */
  async reconcile(id: string) {
    const payment = await prisma.zakahPayment.findUnique({ where: { id } });
    if (!payment) return null;
    const last = this.lastVerifiedAt.get(id) ?? 0;
    if (payment.status === "pending" && this.paystack.verifyPayment && Date.now() - last >= VERIFY_MIN_INTERVAL_MS) {
      this.lastVerifiedAt.set(id, Date.now());
      const verified = await this.paystack.verifyPayment(payment.providerReference);
      if (verified && verified.status !== "pending") {
        const expectedMinor = Number(payment.amount.plus(payment.feeCover).times(100).toFixed(0));
        const matches = verified.amountMinorUnits === expectedMinor && verified.currency === payment.currency;
        if (verified.status === "confirmed" && !matches) {
          this.logger.error(
            `ZakahPayment "${id}" verify mismatch: Paystack reports ${verified.amountMinorUnits} ${verified.currency}, ` +
              `record is ${expectedMinor} ${payment.currency} — left pending for review.`,
          );
        } else {
          await this.applyProviderOutcome(payment.providerReference, verified.status, verified.providerPaymentId);
        }
      }
    }
    return this.findPublicStatus(id);
  }

  /**
   * The one place a pending payment becomes confirmed or failed, shared by
   * the webhook and reconcile. Each flip is a conditional claim on
   * "pending", so a retried webhook can never post the money twice.
   */
  private async applyProviderOutcome(providerReference: string, status: "confirmed" | "failed", providerPaymentId?: string) {
    const payment = await prisma.zakahPayment.findUnique({ where: { providerReference }, include: { payer: true } });
    if (!payment) return null;
    if (payment.status !== "pending") return this.publicView(payment);

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await tx.zakahPayment.updateMany({
        where: { id: payment.id, status: "pending" },
        data:
          status === "confirmed"
            ? { status: "confirmed", confirmedAt: new Date(), providerPaymentId: providerPaymentId ?? payment.providerPaymentId }
            : { status: "failed" },
      });
      if (claim.count !== 1) return null;
      const after = await tx.zakahPayment.findUniqueOrThrow({ where: { id: payment.id } });
      const { payer: _payer, ...before } = payment;
      await this.audit(tx, `zakah_payment.${status}`, payment.id, before, after);

      if (status === "confirmed") {
        // Only the zakah itself: the fee cover settled to Birr's main
        // account, not the zakah one, so it isn't zakah money.
        const bank = await this.ledger.getAccountByCode(tx, ZAKAH_BANK_ACCOUNT_CODE);
        const held = await this.ledger.getAccountByCode(tx, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE);
        await this.ledger.post(tx, {
          description: "Zakah payment received (Paystack)",
          currency: after.currency,
          source: "payment",
          sourceId: after.id,
          actorType: "system",
          lines: [
            { ledgerAccountId: bank.id, debit: after.amount },
            { ledgerAccountId: held.id, credit: after.amount },
          ],
        });
      }
      return after;
    });

    if (!outcome) return this.findPublicStatus(payment.id);

    // No payer means an anonymous payment — nowhere to send a receipt.
    if (status === "confirmed" && payment.payer) {
      this.receiptEmail
        .sendReceipt({
          to: payment.payer.email,
          amount: outcome.amount.toFixed(2),
          feeCover: outcome.feeCover.toFixed(2),
          paymentId: outcome.id,
        })
        .catch((err) => this.logger.error(`Failed to send the receipt for zakah payment "${outcome.id}":`, err instanceof Error ? err.stack : String(err)));
    }
    return this.publicView(outcome);
  }

  private audit(tx: Prisma.TransactionClient, action: string, entityId: string, before: unknown, after: unknown) {
    return tx.auditLog.create({
      data: {
        actorType: "public_donor",
        action,
        entityType: "ZakahPayment",
        entityId,
        before: (before ?? undefined) as any,
        after: after as any,
      },
    });
  }

  // The id travels in the payer's return URL, so only an allow-list of
  // fields — never the payer, IP or settlement details.
  private publicView(p: { id: string; amount: Prisma.Decimal; feeCover: Prisma.Decimal; currency: string; status: string; createdAt: Date; confirmedAt: Date | null }) {
    return {
      id: p.id,
      amount: p.amount.toFixed(2),
      feeCover: p.feeCover.toFixed(2),
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      confirmedAt: p.confirmedAt,
    };
  }

  async findPublicStatus(id: string) {
    const payment = await prisma.zakahPayment.findUnique({ where: { id } });
    return payment ? this.publicView(payment) : null;
  }

  /** Ops Console list — the payer's name and email, never their ID. */
  async list() {
    const rows = await prisma.zakahPayment.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { payer: { select: { email: true, fullName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      amount: r.amount.toFixed(2),
      feeCover: r.feeCover.toFixed(2),
      currency: r.currency,
      status: r.status,
      rulesetKey: r.rulesetKey,
      rulesetVersion: r.rulesetVersion,
      createdAt: r.createdAt,
      confirmedAt: r.confirmedAt,
      payer: r.payer,
    }));
  }

  ledgerBalances() {
    return this.ledger.balances(CURRENCY);
  }
}
