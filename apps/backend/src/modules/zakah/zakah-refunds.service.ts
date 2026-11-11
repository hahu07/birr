import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { prisma, Prisma, ZakahRefund, ZakahRefundReason } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { lockZakahCommitments, zakahTotals } from "./zakah-commitments";
import { ZAKAH_BANK_ACCOUNT_CODE, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE, ZakahLedgerService } from "./zakah-ledger.service";
import { lagosToday } from "./zakah.service";

export const ZAKAH_REFUND_REASON_LABELS: Record<ZakahRefundReason, string> = {
  duplicate_payment: "paid twice by mistake",
  wrong_amount: "paid the wrong amount",
  unauthorised_payment: "a payment the payer didn't authorise",
};

export class CreateZakahRefundInput {
  @IsString()
  paymentId!: string;

  @IsNumberString()
  @IsPositiveDecimal()
  amount!: string;

  @IsEnum(ZakahRefundReason)
  reason!: ZakahRefundReason;

  @IsString()
  @MinLength(10, { message: "details must say what happened, in a sentence." })
  @MaxLength(2000)
  details!: string;

  // Where finance sends the money back — collected from the payer.
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  bankName!: string;

  @Matches(/^\d{10}$/, { message: "accountNumber must be a 10-digit NUBAN." })
  accountNumber!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  accountName!: string;
}

/** zakah.refund_approve's payload. */
export interface RefundApprovalPayload {
  refundId: string;
}

/** zakah.refund_mark_paid's payload. */
export interface RefundPaidPayload {
  refundId: string;
  bankReference: string;
  paidOn: string;
}

interface BankDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

type Db = Prisma.TransactionClient | typeof prisma;

function naira(amount: Prisma.Decimal | string): string {
  return `₦${Number(new Prisma.Decimal(amount).toFixed(2)).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

/**
 * Refunding zakah paid by mistake (see ZakahRefund's schema comment for
 * the owner's decisions). Same two governed steps as a distribution —
 * approve, then confirm it was paid from the zakah account — and the
 * same spending limit, so a refund can never touch zakah already
 * committed to recipients. A payment's refunds never add up to more than
 * its zakah; the fee cover a payer added is never refunded.
 */
@Injectable()
export class ZakahRefundsService {
  constructor(
    private readonly encryption: EncryptionService,
    private readonly ledger: ZakahLedgerService,
  ) {}

  private view<T extends { payeeBankDetailsEncrypted: string }>(row: T) {
    const { payeeBankDetailsEncrypted, ...rest } = row;
    const details = JSON.parse(this.encryption.decrypt(payeeBankDetailsEncrypted)) as BankDetails;
    return { ...rest, payeeBank: { bankName: details.bankName, accountLast4: details.accountNumber.slice(-4) } };
  }

  // Never write (encrypted) bank details into the audit trail.
  private snapshot<T extends { payeeBankDetailsEncrypted: string }>(row: T) {
    const { payeeBankDetailsEncrypted: _omitted, ...rest } = row;
    return rest;
  }

  async list() {
    const rows = await prisma.zakahRefund.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { payment: { select: { id: true, amount: true, createdAt: true, payer: { select: { email: true, fullName: true } } } } },
    });
    return rows.map((r) => this.view(r));
  }

  async create(input: CreateZakahRefundInput, actorUserId: string) {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.decimalPlaces() > 2) throw new BadRequestException("Enter the amount in naira and kobo.");
    const payeeBankDetailsEncrypted = this.encryption.encrypt(
      JSON.stringify({
        bankName: input.bankName.trim(),
        accountNumber: input.accountNumber,
        accountName: input.accountName.trim(),
      } satisfies BankDetails),
    );

    return prisma.$transaction(async (tx) => {
      await lockZakahCommitments(tx);
      const payment = await tx.zakahPayment.findUnique({ where: { id: input.paymentId } });
      if (!payment) throw new NotFoundException(`Zakah payment "${input.paymentId}" not found.`);
      if (payment.status !== "confirmed") throw new BadRequestException("Only a confirmed payment can be refunded.");
      await this.assertWithinLimits(tx, payment, amount);

      const created = await tx.zakahRefund.create({
        data: {
          paymentId: payment.id,
          amount,
          currency: payment.currency,
          reason: input.reason,
          details: input.details.trim(),
          payeeBankDetailsEncrypted,
          createdByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "zakah_refund.created",
          entityType: "ZakahRefund",
          entityId: created.id,
          after: this.snapshot(created) as any,
        },
      });
      return this.view(created);
    });
  }

  /**
   * Two limits, both checked under the commitments lock: this payment's
   * refunds (other than rejected ones) can't exceed its zakah, and nothing
   * already committed to recipients can be refunded. `alreadyCounted` is
   * true when this refund's own row is among those being summed.
   */
  private async assertWithinLimits(
    tx: Prisma.TransactionClient,
    payment: { id: string; amount: Prisma.Decimal; currency: string },
    amount: Prisma.Decimal,
    alreadyCounted = false,
  ) {
    const refunds = await tx.zakahRefund.aggregate({
      where: { paymentId: payment.id, status: { in: ["pending_approval", "approved", "paid"] } },
      _sum: { amount: true },
    });
    const otherRefunds = (refunds._sum.amount ?? new Prisma.Decimal(0)).minus(alreadyCounted ? amount : 0);
    const refundable = payment.amount.minus(otherRefunds);
    if (amount.gt(refundable)) {
      throw new BadRequestException(`At most ${naira(refundable)} of this payment's zakah can still be refunded.`);
    }
    const { received, committed } = await zakahTotals(tx, payment.currency);
    const available = received.minus(committed).plus(alreadyCounted ? amount : 0);
    if (amount.gt(available)) {
      throw new BadRequestException(
        `Only ${naira(available)} of zakah isn't already committed to recipients, so this can't be refunded in full.`,
      );
    }
  }

  /** The payer's full bank details, for whoever makes the transfer. Every read is audited. */
  async bankDetails(id: string, actorUserId: string): Promise<BankDetails> {
    const refund = await prisma.zakahRefund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException(`Zakah refund "${id}" not found.`);
    await prisma.auditLog.create({
      data: { actorType: "birr_staff", actorUserId, action: "zakah_refund.bank_details_viewed", entityType: "ZakahRefund", entityId: id },
    });
    return JSON.parse(this.encryption.decrypt(refund.payeeBankDetailsEncrypted)) as BankDetails;
  }

  // ---- zakah.refund_approve ----

  private async findOrThrow(id: unknown, db: Db = prisma) {
    if (typeof id !== "string") throw new BadRequestException("payload.refundId is required.");
    const refund = await db.zakahRefund.findUnique({ where: { id }, include: { payment: { include: { payer: true } } } });
    if (!refund) throw new NotFoundException(`Zakah refund "${id}" not found.`);
    return refund;
  }

  private pendingAction(permissionKey: string, refundId: string) {
    return prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: permissionKey }, payload: { path: ["refundId"], equals: refundId } },
    });
  }

  private strip(row: Awaited<ReturnType<ZakahRefundsService["findOrThrow"]>>): Omit<ZakahRefund, "payeeBankDetailsEncrypted"> {
    const { payment: _p, payeeBankDetailsEncrypted: _b, ...rest } = row;
    return rest;
  }

  async validateApprovalProposal(payload: unknown) {
    const refund = await this.findOrThrow((payload as Partial<RefundApprovalPayload>)?.refundId);
    if (refund.status !== "pending_approval") throw new BadRequestException(`This refund is already ${refund.status.replace("_", " ")}.`);
  }

  async checkDuplicateApproval(payload: unknown) {
    if (await this.pendingAction("zakah.refund_approve", (payload as RefundApprovalPayload).refundId)) {
      throw new ConflictException("This refund is already waiting for approval — check the Approvals queue.");
    }
  }

  async describe(payload: unknown): Promise<string> {
    const r = await this.findOrThrow((payload as RefundApprovalPayload).refundId);
    const payer = r.payment.payer?.fullName ?? r.payment.payer?.email ?? "an anonymous payer";
    return `Refund ${naira(r.amount)} of a ${naira(r.payment.amount)} zakah payment to ${payer} — ${ZAKAH_REFUND_REASON_LABELS[r.reason]}. What happened: ${r.details}`;
  }

  async currentState(payload: unknown): Promise<Record<string, unknown>> {
    const r = await this.findOrThrow((payload as RefundApprovalPayload).refundId);
    const { received, committed } = await zakahTotals(prisma, r.currency);
    return {
      status: r.status,
      paymentAmount: r.payment.amount.toFixed(2),
      paymentConfirmedAt: r.payment.confirmedAt,
      zakahReceived: received.toFixed(2),
      zakahCommitted: committed.toFixed(2),
    };
  }

  async approve(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    await lockZakahCommitments(tx);
    const before = await this.findOrThrow((payload as RefundApprovalPayload).refundId, tx);
    if (before.status !== "pending_approval") throw new BadRequestException(`This refund is already ${before.status}.`);
    await this.assertWithinLimits(tx, before.payment, before.amount, true);
    const after = await tx.zakahRefund.update({
      where: { id: before.id },
      data: { status: "approved", approvedAt: new Date(), approvalActionId: governedActionId },
    });
    return { before: this.strip(before), after: this.snapshot(after) };
  }

  /** Rejection releases the amount back to what can be distributed. */
  async reject(payload: unknown, tx: Prisma.TransactionClient) {
    const before = await this.findOrThrow((payload as RefundApprovalPayload).refundId, tx);
    if (before.status !== "pending_approval") return null;
    const after = await tx.zakahRefund.update({ where: { id: before.id }, data: { status: "rejected" } });
    return { before: this.strip(before), after: this.snapshot(after) };
  }

  // ---- zakah.refund_mark_paid ----

  validatePaidProposal(payload: unknown, today = lagosToday()): RefundPaidPayload {
    const p = (payload ?? {}) as Partial<Record<keyof RefundPaidPayload, unknown>>;
    const bankReference = typeof p.bankReference === "string" ? p.bankReference.trim() : "";
    if (bankReference.length < 3 || bankReference.length > 100) {
      throw new BadRequestException("payload.bankReference must be the bank's reference for the transfer.");
    }
    if (typeof p.paidOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn) || Number.isNaN(Date.parse(`${p.paidOn}T00:00:00Z`))) {
      throw new BadRequestException('payload.paidOn must be a date like "2027-02-12".');
    }
    if (p.paidOn > today) throw new BadRequestException(`payload.paidOn (${p.paidOn}) is in the future.`);
    if (typeof p.refundId !== "string") throw new BadRequestException("payload.refundId is required.");
    return { refundId: p.refundId, bankReference, paidOn: p.paidOn };
  }

  async validatePaidProposalAsync(payload: unknown) {
    const p = this.validatePaidProposal(payload);
    const r = await this.findOrThrow(p.refundId);
    if (r.status !== "approved") throw new BadRequestException(`Only an approved refund can be marked paid (this one is ${r.status}).`);
    if (r.approvedAt && p.paidOn < r.approvedAt.toISOString().slice(0, 10)) {
      throw new BadRequestException("The payment date is before the refund was approved.");
    }
  }

  async checkDuplicatePaid(payload: unknown) {
    if (await this.pendingAction("zakah.refund_mark_paid", (payload as RefundPaidPayload).refundId)) {
      throw new ConflictException("A payment for this refund is already waiting for confirmation.");
    }
  }

  async describePaid(payload: unknown): Promise<string> {
    const { refundId, bankReference, paidOn } = payload as RefundPaidPayload;
    const r = await this.findOrThrow(refundId);
    return `Refunded ${naira(r.amount)} of zakah from the zakah bank account on ${paidOn}, bank reference ${bankReference}. Check it against the bank statement before confirming.`;
  }

  /** Marks it paid and books it: the zakah leaves the account and is no longer held for recipients. */
  async markPaid(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const p = this.validatePaidProposal(payload);
    const before = await this.findOrThrow(p.refundId, tx);
    if (before.status !== "approved") throw new BadRequestException(`Only an approved refund can be marked paid (this one is ${before.status}).`);
    const after = await tx.zakahRefund.update({
      where: { id: before.id },
      data: { status: "paid", paidOn: new Date(`${p.paidOn}T00:00:00Z`), bankReference: p.bankReference, paymentActionId: governedActionId },
    });
    const held = await this.ledger.getAccountByCode(tx, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE);
    const bank = await this.ledger.getAccountByCode(tx, ZAKAH_BANK_ACCOUNT_CODE);
    await this.ledger.post(tx, {
      description: `Zakah refunded — ${ZAKAH_REFUND_REASON_LABELS[after.reason]} (bank ref ${p.bankReference})`,
      currency: after.currency,
      source: "refund",
      sourceId: after.id,
      actorType: "system",
      lines: [
        { ledgerAccountId: held.id, debit: after.amount },
        { ledgerAccountId: bank.id, credit: after.amount },
      ],
    });
    return { before: this.strip(before), after: this.snapshot(after) };
  }
}
