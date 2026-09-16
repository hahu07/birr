import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IsNotEmpty, IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma, PayoutProvider } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { NotificationsService } from "../notifications/notifications.service";
import { resolveFounderRecipientUserIdsForWaqf } from "../../common/notifications/resolve-founder-recipients";
import { assertWithinAllocation as assertWithinAllocationShared } from "../../common/money/allocation-ceiling";
import { CASH_AND_BANK_ACCOUNT_CODE, PROGRAM_EXPENSES_ACCOUNT_CODE, WaqfLedgerService } from "../waqf-ledger/waqf-ledger.service";
import { PayoutProviderAdapter } from "./providers/payout-provider.interface";
import { PaystackPayoutAdapter } from "./providers/paystack-payout.adapter";
import { StripePayoutAdapter } from "./providers/stripe-payout.adapter";
import { StablecoinPayoutAdapter } from "./providers/stablecoin-payout.adapter";

export class CreateDistributionInput {
  @IsString()
  waqfId!: string;

  @IsString()
  causeId!: string;

  @IsString()
  beneficiaryId!: string;

  // Optional — see WaqfMilestone's own schema comment. When set,
  // create() refuses to create the row at all unless that milestone's
  // status is already "completed" — the real gate on milestone-tranche
  // disbursement for a Project-type Waqf Fund, mirroring
  // CreateVaultDistributionInput.vaultMilestoneId exactly.
  @IsOptional()
  @IsString()
  waqfMilestoneId?: string;

  // See AssetsService's CreateAssetInput.estimatedValue for why this is
  // @IsNumberString rather than @IsNumber.
  @IsNumberString()
  amount!: Prisma.Decimal | number | string;

  // No default — every distribution must declare its own currency
  // explicitly, same posture as Contribution.currency. See the schema's
  // own comment on Distribution.currency for why this exists at all.
  @IsString()
  @IsNotEmpty()
  currency!: string;
}

@Injectable()
export class DistributionsService {
  private readonly logger = new Logger(DistributionsService.name);
  private readonly payoutAdapters: Map<PayoutProvider, PayoutProviderAdapter>;

  constructor(
    private readonly beneficiariesService: BeneficiariesService,
    private readonly notificationsService: NotificationsService,
    private readonly ledger: WaqfLedgerService,
    stripePayoutAdapter: StripePayoutAdapter,
    paystackPayoutAdapter: PaystackPayoutAdapter,
    stablecoinPayoutAdapter: StablecoinPayoutAdapter,
  ) {
    this.payoutAdapters = new Map<PayoutProvider, PayoutProviderAdapter>([
      ["stripe", stripePayoutAdapter],
      ["paystack", paystackPayoutAdapter],
      ["stablecoin", stablecoinPayoutAdapter],
    ]);
  }

  /**
   * causeId is required — every payout must be traceable to a specific
   * cause, not just to the fund (CLAUDE.md-adjacent restructuring: see
   * the Founder -> Foundation -> Waqf Fund -> Cause plan). Nothing at
   * the schema level stops posting a causeId that belongs to a
   * *different* waqf than the one specified (Postgres can't express
   * "this cause belongs to this waqf" as a composite FK here), so that's
   * checked here instead.
   */
  // Not maker-checker gated (only distribution.approve is), but still a
  // create on a governed entity per CLAUDE.md's audit-trail
  // non-negotiable — wrapped in a transaction so the create and its
  // audit row are atomic.
  async create(input: CreateDistributionInput, actorUserId: string) {
    const [cause, waqf] = await Promise.all([
      prisma.waqfCause.findUnique({ where: { id: input.causeId } }),
      prisma.waqf.findUnique({ where: { id: input.waqfId } }),
    ]);
    if (!cause || cause.waqfId !== input.waqfId) {
      throw new BadRequestException(
        `Cause "${input.causeId}" does not belong to waqf "${input.waqfId}".`,
      );
    }
    // See assertWithinAllocation's own comment: allocatedAmount/
    // proceedsAllocatedAmount carry no currency of their own, so
    // whichever currency reaches assertWithinAllocation first silently
    // becomes "the" currency for that cause's ceiling — a distribution
    // in the wrong currency would pass that check comparing raw numbers
    // as if e.g. USD and NGN were equivalent (found 2026-09-04, live).
    // Anchoring to the waqf's own declared corpusCurrency here, before
    // a mismatched currency ever gets the chance to lock in, closes
    // that at its root. Waqfs with no declared corpusCurrency (legacy)
    // fall through unchecked, same posture as allocate()'s own
    // poolCurrency resolution.
    if (waqf?.corpusCurrency && waqf.corpusCurrency !== input.currency) {
      throw new BadRequestException(
        `This waqf's corpus is denominated in ${waqf.corpusCurrency} — a distribution must use that same currency, not ${input.currency}.`,
      );
    }
    // The milestone gate (2026-09-15, ported from
    // VaultDistributionsService.create()'s own gate) — this
    // distribution can't even be created as this milestone's tranche
    // until waqf.milestone_complete has actually been approved. No
    // milestone attached at all skips this entirely.
    if (input.waqfMilestoneId) {
      const milestone = await prisma.waqfMilestone.findUnique({ where: { id: input.waqfMilestoneId } });
      if (!milestone || milestone.waqfId !== input.waqfId) {
        throw new BadRequestException(`Milestone "${input.waqfMilestoneId}" does not belong to waqf "${input.waqfId}".`);
      }
      if (milestone.status !== "completed") {
        throw new BadRequestException(`Milestone "${milestone.name}" isn't marked completed yet — its tranche can't be disbursed.`);
      }
    }
    return prisma.$transaction(async (tx) => {
      await this.assertBeneficiaryEligible(input.waqfId, input.beneficiaryId, input.causeId, tx);
      await this.assertWithinAllocation(input.causeId, new Prisma.Decimal(input.amount), input.currency, tx);
      const distribution = await tx.distribution.create({ data: input });
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "distribution.created",
          entityType: "Distribution",
          entityId: distribution.id,
          after: distribution as any,
        },
      });
      return distribution;
    });
  }

  /**
   * Internal only — never expose this behind a public controller route.
   * distribution.approve is a governed action (see schema.prisma's
   * comment on Distribution); the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. See reject() below for the rejection counterpart —
   * unlike most governed actions, a Distribution row already exists at
   * `pending` from create() time, so rejecting its approval has a real
   * status to move it to, not just "nothing was ever created."
   */
  async approve(id: string, tx: Prisma.TransactionClient) {
    const distribution = await tx.distribution.findUnique({ where: { id } });
    if (!distribution) throw new NotFoundException(`Distribution "${id}" not found.`);
    if (distribution.status !== "pending") {
      throw new BadRequestException(
        `Distribution "${id}" is ${distribution.status}, not pending — nothing to approve.`,
      );
    }
    // Payout-readiness gate — checked first, since it's the check a
    // checker will hit most often in practice, and throwing here rolls
    // back GovernedActionsService.decide()'s whole transaction, leaving
    // the governed action "proposed" rather than "approved": approval
    // of a distribution.approve action is deliberately blocked outright
    // if the beneficiary can't actually be paid, not just left to fail
    // silently at disbursement time. See assertPayoutReady's own
    // comment.
    await this.assertPayoutReady(distribution.beneficiaryId, tx);
    // Defense-in-depth re-check: create() already validated this amount
    // fit within the cause's allocation, but headroom can shrink between
    // propose and decide (another distribution created/approved against
    // the same cause in the meantime) — exclude this row's own amount
    // from "already committed" since it's added back as the amount being
    // (re-)confirmed. Same reasoning for beneficiary eligibility below:
    // status/expiry can change in that same gap.
    await this.assertBeneficiaryEligible(distribution.waqfId, distribution.beneficiaryId, distribution.causeId, tx);
    await this.assertWithinAllocation(distribution.causeId, distribution.amount, distribution.currency, tx, id);
    // Defense-in-depth re-check, same reasoning as the headroom
    // re-check above — create() already confirmed the milestone was
    // completed, but that was potentially a while ago. No un-complete
    // path exists today, so this can't currently fail; it's here so it
    // can't be silently bypassed if one ever does. Mirrors
    // VaultDistributionsService.approve()'s own re-check exactly.
    if (distribution.waqfMilestoneId) {
      const milestone = await tx.waqfMilestone.findUnique({ where: { id: distribution.waqfMilestoneId } });
      if (milestone?.status !== "completed") {
        throw new BadRequestException(`Milestone "${milestone?.name ?? distribution.waqfMilestoneId}" isn't marked completed — its tranche can't be approved.`);
      }
    }
    // Atomic claim (not a plain update): only one caller can flip a given
    // "pending" row — the same class of race this method's status guard
    // above already fast-fails on, closed for real here.
    const claim = await tx.distribution.updateMany({
      where: { id, status: "pending" },
      data: { status: "approved", approvedAt: new Date() },
    });
    if (claim.count !== 1) {
      throw new BadRequestException(
        `Distribution "${id}" is ${distribution.status}, not pending — nothing to approve.`,
      );
    }
    return tx.distribution.findUniqueOrThrow({ where: { id } });
  }

  /**
   * The rejection counterpart to approve(). Only caller is
   * GovernedActionsService's handler map, on rejection, inside its own
   * transaction — same shape as onApprove's own fulfillment call, so a
   * rejection gets exactly as real an audit trail as an approval does.
   *
   * Without this, a rejected distribution.approve action left the
   * underlying Distribution row stuck at `pending` forever —
   * assertWithinAllocation counts `pending` as a real, committed claim
   * on the cause's ceiling (correctly so, for a distribution still
   * awaiting a decision), so a rejected-but-never-updated row
   * permanently occupied that share of the ceiling with no way to
   * release it: no cancel/delete endpoint exists for a Distribution
   * (CLAUDE.md: never hard-delete a governed record), and
   * DistributionStatus.rejected existed in the schema but nothing ever
   * set it (found 2026-09-04, live — a real distribution stuck exactly
   * this way after a corpus-vs-proceeds ceiling change left it
   * over-allocated).
   */
  async reject(id: string, tx: Prisma.TransactionClient) {
    const distribution = await tx.distribution.findUnique({ where: { id } });
    if (!distribution) throw new NotFoundException(`Distribution "${id}" not found.`);
    if (distribution.status !== "pending") {
      throw new BadRequestException(
        `Distribution "${id}" is ${distribution.status}, not pending — nothing to reject.`,
      );
    }
    // Same atomic-claim shape as approve() above, for the same reason —
    // low real-world stakes on a rejection, but no reason to leave one
    // sibling race-safe and the other not.
    const claim = await tx.distribution.updateMany({
      where: { id, status: "pending" },
      data: { status: "rejected" },
    });
    if (claim.count !== 1) {
      throw new BadRequestException(
        `Distribution "${id}" is ${distribution.status}, not pending — nothing to reject.`,
      );
    }
    return tx.distribution.findUniqueOrThrow({ where: { id } });
  }

  /**
   * A distribution.approve action can only ever be approved (not just
   * disbursed) if the beneficiary can actually be paid — checked here,
   * not just at disbursement time, so a checker never approves a payout
   * that's structurally impossible to fulfill. Only "paystack" is a
   * real, working payout rail today (see PayoutProvider's own schema
   * comment) — everything else is an honest stub that would only fail
   * later, so it's rejected here instead. Delegates the actual
   * completeness check (bank details present, bank code present) to
   * BeneficiariesService.getDecryptedBankDetailsForPayout, which throws
   * with a specific reason if anything's missing — this method only
   * adds the payoutProvider gate on top.
   */
  private async assertPayoutReady(beneficiaryId: string, tx: Prisma.TransactionClient): Promise<void> {
    const beneficiary = await tx.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { payoutProvider: true },
    });
    if (beneficiary?.payoutProvider !== "paystack") {
      throw new BadRequestException(
        `This beneficiary's payout provider (${beneficiary?.payoutProvider ?? "none set"}) isn't supported yet — only Paystack payouts can be approved today.`,
      );
    }
    // Throws if bank details or a bank code are missing.
    await this.beneficiariesService.getDecryptedBankDetailsForPayout(beneficiaryId, tx);
  }

  /**
   * Fires the real payout attempt against Paystack — called from
   * GovernedActionsService.decide() right after a distribution.approve
   * action commits (fire-and-forget, post-commit — this makes a real
   * HTTP call, which must never happen inside a DB transaction), and
   * again from retryDisbursement() after a payout_failed row is reset
   * back to "approved". Never throws past its own boundary — every real
   * failure (a network error, a Paystack-side rejection) is caught and
   * recorded as payout_failed, so callers only need to handle genuinely
   * unexpected errors (e.g. a DB blip on the initial lookup).
   *
   * Claims the row (approved -> disbursing) atomically *before* calling
   * the payout adapter, not after — this used to write "disbursing" only
   * on success, which left the window between reading "approved" and
   * writing "disbursing" wide open around the real HTTP call: two
   * concurrent callers (a raced decide(), or a retry racing the original
   * fire-and-forget call) could both read "approved" and both fire a
   * live payout. Claiming first means only one caller's updateMany can
   * match a still-"approved" row; the other's `count` comes back 0 and
   * it returns without ever touching the adapter. Not $transaction
   * -wrapped past the claim: the HTTP call still sits outside any DB
   * transaction (must never hold one open across a network call), so the
   * claim-write, the outcome-write, and the audit-write are three
   * separate statements — on a crash between them, the row is left
   * "disbursing" with no outcome recorded yet, which is an accurate
   * "we don't know if this succeeded" signal for manual reconciliation,
   * not a silent "approved" row that a naive retry could pay again.
   */
  async initiateDisbursement(distributionId: string): Promise<void> {
    const distribution = await prisma.distribution.findUnique({ where: { id: distributionId } });
    if (!distribution || distribution.status !== "approved") return;

    const claim = await prisma.distribution.updateMany({
      where: { id: distributionId, status: "approved" },
      data: { status: "disbursing" },
    });
    if (claim.count !== 1) return; // another caller already claimed this disbursement

    const bankDetails = await this.beneficiariesService.getDecryptedBankDetailsForPayout(distribution.beneficiaryId);
    const adapter = this.payoutAdapters.get("paystack")!; // assertPayoutReady already guaranteed paystack is the only reachable provider by the time a distribution reaches "approved"

    try {
      const result = await adapter.createPayout({
        amount: distribution.amount.toString(),
        currency: distribution.currency,
        reference: distribution.id,
        bankDetails,
      });
      const updated = await prisma.distribution.update({
        where: { id: distributionId },
        data: { payoutProvider: "paystack", payoutReference: result.providerReference },
      });
      await prisma.auditLog.create({
        data: {
          waqfId: distribution.waqfId,
          actorType: "system",
          action: "distribution.disbursement_initiated",
          entityType: "Distribution",
          entityId: distribution.id,
          before: distribution as any,
          after: updated as any,
        },
      });
    } catch (err) {
      const failed = await prisma.distribution.update({
        where: { id: distributionId },
        data: { status: "payout_failed", payoutError: err instanceof Error ? err.message : String(err) },
      });
      await prisma.auditLog.create({
        data: {
          waqfId: distribution.waqfId,
          actorType: "system",
          action: "distribution.disbursement_failed",
          entityType: "Distribution",
          entityId: distribution.id,
          before: distribution as any,
          after: failed as any,
        },
      });
    }
  }

  /**
   * Staff-callable, deliberately NOT re-routed through governed_actions
   * — the governance decision (distribution.approve) already happened
   * and is final; this is purely payment-mechanics retry, same trust
   * tier as a webhook-driven retry would be. Re-checks headroom (it may
   * have shifted since the original approval — a payout_failed row is
   * excluded from assertWithinAllocation's committed sum, so other
   * distributions against the same cause may have consumed the space in
   * the meantime) before re-attempting.
   */
  async retryDisbursement(distributionId: string, staffUserId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const distribution = await tx.distribution.findUnique({ where: { id: distributionId } });
      if (!distribution) throw new NotFoundException(`Distribution "${distributionId}" not found.`);
      if (distribution.status !== "payout_failed") {
        throw new BadRequestException(
          `Distribution "${distributionId}" is not in a failed-payout state (status: ${distribution.status}).`,
        );
      }
      await this.assertWithinAllocation(distribution.causeId, distribution.amount, distribution.currency, tx, distributionId);
      // Atomic claim: two rapid "Retry disbursement" clicks on the same
      // failed row could otherwise both pass the check above and both go
      // on to call initiateDisbursement() below.
      const claim = await tx.distribution.updateMany({
        where: { id: distributionId, status: "payout_failed" },
        data: { status: "approved", payoutError: null },
      });
      if (claim.count !== 1) {
        throw new BadRequestException(
          `Distribution "${distributionId}" is not in a failed-payout state (status: ${distribution.status}).`,
        );
      }
      const updated = await tx.distribution.findUniqueOrThrow({ where: { id: distributionId } });
      await tx.auditLog.create({
        data: {
          waqfId: distribution.waqfId,
          actorType: "birr_staff",
          actorUserId: staffUserId,
          action: "distribution.disbursement_retried",
          entityType: "Distribution",
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
   * Called from ContributionsController's webhook dispatch, tried
   * before the inbound-charge webhook path — see that controller's own
   * comment on why both event families share one route. Mirrors
   * ContributionsService.handleWebhook's shape: verify+parse, match by
   * payoutReference, idempotent no-op on a non-"disbursing" row (a
   * genuine replay, distinct from "not handled here" — returns the row,
   * not null), $transaction-wrapped update + audit log, fire-and-forget
   * founder notification.
   */
  async handlePayoutWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    const adapter = this.payoutAdapters.get("paystack")!;
    const result = await adapter.verifyAndParseWebhook(rawBody, headers);
    if (!result) return null; // not a payout event under this signature, or bad signature — caller falls through to the contributions webhook path

    const distribution = await prisma.distribution.findUnique({ where: { payoutReference: result.providerReference } });
    if (!distribution) return null; // verified but unrecognized — same posture as ContributionsService.handleWebhook
    if (distribution.status !== "disbursing") return distribution; // idempotent replay no-op

    const data =
      result.status === "paid"
        ? { status: "paid" as const, paidAt: new Date() }
        : { status: "payout_failed" as const, payoutError: "Paystack reported transfer failure/reversal." };

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.distribution.update({ where: { id: distribution.id }, data });
      await tx.auditLog.create({
        data: {
          waqfId: distribution.waqfId,
          actorType: "system",
          action: result.status === "paid" ? "distribution.paid" : "distribution.payout_failed",
          entityType: "Distribution",
          entityId: distribution.id,
          before: distribution as any,
          after: updated as any,
        },
      });

      // Double-entry auto-post (2026-09-15, ported from
      // VaultDistributionsService.handlePayoutWebhook's own hook) —
      // Debit Program Expenses, Credit Cash & Bank, same transaction as
      // the status flip. Only on an actual "paid" outcome — a failed
      // payout moved no real money.
      if (result.status === "paid") {
        const programExpenses = await this.ledger.getAccountByCode(tx, PROGRAM_EXPENSES_ACCOUNT_CODE);
        const cashAndBank = await this.ledger.getAccountByCode(tx, CASH_AND_BANK_ACCOUNT_CODE);
        await this.ledger.post(tx, {
          waqfId: distribution.waqfId,
          description: "Distribution paid to beneficiary",
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

    // Fire-and-forget, mirroring notifyDecision's / ContributionsService
    // .notifyContributionOutcome's own posture — a webhook's response
    // time shouldn't depend on Resend/Twilio round-trips.
    this.notifyPayoutOutcome(distribution.waqfId, result.status, updated).catch((err) => {
      this.logger.error(
        `Failed to notify on payout outcome for distribution "${updated.id}":`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    return updated;
  }

  private async notifyPayoutOutcome(
    waqfId: string,
    outcome: "paid" | "failed",
    distribution: { id: string; amount: string | Prisma.Decimal; currency: string },
  ): Promise<void> {
    const recipientUserIds = await resolveFounderRecipientUserIdsForWaqf(waqfId);
    const type = outcome === "paid" ? "distribution.paid" : "distribution.payout_failed";
    const title = outcome === "paid" ? "Distribution paid" : "Distribution payout failed";
    const body =
      outcome === "paid"
        ? `${distribution.currency} ${distribution.amount} was paid out.`
        : `A ${distribution.currency} ${distribution.amount} payout could not be completed — Birr staff have been notified.`;
    await Promise.all(
      recipientUserIds.map((userId) =>
        this.notificationsService.notify({
          recipientType: "founder_user",
          recipientUserId: userId,
          type,
          title,
          body,
          linkUrl: `/portfolio/${waqfId}`,
          relatedEntityType: "Distribution",
          relatedEntityId: distribution.id,
        }),
      ),
    );
  }

  /**
   * A distribution can only ever be created/approved against a
   * beneficiary who's actually active and not past their eligibility
   * expiry — see BeneficiariesService.updateStatus's own comment on why
   * this is the other half of making the status field mean something.
   * Lazily checked here, not a scheduled job (CLAUDE.md: "start simple"
   * on scheduling) — same style as assertWithinAllocation's own
   * check-at-write-time posture rather than a background sweep.
   *
   * Also cross-checks `causeId` against the beneficiary's own
   * `Beneficiary.causeId` — the cause they were actually nominated and
   * vetted for (eligibilityCriteria is written *for that cause's
   * purpose*, e.g. "widowed, no income" for Poverty Relief vs. "enrolled
   * in school" for Education). Without this, nothing stopped a
   * distribution against a *different* cause on the same waqf for the
   * same beneficiary — same active status, same eligibility-expiry
   * check passing regardless of which cause was picked in the form, so
   * a beneficiary vetted for one cause's purpose could receive money
   * earmarked for an entirely unrelated one (found 2026-09-04, live).
   * `causeId` is nullable on Beneficiary (legacy rows predating this
   * field being required — see that field's own schema comment); a
   * beneficiary with none on file falls through unchecked, same
   * "historical data, nothing to validate against" posture as
   * corpusCurrency elsewhere in this file.
   */
  private async assertBeneficiaryEligible(
    waqfId: string,
    beneficiaryId: string,
    causeId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const beneficiary = await tx.beneficiary.findUnique({ where: { id: beneficiaryId } });
    if (!beneficiary || beneficiary.waqfId !== waqfId) {
      throw new BadRequestException(`Beneficiary "${beneficiaryId}" does not belong to waqf "${waqfId}".`);
    }
    if (beneficiary.status !== "active") {
      throw new BadRequestException(`Beneficiary "${beneficiary.name}" is not active.`);
    }
    if (beneficiary.eligibilityExpiresAt && beneficiary.eligibilityExpiresAt < new Date()) {
      throw new BadRequestException(
        `Beneficiary "${beneficiary.name}"'s eligibility expired on ${beneficiary.eligibilityExpiresAt.toDateString()}.`,
      );
    }
    if (beneficiary.causeId && beneficiary.causeId !== causeId) {
      const [nominatedCause, requestedCause] = await Promise.all([
        tx.waqfCause.findUnique({ where: { id: beneficiary.causeId }, select: { name: true } }),
        tx.waqfCause.findUnique({ where: { id: causeId }, select: { name: true } }),
      ]);
      throw new BadRequestException(
        `Beneficiary "${beneficiary.name}" was nominated for "${nominatedCause?.name ?? beneficiary.causeId}" — not eligible for a distribution against "${requestedCause?.name ?? causeId}".`,
      );
    }
  }

  /**
   * A cause with nothing allocated in either pool can't be distributed
   * from yet — this is what gives WaqfCausesService.allocate() (Founder
   * self-service, corpus-based) and .allocateProceeds() (Birr staff,
   * investment-proceeds-based) real teeth instead of being decorative
   * numbers. The actual policy (corpus-vs-proceeds treatment, the
   * single-currency lock-in, the TOCTOU row lock) lives in the shared
   * ../../common/money/allocation-ceiling — see that module's own
   * comment for the full history (this policy has already changed
   * twice: CLAUDE.md's 2026-08-27 and 2026-09-04 updates) and its spec
   * for the behavior this thin wrapper delegates to. This method is
   * only the WaqfCause/Distribution-specific plumbing: which rows count
   * as "committed" (pending/approved/disbursing/paid — deliberately
   * EXCLUDES payout_failed, since a failed payout never actually moved
   * money and releases its claim on the ceiling) and which table gets
   * row-locked. Excludes `excludeDistributionId` so approve()'s/
   * retryDisbursement's re-checks don't double-count the row being
   * (re-)confirmed against itself.
   */
  private async assertWithinAllocation(
    causeId: string,
    additionalAmount: Prisma.Decimal,
    currency: string,
    tx: Prisma.TransactionClient,
    excludeDistributionId?: string,
  ): Promise<void> {
    const committedWhere: Prisma.DistributionWhereInput = {
      causeId,
      deletedAt: null,
      status: { in: ["pending", "approved", "disbursing", "paid"] },
      ...(excludeDistributionId ? { id: { not: excludeDistributionId } } : {}),
    };
    await assertWithinAllocationShared(causeId, additionalAmount, currency, {
      lockCause: async (id) => {
        await tx.$queryRaw`SELECT id FROM "waqf_causes" WHERE id = ${id} FOR UPDATE`;
      },
      // WaqfCause's ceiling has no currency dimension (unlike
      // VaultCauseAllocation) — the `currency` param is ignored here on
      // purpose, see loadCauseAndParentType's own interface comment.
      loadCauseAndParentType: async (id) => {
        const cause = await tx.waqfCause.findUnique({ where: { id } });
        const waqf = cause ? await tx.waqf.findUnique({ where: { id: cause.waqfId }, select: { type: true } }) : null;
        return { cause, parentType: waqf?.type ?? null };
      },
      findCommittedInOtherCurrency: (curr) =>
        tx.distribution.findFirst({ where: { ...committedWhere, currency: { not: curr } }, select: { currency: true } }),
      sumCommittedInCurrency: async (curr) =>
        (await tx.distribution.aggregate({ where: { ...committedWhere, currency: curr }, _sum: { amount: true } }))._sum.amount,
    });
  }

  findById(id: string) {
    return prisma.distribution.findUnique({ where: { id } });
  }

  list(waqfId?: string) {
    return prisma.distribution.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  // Platform-wide total actually paid out, for the Ops Console's own
  // landing-page overview (see apps/web/app/ops/page.tsx's
  // PlatformOverview) — across every waqf, not one. Only "paid" counts
  // — same reasoning as summaryByCause's own filter (approved alone no
  // longer means money moved, see approve()'s own comment). Grouped by
  // (waqf type, currency), same reasoning as founderSummary() below —
  // an Investment-type waqf's distributions can draw on the separate,
  // staff-governed proceeds pool on top of corpus, every other type only
  // ever spends corpus, so blending them into one figure would mix money
  // with two different fiduciary characters.
  async platformSummary(): Promise<{ waqfType: string; currency: string; totalAmount: Prisma.Decimal }[]> {
    const rows = await prisma.distribution.findMany({
      where: { status: "paid", deletedAt: null },
      select: { amount: true, currency: true, waqf: { select: { type: true } } },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      const key = `${row.waqf.type}:${row.currency}`;
      totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).plus(row.amount));
    }
    return [...totals.entries()].map(([key, totalAmount]) => {
      const [waqfType, currency] = key.split(":");
      return { waqfType, currency, totalAmount };
    });
  }

  // Founder-scoped counterpart to platformSummary() above, for the
  // Founder Portal's own Overview page — paid-only total distributed
  // across every waqf this founder has established, grouped by
  // (waqf type, currency), not currency alone. This split matters
  // fiduciarily, not just cosmetically: an Investment-type waqf's
  // distributions can draw on WaqfCause.proceedsAllocatedAmount (a
  // staff-governed investment-returns pool) on top of allocatedAmount
  // (corpus), while every other waqf type only ever has the corpus pool
  // — see DistributionsService.assertWithinAllocation and CLAUDE.md's
  // Cause Allocation section. A single blended "Distributed" figure
  // would silently mix money with two different fiduciary characters.
  // Prisma's groupBy can't span the Distribution -> Waqf relation, so
  // this is a plain fetch-then-reduce instead (founder-scale row counts
  // make that cheap) rather than the groupBy() platformSummary() uses.
  // Routed through withFounderScope (2026-08-31 codebase audit finding)
  // — the ownership scoping in the where-clause below was already
  // correct on its own, but without the RLS session var set,
  // founder_isolation was a silent no-op on this read.
  async founderSummary(
    founderId: string,
  ): Promise<{ waqfType: string; currency: string; totalAmount: Prisma.Decimal }[]> {
    const rows = await withFounderScope(founderId, (tx) =>
      tx.distribution.findMany({
        where: {
          status: "paid",
          deletedAt: null,
          waqf: { foundation: { foundationFounders: { some: { founderId } } } },
        },
        select: { amount: true, currency: true, waqf: { select: { type: true } } },
      }),
    );
    const totals = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      const key = `${row.waqf.type}:${row.currency}`;
      totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).plus(row.amount));
    }
    return [...totals.entries()].map(([key, totalAmount]) => {
      const [waqfType, currency] = key.split(":");
      return { waqfType, currency, totalAmount };
    });
  }

  /**
   * Cause-level financial rollup — computed fresh on every read, not a
   * persisted "report" row, matching ComplianceReportsService.generate's
   * own convention. Grouped by (causeId, currency): a waqf can receive
   * contributions in several currencies, so a single blended sum per
   * cause would be meaningless — see Distribution.currency's own schema
   * comment. Only counts "paid" distributions — money has only actually
   * moved once a transfer.success webhook confirms it (see
   * handlePayoutWebhook); "approved" alone no longer means that (see
   * DistributionsService.approve's own comment and PayoutProvider's
   * schema comment for the real payout lifecycle this now tracks).
   * Distinct beneficiary count per group comes from a second query
   * since Prisma's groupBy can't express COUNT(DISTINCT beneficiaryId)
   * directly.
   */
  // Optional tx client — summaryByCauseForFounder below runs this inside
  // withFounderScope's RLS-scoped transaction; the plain Ops-console path
  // (DistributionsController.summary()) calls it standalone, same
  // optional-client convention as AssetsService.create.
  //
  // includeBeneficiaryNames defaults to false and must stay that way for
  // summaryByCauseForFounder below — beneficiary identity never crosses
  // into the Founder Portal (see summaryForFounder's own comment on this
  // codebase's standard endowment-confidentiality posture). Only
  // DistributionsController.summary()'s staff branch passes true.
  async summaryByCause(
    waqfId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma,
    includeBeneficiaryNames = false,
  ) {
    const grouped = await client.distribution.groupBy({
      by: ["causeId", "currency"],
      where: { waqfId, status: "paid", deletedAt: null },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const causeIds = [...new Set(grouped.map((g) => g.causeId))];
    const [causes, distributions] = await Promise.all([
      client.waqfCause.findMany({ where: { id: { in: causeIds } } }),
      client.distribution.findMany({
        where: { waqfId, status: "paid", deletedAt: null, causeId: { in: causeIds } },
        select: {
          causeId: true,
          beneficiaryId: true,
          beneficiary: includeBeneficiaryNames ? { select: { name: true } } : false,
        },
      }),
    ]);
    const causeById = new Map(causes.map((c) => [c.id, c]));
    const beneficiaryIdsByCause = new Map<string, Set<string>>();
    const beneficiaryNamesByCause = new Map<string, Set<string>>();
    for (const d of distributions) {
      if (!beneficiaryIdsByCause.has(d.causeId)) beneficiaryIdsByCause.set(d.causeId, new Set());
      beneficiaryIdsByCause.get(d.causeId)!.add(d.beneficiaryId);
      const name = (d as { beneficiary?: { name: string } }).beneficiary?.name;
      if (name) {
        if (!beneficiaryNamesByCause.has(d.causeId)) beneficiaryNamesByCause.set(d.causeId, new Set());
        beneficiaryNamesByCause.get(d.causeId)!.add(name);
      }
    }

    return grouped.map((g) => ({
      causeId: g.causeId,
      causeName: causeById.get(g.causeId)?.name ?? "Unknown cause",
      currency: g.currency,
      totalAmount: g._sum.amount ?? new Prisma.Decimal(0),
      distributionCount: g._count._all,
      beneficiaryCount: beneficiaryIdsByCause.get(g.causeId)?.size ?? 0,
      ...(includeBeneficiaryNames
        ? { beneficiaryNames: [...(beneficiaryNamesByCause.get(g.causeId) ?? [])] }
        : {}),
    }));
  }

  // Founder-Portal read-only visibility into their own waqf's
  // distribution history — the aggregated-by-cause shape already, not
  // individual distribution rows, so no beneficiary PII crosses into the
  // Founder Portal (beneficiaryCount only, never a name — includeBeneficiaryNames
  // is deliberately left at its default false here). Same
  // null-means-not-found-or-not-theirs convention as
  // AssetsService.listForFounder.
  async summaryByCauseForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;
      return this.summaryByCause(waqfId, tx);
    });
  }
}
