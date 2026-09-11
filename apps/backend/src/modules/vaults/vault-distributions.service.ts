import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IsNotEmpty, IsNumberString, IsString } from "class-validator";
import { prisma, Prisma, PayoutProvider } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { PayoutBankDetails, PayoutProviderAdapter } from "../distributions/providers/payout-provider.interface";
import { PaystackPayoutAdapter } from "../distributions/providers/paystack-payout.adapter";

export class CreateVaultDistributionInput {
  @IsString()
  vaultId!: string;

  @IsString()
  vaultCauseId!: string;

  @IsString()
  counterpartyId!: string;

  @IsNumberString()
  amount!: Prisma.Decimal | number | string;

  @IsString()
  @IsNotEmpty()
  currency!: string;
}

@Injectable()
export class VaultDistributionsService {
  private readonly logger = new Logger(VaultDistributionsService.name);
  // Only Paystack payouts exist today, same as DistributionsService's own
  // posture (assertPayoutReady below only ever accepts "paystack") —
  // this stays a Map, not a single field, so a second provider later
  // slots in the same way it would for the Founder-flow Distribution.
  private readonly payoutAdapters: Map<PayoutProvider, PayoutProviderAdapter>;

  constructor(
    private readonly encryption: EncryptionService,
    paystackPayoutAdapter: PaystackPayoutAdapter,
  ) {
    this.payoutAdapters = new Map<PayoutProvider, PayoutProviderAdapter>([["paystack", paystackPayoutAdapter]]);
  }

  /**
   * Not maker-checker gated (only vault.distribution_approve is), but
   * still a create on a governed entity per CLAUDE.md's audit-trail
   * non-negotiable — mirrors DistributionsService.create() exactly,
   * paying a Counterparty instead of validating a Beneficiary (see this
   * module's own top-of-section comment on why).
   */
  async create(input: CreateVaultDistributionInput, actorUserId: string) {
    const [cause, vault] = await Promise.all([
      prisma.vaultCause.findUnique({ where: { id: input.vaultCauseId } }),
      prisma.vault.findUnique({ where: { id: input.vaultId } }),
    ]);
    if (!cause || cause.vaultId !== input.vaultId) {
      throw new BadRequestException(`Cause "${input.vaultCauseId}" does not belong to vault "${input.vaultId}".`);
    }
    if (vault && vault.currency !== input.currency) {
      throw new BadRequestException(
        `This vault is denominated in ${vault.currency} — a distribution must use that same currency, not ${input.currency}.`,
      );
    }
    const counterparty = await prisma.counterparty.findUnique({ where: { id: input.counterpartyId } });
    if (!counterparty) throw new NotFoundException(`Counterparty "${input.counterpartyId}" not found.`);
    if (counterparty.status !== "active") {
      throw new BadRequestException(`"${counterparty.name}" is ${counterparty.status} — not approved to receive payouts.`);
    }

    return prisma.$transaction(async (tx) => {
      await this.assertWithinAllocation(input.vaultCauseId, new Prisma.Decimal(input.amount), input.currency, tx);
      const distribution = await tx.vaultDistribution.create({ data: input });
      await tx.auditLog.create({
        data: {
          vaultId: input.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_distribution.created",
          entityType: "VaultDistribution",
          entityId: distribution.id,
          after: distribution as any,
        },
      });
      return distribution;
    });
  }

  /**
   * Internal only — never exposed behind a public controller route.
   * vault.distribution_approve is a governed action; the only caller is
   * GovernedActionsService's handler map. Mirrors
   * DistributionsService.approve() exactly, substituting
   * assertPayoutReady's Counterparty-bank-details check for the
   * Beneficiary one.
   */
  async approve(id: string, tx: Prisma.TransactionClient) {
    const distribution = await tx.vaultDistribution.findUnique({ where: { id } });
    if (!distribution) throw new NotFoundException(`VaultDistribution "${id}" not found.`);
    if (distribution.status !== "pending") {
      throw new BadRequestException(`VaultDistribution "${id}" is ${distribution.status}, not pending — nothing to approve.`);
    }
    await this.assertPayoutReady(distribution.counterpartyId, tx);
    await this.assertWithinAllocation(distribution.vaultCauseId, distribution.amount, distribution.currency, tx, id);

    const claim = await tx.vaultDistribution.updateMany({
      where: { id, status: "pending" },
      data: { status: "approved", approvedAt: new Date() },
    });
    if (claim.count !== 1) {
      throw new BadRequestException(`VaultDistribution "${id}" is ${distribution.status}, not pending — nothing to approve.`);
    }
    return tx.vaultDistribution.findUniqueOrThrow({ where: { id } });
  }

  /** Rejection counterpart to approve() — mirrors DistributionsService.reject(). */
  async reject(id: string, tx: Prisma.TransactionClient) {
    const distribution = await tx.vaultDistribution.findUnique({ where: { id } });
    if (!distribution) throw new NotFoundException(`VaultDistribution "${id}" not found.`);
    if (distribution.status !== "pending") {
      throw new BadRequestException(`VaultDistribution "${id}" is ${distribution.status}, not pending — nothing to reject.`);
    }
    const claim = await tx.vaultDistribution.updateMany({
      where: { id, status: "pending" },
      data: { status: "rejected" },
    });
    if (claim.count !== 1) {
      throw new BadRequestException(`VaultDistribution "${id}" is ${distribution.status}, not pending — nothing to reject.`);
    }
    return tx.vaultDistribution.findUniqueOrThrow({ where: { id } });
  }

  private async assertPayoutReady(counterpartyId: string, tx: Prisma.TransactionClient): Promise<void> {
    const counterparty = await tx.counterparty.findUnique({ where: { id: counterpartyId } });
    if (counterparty?.payoutProvider !== "paystack") {
      throw new BadRequestException(
        `This counterparty's payout provider (${counterparty?.payoutProvider ?? "none set"}) isn't supported yet — only Paystack payouts can be approved today.`,
      );
    }
    this.decryptBankDetails(counterparty); // throws if missing/incomplete
  }

  private decryptBankDetails(counterparty: { name: string; payoutBankDetailsEncrypted: string | null }): PayoutBankDetails {
    if (!counterparty.payoutBankDetailsEncrypted) {
      throw new BadRequestException(`Counterparty "${counterparty.name}" has no payout bank details on file.`);
    }
    const details = JSON.parse(this.encryption.decrypt(counterparty.payoutBankDetailsEncrypted)) as PayoutBankDetails;
    if (!details.bankCode) {
      throw new BadRequestException(`Counterparty "${counterparty.name}"'s bank details are missing a bank code.`);
    }
    return details;
  }

  /**
   * Fires the real payout attempt, called from GovernedActionsService's
   * fire-and-forget post-commit hook (mirroring
   * DistributionsService.initiateDisbursement's own call site) and
   * mirroring that method's error handling exactly — never throws past
   * its own boundary.
   */
  async initiateDisbursement(distributionId: string): Promise<void> {
    const distribution = await prisma.vaultDistribution.findUnique({ where: { id: distributionId } });
    if (!distribution || distribution.status !== "approved") return;

    const claim = await prisma.vaultDistribution.updateMany({
      where: { id: distributionId, status: "approved" },
      data: { status: "disbursing" },
    });
    if (claim.count !== 1) return;

    const counterparty = await prisma.counterparty.findUniqueOrThrow({ where: { id: distribution.counterpartyId } });
    const bankDetails = this.decryptBankDetails(counterparty);
    const adapter = this.payoutAdapters.get("paystack")!;

    try {
      const result = await adapter.createPayout({
        amount: distribution.amount.toString(),
        currency: distribution.currency,
        reference: distribution.id,
        bankDetails,
      });
      const updated = await prisma.vaultDistribution.update({
        where: { id: distributionId },
        data: { payoutProvider: "paystack", payoutReference: result.providerReference },
      });
      await prisma.auditLog.create({
        data: {
          vaultId: distribution.vaultId,
          actorType: "system",
          action: "vault_distribution.disbursement_initiated",
          entityType: "VaultDistribution",
          entityId: distribution.id,
          before: distribution as any,
          after: updated as any,
        },
      });
    } catch (err) {
      const failed = await prisma.vaultDistribution.update({
        where: { id: distributionId },
        data: { status: "payout_failed", payoutError: err instanceof Error ? err.message : String(err) },
      });
      await prisma.auditLog.create({
        data: {
          vaultId: distribution.vaultId,
          actorType: "system",
          action: "vault_distribution.disbursement_failed",
          entityType: "VaultDistribution",
          entityId: distribution.id,
          before: distribution as any,
          after: failed as any,
        },
      });
    }
  }

  /**
   * Called from ContributionsController's webhook dispatch, ahead of
   * both the Founder-flow payout parser and every contribution parser —
   * mirrors DistributionsService.handlePayoutWebhook exactly (verify,
   * match by payoutReference, idempotent no-op on non-"disbursing").
   */
  async handlePayoutWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    const adapter = this.payoutAdapters.get("paystack")!;
    const result = await adapter.verifyAndParseWebhook(rawBody, headers);
    if (!result) return null;

    const distribution = await prisma.vaultDistribution.findUnique({ where: { payoutReference: result.providerReference } });
    if (!distribution) return null;
    if (distribution.status !== "disbursing") return distribution;

    const data =
      result.status === "paid"
        ? { status: "paid" as const, paidAt: new Date() }
        : { status: "payout_failed" as const, payoutError: "Paystack reported transfer failure/reversal." };

    return prisma.$transaction(async (tx) => {
      const updated = await tx.vaultDistribution.update({ where: { id: distribution.id }, data });
      await tx.auditLog.create({
        data: {
          vaultId: distribution.vaultId,
          actorType: "system",
          action: result.status === "paid" ? "vault_distribution.paid" : "vault_distribution.payout_failed",
          entityType: "VaultDistribution",
          entityId: distribution.id,
          before: distribution as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  /**
   * Same currency-locked, corpus-vs-proceeds-aware ceiling
   * DistributionsService.assertWithinAllocation enforces, against
   * VaultCause instead of WaqfCause. Investment-style vaults: only
   * proceedsAllocatedAmount is spendable (corpus preserved) — mirrors
   * the exact classical-waqf-perpetuity treatment CLAUDE.md documents
   * for Investment-type Waqf Funds. Every other vault type
   * (project) has no proceeds concept, so allocatedAmount stays its
   * only, fully distributable, pool.
   */
  private async assertWithinAllocation(
    vaultCauseId: string,
    additionalAmount: Prisma.Decimal,
    currency: string,
    tx: Prisma.TransactionClient,
    excludeDistributionId?: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "vault_causes" WHERE id = ${vaultCauseId} FOR UPDATE`;
    const cause = await tx.vaultCause.findUnique({ where: { id: vaultCauseId } });
    const vault = cause ? await tx.vault.findUnique({ where: { id: cause.vaultId }, select: { type: true } }) : null;
    const allocated =
      vault?.type === "investment"
        ? new Prisma.Decimal(cause?.proceedsAllocatedAmount ?? 0)
        : new Prisma.Decimal(cause?.allocatedAmount ?? 0).plus(cause?.proceedsAllocatedAmount ?? 0);

    const committedWhere: Prisma.VaultDistributionWhereInput = {
      vaultCauseId,
      deletedAt: null,
      status: { in: ["pending", "approved", "disbursing", "paid"] },
      ...(excludeDistributionId ? { id: { not: excludeDistributionId } } : {}),
    };

    const otherCurrencyCommitment = await tx.vaultDistribution.findFirst({
      where: { ...committedWhere, currency: { not: currency } },
      select: { currency: true },
    });
    if (otherCurrencyCommitment) {
      throw new BadRequestException(
        `This cause already has committed distributions in ${otherCurrencyCommitment.currency} — a distribution against the same cause can't switch to ${currency} without first resolving the earlier ones.`,
      );
    }

    const committed = await tx.vaultDistribution.aggregate({
      where: { ...committedWhere, currency },
      _sum: { amount: true },
    });
    const alreadyCommitted = committed._sum.amount ?? new Prisma.Decimal(0);

    if (alreadyCommitted.plus(additionalAmount).gt(allocated)) {
      const remaining = allocated.minus(alreadyCommitted);
      throw new BadRequestException(
        `This distribution's amount (${additionalAmount} ${currency}) exceeds this cause's unused allocation — only ${remaining.isNegative() ? 0 : remaining} ${currency} of its ${allocated} allocation is unused.`,
      );
    }
  }

  findById(id: string) {
    return prisma.vaultDistribution.findUnique({ where: { id } });
  }

  list(vaultId?: string) {
    return prisma.vaultDistribution.findMany({
      where: vaultId ? { vaultId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }
}
