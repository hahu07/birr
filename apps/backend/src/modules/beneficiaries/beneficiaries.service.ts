import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsDateString, IsEmail, IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { prisma, Prisma, BeneficiaryStatus, BeneficiaryKind, PayoutProvider } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { EncryptionService } from "../../common/settings/encryption.service";
import type { PayoutBankDetails } from "../distributions/providers/payout-provider.interface";

// bankCode stays optional here — a beneficiary's partial bank details
// (or a beneficiary not yet meant for Paystack payout at all) can still
// be saved. It only becomes a hard requirement at distribution-approval
// time, via DistributionsService.assertPayoutReady ->
// getDecryptedBankDetailsForPayout below — same "required going
// forward, enforced downstream, not at this DTO" posture as this file's
// own causeId convention.
export class BankDetailsInput {
  @IsString()
  bankName!: string;

  @IsString()
  accountNumber!: string;

  @IsString()
  accountName!: string;

  @IsOptional()
  @IsString()
  bankCode?: string;
}

export class CreateBeneficiaryInput {
  @IsString()
  waqfId!: string;

  // Required going forward — the DB column itself stays nullable (no
  // backfill for pre-existing rows, same convention as
  // Investment.counterpartyId), so this is an input-layer requirement,
  // not a schema one.
  @IsString()
  causeId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(BeneficiaryKind)
  kind?: BeneficiaryKind;

  @IsString()
  eligibilityCriteria!: string;

  // Deliberately not @IsPhoneNumber()/@IsEmail() strict-shape validation
  // on phone — an organization's contact info doesn't always fit a
  // personal-phone shape, and staff verify this by hand regardless.
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsInput)
  bankDetails?: BankDetailsInput;

  // Which outbound-payout rail pays this beneficiary — see
  // PayoutProvider's own schema comment on why only "paystack" actually
  // pays out today. Optional at creation for the same reason bankCode
  // is: enforced as a hard requirement only at distribution-approval
  // time (DistributionsService.assertPayoutReady).
  @IsOptional()
  @IsEnum(PayoutProvider)
  payoutProvider?: PayoutProvider;

  @IsOptional()
  @IsDateString()
  eligibilityExpiresAt?: string;
}

// Registering payout details after a beneficiary already exists — the
// only way to make an already-registered beneficiary payout-ready,
// since bankDetails/payoutProvider on CreateBeneficiaryInput are both
// optional (a beneficiary can be registered before their bank details
// are known). Both required here: this route exists specifically to
// set them, not to leave either half missing.
export class SetPayoutDetailsInput {
  @IsEnum(PayoutProvider)
  payoutProvider!: PayoutProvider;

  @ValidateNested()
  @Type(() => BankDetailsInput)
  bankDetails!: BankDetailsInput;
}

@Injectable()
export class BeneficiariesService {
  constructor(private readonly encryption: EncryptionService) {}

  private packBankDetails(details?: BankDetailsInput): string | undefined {
    return details ? this.encryption.encrypt(JSON.stringify(details)) : undefined;
  }

  private unpackBankDetails(encrypted: string | null): BankDetailsInput | null {
    return encrypted ? JSON.parse(this.encryption.decrypt(encrypted)) : null;
  }

  // Staff-facing display only — decrypts bankDetailsEncrypted into a
  // plain bankDetails object and drops the ciphertext field from the
  // response. Public (not applied automatically inside findById()/list()
  // below) and called explicitly by BeneficiariesController's two
  // HTTP-facing read routes — internal callers like
  // GovernedActionsService.resolveWaqfId only need a raw row's waqfId
  // and shouldn't pay for (or risk failing on) a decrypt they never
  // asked for. Never applied on summaryForFounder's path (already
  // PII-free).
  withDecryptedBankDetails<T extends { bankDetailsEncrypted: string | null }>(row: T) {
    const { bankDetailsEncrypted, ...rest } = row;
    return { ...rest, bankDetails: this.unpackBankDetails(bankDetailsEncrypted) };
  }

  /**
   * causeId is required (see CreateBeneficiaryInput's own comment). When
   * given, it must belong to the same waqf as the beneficiary itself —
   * Postgres can't express that as a composite FK here, so it's checked
   * in application code instead (mirrors DistributionsService.create()'s
   * identical check).
   *
   * Not maker-checker gated (only beneficiary.criteria_update and
   * beneficiary.status_change are), but still a create on a governed
   * entity per CLAUDE.md's audit-trail non-negotiable — wrapped in a
   * transaction so the create and its audit row are atomic.
   */
  async create(input: CreateBeneficiaryInput, actorUserId: string) {
    const cause = await prisma.waqfCause.findUnique({ where: { id: input.causeId } });
    if (!cause || cause.waqfId !== input.waqfId) {
      throw new BadRequestException(`Cause "${input.causeId}" does not belong to waqf "${input.waqfId}".`);
    }

    return prisma.$transaction(async (tx) => {
      const { bankDetails, eligibilityExpiresAt, ...rest } = input;
      const beneficiary = await tx.beneficiary.create({
        data: {
          ...rest,
          bankDetailsEncrypted: this.packBankDetails(bankDetails),
          eligibilityExpiresAt: eligibilityExpiresAt ? new Date(eligibilityExpiresAt) : undefined,
        },
      });
      // bankDetailsEncrypted deliberately excluded from the audit
      // snapshot — audit_logs has no access restriction beyond the
      // DB-role revoke CLAUDE.md already mandates, and a ciphertext
      // blob sitting there is needless exposure surface even encrypted.
      const { bankDetailsEncrypted, ...auditSafe } = beneficiary;
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "beneficiary.created",
          entityType: "Beneficiary",
          entityId: beneficiary.id,
          after: auditSafe as any,
        },
      });
      return beneficiary;
    });
  }

  /**
   * Plain staff CRUD, not maker-checker gated — same posture as create()
   * itself (bank details are already settable, ungoverned, at creation
   * time; updating them afterward is the same kind of action, not a new
   * fiduciary decision). Registering payout details doesn't move money
   * by itself — DistributionsService.assertPayoutReady is still what
   * gates whether a distribution to this beneficiary can actually be
   * approved. Exists because CreateBeneficiaryInput's bankDetails/
   * payoutProvider are both optional (a beneficiary can be registered
   * before their bank details are known) — without this, an
   * already-registered beneficiary would have no way to ever become
   * payout-ready.
   */
  async setPayoutDetails(id: string, input: SetPayoutDetailsInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.beneficiary.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`Beneficiary "${id}" not found.`);
      const updated = await tx.beneficiary.update({
        where: { id },
        data: {
          payoutProvider: input.payoutProvider,
          bankDetailsEncrypted: this.packBankDetails(input.bankDetails),
        },
      });
      // bankDetailsEncrypted excluded from both audit snapshots — same
      // reasoning as create()'s identical exclusion.
      const { bankDetailsEncrypted: _before, ...beforeSafe } = before;
      const { bankDetailsEncrypted: _after, ...afterSafe } = updated;
      await tx.auditLog.create({
        data: {
          waqfId: updated.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "beneficiary.payout_details_set",
          entityType: "Beneficiary",
          entityId: updated.id,
          before: beforeSafe as any,
          after: afterSafe as any,
        },
      });
      return updated;
    });
  }

  /**
   * Internal only — never expose this behind a public controller route.
   * beneficiary.criteria_update is a governed action (see schema.prisma's
   * comment on Beneficiary); the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction.
   */
  async updateCriteria(id: string, newCriteria: string, tx: Prisma.TransactionClient) {
    const beneficiary = await tx.beneficiary.findUnique({ where: { id } });
    if (!beneficiary) throw new NotFoundException(`Beneficiary "${id}" not found.`);
    return tx.beneficiary.update({
      where: { id },
      data: { eligibilityCriteria: newCriteria },
    });
  }

  /**
   * Internal only — never expose behind a public controller route.
   * beneficiary.status_change is a governed action; the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. This is what makes the status field mean something —
   * see DistributionsService.assertBeneficiaryEligible, the other half
   * of that: without it, disabling someone here had no real effect on
   * whether a distribution could still be created against them.
   */
  async updateStatus(id: string, newStatus: BeneficiaryStatus, tx: Prisma.TransactionClient) {
    const beneficiary = await tx.beneficiary.findUnique({ where: { id } });
    if (!beneficiary) throw new NotFoundException(`Beneficiary "${id}" not found.`);
    return tx.beneficiary.update({ where: { id }, data: { status: newStatus } });
  }

  /**
   * Internal only — never expose behind a public controller route. The
   * only caller is DistributionsService (assertPayoutReady, which just
   * needs this not to throw, and initiateDisbursement, which needs the
   * actual decrypted values). Serves as both the payout-readiness check
   * and the decrypted-details fetch — one place owns the shape
   * requirement instead of two call sites separately deciding what
   * "complete" means. Throws BadRequestException (not a bare null) if
   * bank details or a bank code are missing, since every caller treats
   * incompleteness as fatal.
   */
  async getDecryptedBankDetailsForPayout(
    beneficiaryId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<PayoutBankDetails> {
    const beneficiary = await client.beneficiary.findUnique({ where: { id: beneficiaryId } });
    if (!beneficiary) throw new NotFoundException(`Beneficiary "${beneficiaryId}" not found.`);
    if (!beneficiary.bankDetailsEncrypted) {
      throw new BadRequestException(`Beneficiary "${beneficiary.name}" has no bank details on file.`);
    }
    const details = this.unpackBankDetails(beneficiary.bankDetailsEncrypted)!;
    if (!details.bankCode) {
      throw new BadRequestException(`Beneficiary "${beneficiary.name}"'s bank details are missing a bank code.`);
    }
    return details as PayoutBankDetails;
  }

  // Raw — bankDetailsEncrypted stays as ciphertext. Internal callers
  // (e.g. GovernedActionsService.resolveWaqfId, which only needs
  // .waqfId) use this directly; BeneficiariesController's HTTP-facing
  // routes call withDecryptedBankDetails() explicitly on top of this
  // for actual staff display — see that method's own comment.
  findById(id: string) {
    return prisma.beneficiary.findUnique({ where: { id } });
  }

  list(waqfId?: string) {
    return prisma.beneficiary.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  // Founder-Portal read-only visibility into their own waqf's
  // beneficiaries — deliberately an aggregate, never the individual
  // rows: Beneficiary.name/eligibilityCriteria/phone/email/bank details
  // are real personal information about who receives a payout, and
  // standard endowment practice keeps that confidential from the donor,
  // not just from the general public. Counts by status and by cause
  // give a Founder real visibility ("340 active beneficiaries, 200
  // under Scholarships") without exposing anyone's identity. Same
  // null-means-not-found-or-not-theirs convention as
  // AssetsService.listForFounder.
  async summaryForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;

      const beneficiaries = await tx.beneficiary.findMany({
        where: { waqfId, deletedAt: null },
        select: { status: true, causeId: true },
      });

      const byStatus: Record<BeneficiaryStatus, number> = { active: 0, inactive: 0 };
      const countByCauseId = new Map<string, number>();
      for (const b of beneficiaries) {
        byStatus[b.status] += 1;
        if (b.causeId) countByCauseId.set(b.causeId, (countByCauseId.get(b.causeId) ?? 0) + 1);
      }

      const causes =
        countByCauseId.size > 0
          ? await tx.waqfCause.findMany({ where: { id: { in: [...countByCauseId.keys()] } } })
          : [];
      const causeById = new Map(causes.map((c) => [c.id, c]));

      return {
        total: beneficiaries.length,
        byStatus,
        byCause: [...countByCauseId.entries()].map(([causeId, count]) => ({
          causeId,
          causeName: causeById.get(causeId)?.name ?? "Unknown cause",
          count,
        })),
      };
    });
  }
}
