import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IsNotEmpty, IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma, PayoutProvider } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { assertWithinAllocation as assertWithinAllocationShared } from "../../common/money/allocation-ceiling";
import { PayoutBankDetails, PayoutProviderAdapter } from "../distributions/providers/payout-provider.interface";
import { PaystackPayoutAdapter } from "../distributions/providers/paystack-payout.adapter";
import { CASH_AND_BANK_ACCOUNT_CODE, PROGRAM_EXPENSES_ACCOUNT_CODE, VaultLedgerService } from "./vault-ledger.service";

export class CreateVaultDistributionInput {
  @IsString()
  vaultId!: string;

  @IsString()
  vaultCauseId!: string;

  @IsString()
  counterpartyId!: string;

  // Optional — see VaultMilestone's own schema comment. When set,
  // create() refuses to create the row at all unless that milestone's
  // status is already "completed" (see below) — the real gate on
  // milestone-tranche disbursement, not just a UI-level restriction.
  @IsOptional()
  @IsString()
  vaultMilestoneId?: string;

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
    private readonly ledger: VaultLedgerService,
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
    // The milestone gate (2026-09-13) — this distribution can't even be
    // created as this milestone's tranche until vault.milestone_complete
    // has actually been approved (governed-actions.service.ts), not just
    // set unilaterally. No milestone attached at all skips this
    // entirely — an ad-hoc, non-tranche distribution behaves exactly as
    // before this feature.
    if (input.vaultMilestoneId) {
      const milestone = await prisma.vaultMilestone.findUnique({ where: { id: input.vaultMilestoneId } });
      if (!milestone || milestone.vaultId !== input.vaultId) {
        throw new BadRequestException(`Milestone "${input.vaultMilestoneId}" does not belong to vault "${input.vaultId}".`);
      }
      if (milestone.status !== "completed") {
        throw new BadRequestException(`Milestone "${milestone.name}" isn't marked completed yet — its tranche can't be disbursed.`);
      }
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
    // Defense-in-depth re-check, same reasoning as the headroom re-check
    // above: create() already confirmed the milestone was completed,
    // but that was potentially a while ago (this is a governed action,
    // decided whenever a checker gets to it) — re-verify rather than
    // trust a status read at proposal time. No un-complete path exists
    // today, so this can't currently fail; it's here so it can't be
    // silently bypassed if one ever does.
    if (distribution.vaultMilestoneId) {
      const milestone = await tx.vaultMilestone.findUnique({ where: { id: distribution.vaultMilestoneId } });
      if (milestone?.status !== "completed") {
        throw new BadRequestException(`Milestone "${milestone?.name ?? distribution.vaultMilestoneId}" isn't marked completed — its tranche can't be approved.`);
      }
    }

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
   * Staff-callable, deliberately NOT re-routed through governed_actions
   * — mirrors DistributionsService.retryDisbursement() exactly: the
   * governance decision (vault.distribution_approve) already happened
   * and is final, so this is purely payment-mechanics retry, same trust
   * tier as a webhook-driven retry would be. Re-checks headroom (a
   * payout_failed row is excluded from assertWithinAllocation's
   * committed sum, so other distributions against the same cause may
   * have consumed the space in the meantime) before re-attempting.
   */
  async retryDisbursement(distributionId: string, staffUserId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const distribution = await tx.vaultDistribution.findUnique({ where: { id: distributionId } });
      if (!distribution) throw new NotFoundException(`VaultDistribution "${distributionId}" not found.`);
      if (distribution.status !== "payout_failed") {
        throw new BadRequestException(
          `VaultDistribution "${distributionId}" is not in a failed-payout state (status: ${distribution.status}).`,
        );
      }
      await this.assertWithinAllocation(distribution.vaultCauseId, distribution.amount, distribution.currency, tx, distributionId);
      // Atomic claim: two rapid "Retry disbursement" clicks on the same
      // failed row could otherwise both pass the check above and both go
      // on to call initiateDisbursement() below.
      const claim = await tx.vaultDistribution.updateMany({
        where: { id: distributionId, status: "payout_failed" },
        data: { status: "approved", payoutError: null },
      });
      if (claim.count !== 1) {
        throw new BadRequestException(
          `VaultDistribution "${distributionId}" is not in a failed-payout state (status: ${distribution.status}).`,
        );
      }
      const updated = await tx.vaultDistribution.findUniqueOrThrow({ where: { id: distributionId } });
      await tx.auditLog.create({
        data: {
          vaultId: distribution.vaultId,
          actorType: "birr_staff",
          actorUserId: staffUserId,
          action: "vault_distribution.disbursement_retried",
          entityType: "VaultDistribution",
          entityId: distribution.id,
          before: distribution as any,
          after: updated as any,
        },
      });
    });
    // Outside the tx — real HTTP call. Awaited (not fire-and-forget) so
    // the staff member clicking "Retry disbursement" sees the outcome
    // in the response, rather than polling for it.
    await this.initiateDisbursement(distributionId);
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

      // Double-entry auto-post (2026-09-13) — Debit Program Expenses,
      // Credit Cash & Bank, same transaction as the status flip. Only
      // on an actual "paid" outcome — a failed payout moved no real
      // money, so nothing gets posted for it.
      if (result.status === "paid") {
        const programExpenses = await this.ledger.getAccountByCode(tx, PROGRAM_EXPENSES_ACCOUNT_CODE);
        const cashAndBank = await this.ledger.getAccountByCode(tx, CASH_AND_BANK_ACCOUNT_CODE);
        await this.ledger.post(tx, {
          vaultId: distribution.vaultId,
          description: "Distribution paid to counterparty",
          currency: distribution.currency,
          source: "distribution",
          sourceId: updated.id,
          actorType: "system",
          lines: [
            { ledgerAccountId: programExpenses.id, debit: distribution.amount },
            { ledgerAccountId: cashAndBank.id, credit: distribution.amount },
          ],
        });
      }

      return updated;
    });
  }

  /**
   * Same shared ceiling DistributionsService.assertWithinAllocation
   * delegates to (../../common/money/allocation-ceiling) — this method
   * is only the VaultCause/VaultDistribution-specific plumbing (which
   * rows count as "committed", which table gets row-locked). See that
   * module's own comment for the actual policy and its history.
   */
  private async assertWithinAllocation(
    vaultCauseId: string,
    additionalAmount: Prisma.Decimal,
    currency: string,
    tx: Prisma.TransactionClient,
    excludeDistributionId?: string,
  ): Promise<void> {
    const committedWhere: Prisma.VaultDistributionWhereInput = {
      vaultCauseId,
      deletedAt: null,
      status: { in: ["pending", "approved", "disbursing", "paid"] },
      ...(excludeDistributionId ? { id: { not: excludeDistributionId } } : {}),
    };
    await assertWithinAllocationShared(vaultCauseId, additionalAmount, currency, {
      lockCause: async (id) => {
        await tx.$queryRaw`SELECT id FROM "vault_causes" WHERE id = ${id} FOR UPDATE`;
      },
      loadCauseAndParentType: async (id) => {
        const cause = await tx.vaultCause.findUnique({ where: { id } });
        const vault = cause ? await tx.vault.findUnique({ where: { id: cause.vaultId }, select: { type: true } }) : null;
        return { cause, parentType: vault?.type ?? null };
      },
      findCommittedInOtherCurrency: (curr) =>
        tx.vaultDistribution.findFirst({ where: { ...committedWhere, currency: { not: curr } }, select: { currency: true } }),
      sumCommittedInCurrency: async (curr) =>
        (await tx.vaultDistribution.aggregate({ where: { ...committedWhere, currency: curr }, _sum: { amount: true } }))._sum.amount,
    });
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
