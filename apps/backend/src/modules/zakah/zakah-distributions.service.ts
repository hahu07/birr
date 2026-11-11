import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { prisma, Prisma, ZakahCategory, ZakahDistribution } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { ZAKAH_BANK_ACCOUNT_CODE, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE, ZakahLedgerService } from "./zakah-ledger.service";
import { lagosToday } from "./zakah.service";
import { CLOSED_ZAKAH_CATEGORIES, ZAKAH_CATEGORY_LABELS } from "@birr/zakah";

const CURRENCY = "NGN";

export { CLOSED_ZAKAH_CATEGORIES, ZAKAH_CATEGORY_LABELS };

export class CreateZakahRecipientInput {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(ZakahCategory, { each: true })
  categories!: ZakahCategory[];

  @IsString()
  @MinLength(10, { message: "eligibilityReason must say, in a sentence, why this person qualifies." })
  @MaxLength(2000)
  eligibilityReason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // All three, or none: what finance needs to pay them by bank transfer.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: "accountNumber must be a 10-digit NUBAN." })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;
}

export class UpdateZakahRecipientInput extends CreateZakahRecipientInput {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateZakahDistributionInput {
  @IsOptional()
  @IsString()
  recipientId?: string;

  @IsOptional()
  @IsString()
  counterpartyId?: string;

  @IsEnum(ZakahCategory)
  category!: ZakahCategory;

  @IsNumberString()
  @IsPositiveDecimal()
  amount!: string;

  @IsString()
  @MinLength(10, { message: "reason must say, in a sentence, why this payment fits this category." })
  @MaxLength(2000)
  reason!: string;
}

export class RecordPartnerReportInput {
  @IsInt()
  @Min(1)
  reachedCount!: number;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  report!: string;
}

/** zakah.distribution_approve's payload. */
export interface DistributionApprovalPayload {
  distributionId: string;
}

/** zakah.distribution_mark_paid's payload. */
export interface DistributionPaidPayload {
  distributionId: string;
  bankReference: string;
  paidOn: string;
}

interface BankDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

function naira(amount: Prisma.Decimal | string): string {
  return `₦${Number(new Prisma.Decimal(amount).toFixed(2)).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Paying zakah out to the eight categories. Two governed steps, each
 * needing a second person (see ZakahDistribution's schema comment); the
 * GovernedActionsService handlers call into the methods below. Zakah
 * already committed — awaiting approval, approved, or paid — can never
 * exceed the zakah actually received, checked under a lock wherever it
 * could change.
 */
@Injectable()
export class ZakahDistributionsService {
  constructor(
    private readonly encryption: EncryptionService,
    private readonly ledger: ZakahLedgerService,
  ) {}

  // ---- Recipients ----

  private packBankDetails(input: CreateZakahRecipientInput): string | null {
    const parts = [input.bankName, input.accountNumber, input.accountName].map((p) => p?.trim() || undefined);
    if (parts.every((p) => p === undefined)) return null;
    if (parts.some((p) => p === undefined)) {
      throw new BadRequestException("Give the bank name, account number and account name together, or none of them.");
    }
    const [bankName, accountNumber, accountName] = parts as string[];
    return this.encryption.encrypt(JSON.stringify({ bankName, accountNumber, accountName } satisfies BankDetails));
  }

  private assertCategoriesOpen(categories: ZakahCategory[]) {
    const closed = categories.filter((c) => (CLOSED_ZAKAH_CATEGORIES as readonly string[]).includes(c));
    if (closed.length) {
      throw new BadRequestException(
        `Birr doesn't pay zakah to ${closed.map((c) => ZAKAH_CATEGORY_LABELS[c]).join(", ")}: all zakah goes to recipients.`,
      );
    }
  }

  // Lists show only the last four digits; the full details are a separate,
  // audited read (bankDetails below).
  private recipientView<T extends { bankDetailsEncrypted: string | null }>(row: T) {
    const { bankDetailsEncrypted, ...rest } = row;
    const details = bankDetailsEncrypted ? (JSON.parse(this.encryption.decrypt(bankDetailsEncrypted)) as BankDetails) : null;
    return { ...rest, bank: details ? { bankName: details.bankName, accountLast4: details.accountNumber.slice(-4) } : null };
  }

  // Never write (encrypted) bank details into the audit trail — only that they exist.
  private recipientSnapshot<T extends { bankDetailsEncrypted: string | null }>(row: T) {
    const { bankDetailsEncrypted, ...rest } = row;
    return { ...rest, bankDetailsOnFile: bankDetailsEncrypted != null };
  }

  async listRecipients() {
    const rows = await prisma.zakahRecipient.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((r) => this.recipientView(r));
  }

  async createRecipient(input: CreateZakahRecipientInput, actorUserId: string) {
    this.assertCategoriesOpen(input.categories);
    const bankDetailsEncrypted = this.packBankDetails(input);
    return prisma.$transaction(async (tx) => {
      const created = await tx.zakahRecipient.create({
        data: {
          name: input.name.trim(),
          categories: input.categories,
          eligibilityReason: input.eligibilityReason.trim(),
          phone: input.phone?.trim() || null,
          bankDetailsEncrypted,
          createdByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "zakah_recipient.created",
          entityType: "ZakahRecipient",
          entityId: created.id,
          after: this.recipientSnapshot(created) as any,
        },
      });
      return this.recipientView(created);
    });
  }

  async updateRecipient(id: string, input: UpdateZakahRecipientInput, actorUserId: string) {
    this.assertCategoriesOpen(input.categories);
    const bankDetailsEncrypted = this.packBankDetails(input);
    return prisma.$transaction(async (tx) => {
      const before = await tx.zakahRecipient.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`Zakah recipient "${id}" not found.`);
      const updated = await tx.zakahRecipient.update({
        where: { id },
        data: {
          name: input.name.trim(),
          categories: input.categories,
          eligibilityReason: input.eligibilityReason.trim(),
          phone: input.phone?.trim() || null,
          // Blank keeps what's on file; it's only ever replaced, never shown back.
          ...(bankDetailsEncrypted && { bankDetailsEncrypted }),
          ...(input.active !== undefined && { active: input.active }),
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "zakah_recipient.updated",
          entityType: "ZakahRecipient",
          entityId: id,
          before: this.recipientSnapshot(before) as any,
          after: this.recipientSnapshot(updated) as any,
        },
      });
      return this.recipientView(updated);
    });
  }

  /** Full bank details, for the person making the transfer. Every read is audited. */
  async bankDetails(id: string, actorUserId: string): Promise<BankDetails> {
    const recipient = await prisma.zakahRecipient.findUnique({ where: { id } });
    if (!recipient) throw new NotFoundException(`Zakah recipient "${id}" not found.`);
    if (!recipient.bankDetailsEncrypted) throw new NotFoundException(`${recipient.name} has no bank details on file.`);
    await prisma.auditLog.create({
      data: {
        actorType: "birr_staff",
        actorUserId,
        action: "zakah_recipient.bank_details_viewed",
        entityType: "ZakahRecipient",
        entityId: id,
      },
    });
    return JSON.parse(this.encryption.decrypt(recipient.bankDetailsEncrypted)) as BankDetails;
  }

  // ---- The spending limit ----

  /** Serialises everything that can change how much zakah is committed. */
  private lockCommitments(tx: Prisma.TransactionClient) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('zakah_distribution_commitments'))`;
  }

  private async totals(db: Db) {
    const [received, committed, paid] = await Promise.all([
      db.zakahPayment.aggregate({ where: { status: "confirmed", currency: CURRENCY }, _sum: { amount: true } }),
      db.zakahDistribution.aggregate({
        where: { status: { in: ["pending_approval", "approved", "paid"] }, currency: CURRENCY },
        _sum: { amount: true },
      }),
      db.zakahDistribution.aggregate({ where: { status: "paid", currency: CURRENCY }, _sum: { amount: true } }),
    ]);
    const zero = new Prisma.Decimal(0);
    return {
      received: received._sum.amount ?? zero,
      committed: committed._sum.amount ?? zero,
      paid: paid._sum.amount ?? zero,
    };
  }

  // ---- Distributions ----

  async create(input: CreateZakahDistributionInput, actorUserId: string) {
    if (!input.recipientId === !input.counterpartyId) {
      throw new BadRequestException("Choose either one recipient or one partner organisation.");
    }
    this.assertCategoriesOpen([input.category]);
    const amount = new Prisma.Decimal(input.amount);
    if (amount.decimalPlaces() > 2) throw new BadRequestException("Enter the amount in naira and kobo.");

    if (input.recipientId) {
      const recipient = await prisma.zakahRecipient.findUnique({ where: { id: input.recipientId } });
      if (!recipient) throw new NotFoundException(`Zakah recipient "${input.recipientId}" not found.`);
      if (!recipient.active) throw new BadRequestException(`${recipient.name} is no longer an active recipient.`);
      if (!recipient.categories.includes(input.category)) {
        throw new BadRequestException(
          `${recipient.name} isn't registered as eligible under ${ZAKAH_CATEGORY_LABELS[input.category]}. Update their eligibility first.`,
        );
      }
    } else {
      const partner = await prisma.counterparty.findUnique({ where: { id: input.counterpartyId } });
      if (!partner || partner.deletedAt) throw new NotFoundException(`Partner "${input.counterpartyId}" not found.`);
      if (partner.status !== "active") {
        throw new BadRequestException(`${partner.name} isn't an active, vetted partner (status: ${partner.status}).`);
      }
    }

    return prisma.$transaction(async (tx) => {
      await this.lockCommitments(tx);
      const { received, committed } = await this.totals(tx);
      const available = received.minus(committed);
      if (amount.gt(available)) {
        throw new BadRequestException(`Only ${naira(available)} of zakah is available to distribute.`);
      }
      const created = await tx.zakahDistribution.create({
        data: {
          recipientId: input.recipientId,
          counterpartyId: input.counterpartyId,
          category: input.category,
          amount,
          currency: CURRENCY,
          reason: input.reason.trim(),
          createdByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "zakah_distribution.created",
          entityType: "ZakahDistribution",
          entityId: created.id,
          after: created as any,
        },
      });
      return created;
    });
  }

  list() {
    return prisma.zakahDistribution.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { recipient: { select: { id: true, name: true } }, counterparty: { select: { id: true, name: true } } },
    });
  }

  /**
   * The Ops Console's headline figures. `oldestUndistributedSince` is when
   * the oldest zakah not yet paid out was received, matching payments to
   * payouts first-in, first-out — zakah shouldn't wait long.
   */
  async summary() {
    const { received, committed, paid } = await this.totals(prisma);
    const byCategory = await prisma.zakahDistribution.groupBy({
      by: ["category", "status"],
      where: { status: { in: ["pending_approval", "approved", "paid"] }, currency: CURRENCY },
      _sum: { amount: true },
    });
    const payments = await prisma.zakahPayment.findMany({
      where: { status: "confirmed", currency: CURRENCY },
      orderBy: { confirmedAt: "asc" },
      select: { amount: true, confirmedAt: true },
    });
    let cumulative = new Prisma.Decimal(0);
    let oldestUndistributedSince: Date | null = null;
    for (const p of payments) {
      cumulative = cumulative.plus(p.amount);
      if (cumulative.gt(paid)) {
        oldestUndistributedSince = p.confirmedAt;
        break;
      }
    }
    return {
      currency: CURRENCY,
      received: received.toFixed(2),
      committed: committed.toFixed(2),
      paid: paid.toFixed(2),
      available: received.minus(committed).toFixed(2),
      oldestUndistributedSince,
      byCategory: byCategory.map((c) => ({ category: c.category, status: c.status, amount: (c._sum.amount ?? 0).toString() })),
    };
  }

  async recordPartnerReport(id: string, input: RecordPartnerReportInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.zakahDistribution.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`Zakah distribution "${id}" not found.`);
      if (!before.counterpartyId) throw new BadRequestException("Only a partner distribution has a report to record.");
      if (before.status !== "paid") throw new BadRequestException("Record the partner's report once the money has been paid.");
      if (before.partnerReportedAt) throw new ConflictException("This partner's report has already been recorded.");
      const updated = await tx.zakahDistribution.update({
        where: { id },
        data: { partnerReachedCount: input.reachedCount, partnerReport: input.report.trim(), partnerReportedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "zakah_distribution.partner_report_recorded",
          entityType: "ZakahDistribution",
          entityId: id,
          before: before as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  // ---- zakah.distribution_approve ----

  private async findOrThrow(id: unknown, db: Db = prisma) {
    if (typeof id !== "string") throw new BadRequestException("payload.distributionId is required.");
    const d = await db.zakahDistribution.findUnique({
      where: { id },
      include: { recipient: true, counterparty: true },
    });
    if (!d) throw new NotFoundException(`Zakah distribution "${id}" not found.`);
    return d;
  }

  private async pendingAction(permissionKey: string, distributionId: string) {
    return prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: permissionKey }, payload: { path: ["distributionId"], equals: distributionId } },
    });
  }

  async validateApprovalProposal(payload: unknown) {
    const d = await this.findOrThrow((payload as Partial<DistributionApprovalPayload>)?.distributionId);
    if (d.status !== "pending_approval") throw new BadRequestException(`This distribution is already ${d.status.replace("_", " ")}.`);
  }

  async checkDuplicateApproval(payload: unknown) {
    if (await this.pendingAction("zakah.distribution_approve", (payload as DistributionApprovalPayload).distributionId)) {
      throw new ConflictException("This distribution is already waiting for approval — check the Approvals queue.");
    }
  }

  async describe(payload: unknown): Promise<string> {
    const d = await this.findOrThrow((payload as DistributionApprovalPayload).distributionId);
    const payee = d.recipient ? d.recipient.name : `${d.counterparty!.name} (partner, to pass on)`;
    return `${naira(d.amount)} of zakah to ${payee}, under ${ZAKAH_CATEGORY_LABELS[d.category]}. Why: ${d.reason}`;
  }

  /** What the approver weighs: who it's for, why they qualify, and how much zakah is left. */
  async currentState(payload: unknown): Promise<Record<string, unknown>> {
    const d = await this.findOrThrow((payload as DistributionApprovalPayload).distributionId);
    const { received, committed } = await this.totals(prisma);
    return {
      status: d.status,
      category: ZAKAH_CATEGORY_LABELS[d.category],
      recipientEligibility: d.recipient ? { categories: d.recipient.categories, reason: d.recipient.eligibilityReason } : null,
      partnerStatus: d.counterparty?.status ?? null,
      zakahReceived: received.toFixed(2),
      zakahCommitted: committed.toFixed(2),
    };
  }

  async approve(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    await this.lockCommitments(tx);
    const before = await this.findOrThrow((payload as DistributionApprovalPayload).distributionId, tx);
    if (before.status !== "pending_approval") throw new BadRequestException(`This distribution is already ${before.status}.`);
    if (before.recipient && !before.recipient.active) throw new BadRequestException(`${before.recipient.name} is no longer active.`);
    if (before.counterparty && before.counterparty.status !== "active") {
      throw new BadRequestException(`${before.counterparty.name} is no longer an active partner.`);
    }
    // This row is already counted as committed; re-check nothing has
    // pushed commitments past what was received since it was proposed.
    const { received, committed } = await this.totals(tx);
    if (committed.gt(received)) {
      throw new BadRequestException(`Approving this would commit more zakah than has been received (${naira(received)}).`);
    }
    const after = await tx.zakahDistribution.update({
      where: { id: before.id },
      data: { status: "approved", approvedAt: new Date(), approvalActionId: governedActionId },
    });
    const { recipient: _r, counterparty: _c, ...beforeRow } = before;
    return { before: beforeRow as ZakahDistribution, after };
  }

  /** Rejection releases the amount back to what can be distributed. */
  async reject(payload: unknown, tx: Prisma.TransactionClient) {
    const before = await this.findOrThrow((payload as DistributionApprovalPayload).distributionId, tx);
    if (before.status !== "pending_approval") return null;
    const after = await tx.zakahDistribution.update({ where: { id: before.id }, data: { status: "rejected" } });
    const { recipient: _r, counterparty: _c, ...beforeRow } = before;
    return { before: beforeRow as ZakahDistribution, after };
  }

  // ---- zakah.distribution_mark_paid ----

  validatePaidProposal(payload: unknown, today = lagosToday()): DistributionPaidPayload {
    const p = (payload ?? {}) as Partial<Record<keyof DistributionPaidPayload, unknown>>;
    const bankReference = typeof p.bankReference === "string" ? p.bankReference.trim() : "";
    if (bankReference.length < 3 || bankReference.length > 100) {
      throw new BadRequestException("payload.bankReference must be the bank's reference for the transfer.");
    }
    if (typeof p.paidOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn) || Number.isNaN(Date.parse(`${p.paidOn}T00:00:00Z`))) {
      throw new BadRequestException('payload.paidOn must be a date like "2027-02-12".');
    }
    if (p.paidOn > today) throw new BadRequestException(`payload.paidOn (${p.paidOn}) is in the future.`);
    if (typeof p.distributionId !== "string") throw new BadRequestException("payload.distributionId is required.");
    return { distributionId: p.distributionId, bankReference, paidOn: p.paidOn };
  }

  async validatePaidProposalAsync(payload: unknown) {
    const p = this.validatePaidProposal(payload);
    const d = await this.findOrThrow(p.distributionId);
    if (d.status !== "approved") throw new BadRequestException(`Only an approved distribution can be marked paid (this one is ${d.status}).`);
    if (d.approvedAt && p.paidOn < d.approvedAt.toISOString().slice(0, 10)) {
      throw new BadRequestException("The payment date is before the distribution was approved.");
    }
  }

  async checkDuplicatePaid(payload: unknown) {
    if (await this.pendingAction("zakah.distribution_mark_paid", (payload as DistributionPaidPayload).distributionId)) {
      throw new ConflictException("A payment for this distribution is already waiting for confirmation.");
    }
  }

  async describePaid(payload: unknown): Promise<string> {
    const { distributionId, bankReference, paidOn } = payload as DistributionPaidPayload;
    const d = await this.findOrThrow(distributionId);
    const payee = d.recipient?.name ?? d.counterparty!.name;
    return `Paid ${naira(d.amount)} of zakah to ${payee} from the zakah bank account on ${paidOn}, bank reference ${bankReference}. Check it against the bank statement before confirming.`;
  }

  /** Marks it paid and books it: the zakah leaves the account and is no longer held for recipients. */
  async markPaid(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const p = this.validatePaidProposal(payload);
    const before = await this.findOrThrow(p.distributionId, tx);
    if (before.status !== "approved") throw new BadRequestException(`Only an approved distribution can be marked paid (this one is ${before.status}).`);
    const after = await tx.zakahDistribution.update({
      where: { id: before.id },
      data: { status: "paid", paidOn: new Date(`${p.paidOn}T00:00:00Z`), bankReference: p.bankReference, paymentActionId: governedActionId },
    });
    const held = await this.ledger.getAccountByCode(tx, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE);
    const bank = await this.ledger.getAccountByCode(tx, ZAKAH_BANK_ACCOUNT_CODE);
    await this.ledger.post(tx, {
      description: `Zakah paid — ${ZAKAH_CATEGORY_LABELS[after.category]} (bank ref ${p.bankReference})`,
      currency: after.currency,
      source: "distribution",
      sourceId: after.id,
      actorType: "system",
      lines: [
        { ledgerAccountId: held.id, debit: after.amount },
        { ledgerAccountId: bank.id, credit: after.amount },
      ],
    });
    const { recipient: _r, counterparty: _c, ...beforeRow } = before;
    return { before: beforeRow as ZakahDistribution, after };
  }
}
