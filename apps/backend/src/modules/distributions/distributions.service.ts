import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsNotEmpty, IsNumberString, IsString } from "class-validator";
import { prisma, Prisma, PayoutProvider } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { NotificationsService } from "../notifications/notifications.service";
import { resolveFounderRecipientUserIdsForWaqf } from "../../common/notifications/resolve-founder-recipients";
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
  private readonly payoutAdapters: Map<PayoutProvider, PayoutProviderAdapter>;

  constructor(
    private readonly beneficiariesService: BeneficiariesService,
    private readonly notificationsService: NotificationsService,
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
    const cause = await prisma.waqfCause.findUnique({ where: { id: input.causeId } });
    if (!cause || cause.waqfId !== input.waqfId) {
      throw new BadRequestException(
        `Cause "${input.causeId}" does not belong to waqf "${input.waqfId}".`,
      );
    }
    return prisma.$transaction(async (tx) => {
      await this.assertBeneficiaryEligible(input.waqfId, input.beneficiaryId, tx);
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
   * transaction. On a governed-action *rejection*, no fulfillment runs
   * at all (the handler map is only invoked when the checker approves —
   * same as every other entity), so a rejected distribution simply stays
   * at `pending`.
   */
  async approve(id: string, tx: Prisma.TransactionClient) {
    const distribution = await tx.distribution.findUnique({ where: { id } });
    if (!distribution) throw new NotFoundException(`Distribution "${id}" not found.`);
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
    await this.assertBeneficiaryEligible(distribution.waqfId, distribution.beneficiaryId, tx);
    await this.assertWithinAllocation(distribution.causeId, distribution.amount, distribution.currency, tx, id);
    return tx.distribution.update({
      where: { id },
      data: { status: "approved", approvedAt: new Date() },
    });
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
   * back to "approved". Idempotency guard: only ever acts when the
   * distribution's status is exactly "approved" — retryDisbursement
   * flips payout_failed -> approved transactionally before calling this,
   * so this method only ever needs the one precondition. Never throws
   * past its own boundary — every real failure (a network error, a
   * Paystack-side rejection) is caught and recorded as payout_failed,
   * so callers only need to handle genuinely unexpected errors (e.g. a
   * DB blip on the initial lookup).
   *
   * Not $transaction-wrapped: the HTTP call sits between the two
   * possible outcomes, so status-write and audit-write happen as two
   * separate statements, deliberately status-then-audit — on a crash
   * between them, the worst case is "state changed, audit missing"
   * (recoverable by inspection), not the reverse.
   */
  async initiateDisbursement(distributionId: string): Promise<void> {
    const distribution = await prisma.distribution.findUnique({ where: { id: distributionId } });
    if (!distribution || distribution.status !== "approved") return;

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
        data: { status: "disbursing", payoutProvider: "paystack", payoutReference: result.providerReference },
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
      const updated = await tx.distribution.update({
        where: { id: distributionId },
        data: { status: "approved", payoutError: null },
      });
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
      return updated;
    });

    // Fire-and-forget, mirroring notifyDecision's / ContributionsService
    // .notifyContributionOutcome's own posture — a webhook's response
    // time shouldn't depend on Resend/Twilio round-trips.
    this.notifyPayoutOutcome(distribution.waqfId, result.status, updated).catch((err) => {
      console.error(`Failed to notify on payout outcome for distribution "${updated.id}":`, err);
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
   */
  private async assertBeneficiaryEligible(
    waqfId: string,
    beneficiaryId: string,
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
  }

  /**
   * A cause with nothing allocated in either pool can't be distributed
   * from yet — this is what gives WaqfCausesService.allocate() (Founder
   * self-service, corpus-based) and .allocateProceeds() (Birr staff,
   * investment-proceeds-based) real teeth instead of being decorative
   * numbers. The two pools are summed here as one combined ceiling —
   * they're tracked separately at the WaqfCause level (corpus vs.
   * income stays a meaningful distinction, see each method's own
   * comment) but a Distribution itself doesn't care which pool its
   * money notionally came from. Counts pending/approved/disbursing/paid
   * distributions as "committed" (a pending one is already a real claim
   * on the allocation, not yet-moved money notwithstanding) —
   * deliberately EXCLUDES payout_failed: a failed payout never actually
   * moved money and releases its claim on the cause's ceiling, so a
   * fresh distribution (or a retryDisbursement re-check) against the
   * same cause isn't blocked by money that never left. Excludes
   * `excludeDistributionId` so approve()'s/retryDisbursement's re-checks
   * don't double-count the row being (re-)confirmed against itself.
   *
   * Scoped to `currency` — WaqfCause.allocatedAmount/proceedsAllocatedAmount
   * carry no currency of their own (a pre-existing schema gap, not fixed
   * here), so this treats the ceiling as denominated in whichever
   * currency the cause's *first* committed distribution used, and
   * locks every later distribution against the same cause to that same
   * currency (2026-08-30 security audit fix — see
   * docs/comprehensive-code-review-prompt.md). Deliberately NOT just
   * "sum same-currency commitments and ignore other currencies" —
   * that alone would let every distinct currency independently reach
   * the full ceiling against one cause (e.g. 100 NGN *and* 100 USD
   * *and* 100 GBP all committed against a single allocatedAmount: 100
   * cause), which is a different but equally real bypass of the ceiling
   * CLAUDE.md calls "a real enforced ceiling, not a decorative figure."
   * Locking to one currency per cause matches the implicit
   * single-currency assumption already used throughout this codebase
   * (e.g. summaryByCause's own comment on why mixing currencies is
   * meaningless) without requiring an exchange-rate conversion, which
   * is out of scope for this fix.
   */
  private async assertWithinAllocation(
    causeId: string,
    additionalAmount: Prisma.Decimal,
    currency: string,
    tx: Prisma.TransactionClient,
    excludeDistributionId?: string,
  ): Promise<void> {
    const cause = await tx.waqfCause.findUnique({ where: { id: causeId } });
    const allocated = new Prisma.Decimal(cause?.allocatedAmount ?? 0).plus(cause?.proceedsAllocatedAmount ?? 0);

    const committedWhere: Prisma.DistributionWhereInput = {
      causeId,
      deletedAt: null,
      status: { in: ["pending", "approved", "disbursing", "paid"] },
      ...(excludeDistributionId ? { id: { not: excludeDistributionId } } : {}),
    };

    const otherCurrencyCommitment = await tx.distribution.findFirst({
      where: { ...committedWhere, currency: { not: currency } },
      select: { currency: true },
    });
    if (otherCurrencyCommitment) {
      throw new BadRequestException(
        `This cause already has committed distributions in ${otherCurrencyCommitment.currency} — a distribution against the same cause can't switch to ${currency} without first resolving the earlier ones.`,
      );
    }

    const committed = await tx.distribution.aggregate({
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
  async founderSummary(
    founderId: string,
  ): Promise<{ waqfType: string; currency: string; totalAmount: Prisma.Decimal }[]> {
    const rows = await prisma.distribution.findMany({
      where: {
        status: "paid",
        deletedAt: null,
        waqf: { foundation: { foundationFounders: { some: { founderId } } } },
      },
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
