import { randomUUID } from "crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { prisma, Prisma, ContributionProvider } from "@birr/db";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { withFounderScope } from "../../common/db/founder-scope";
import { AssetsService } from "../assets/assets.service";
import { NotificationsService } from "../notifications/notifications.service";
import { resolveFounderRecipientUserIdsForWaqf } from "../../common/notifications/resolve-founder-recipients";
import { PaymentProviderAdapter } from "./providers/payment-provider.interface";
import { StripeAdapter } from "./providers/stripe.adapter";
import { PaystackAdapter } from "./providers/paystack.adapter";
import { StablecoinAdapter } from "./providers/stablecoin.adapter";

export interface InitiateContributionInput {
  waqfId: string;
  amount: string;
  currency: string;
  provider: ContributionProvider;
  founderId: string;
  payerEmail?: string;
}

@Injectable()
export class ContributionsService {
  private readonly adapters: Map<ContributionProvider, PaymentProviderAdapter>;

  constructor(
    private readonly assetsService: AssetsService,
    private readonly notificationsService: NotificationsService,
    stripeAdapter: StripeAdapter,
    paystackAdapter: PaystackAdapter,
    stablecoinAdapter: StablecoinAdapter,
  ) {
    this.adapters = new Map<ContributionProvider, PaymentProviderAdapter>([
      ["stripe", stripeAdapter],
      ["paystack", paystackAdapter],
      ["stablecoin", stablecoinAdapter],
    ]);
  }

  /**
   * Real payment processing, not a staff-reconciled pledge — the
   * donor's declared contribution toward a Waqf Fund they've just
   * created (or an existing one of theirs). Ownership-checked the same
   * way as WaqfsService.createSelfService: the waqf must actually
   * belong to the calling founder via the foundationFounders join.
   *
   * Confirmation is async (webhook-driven, see handleWebhook below) —
   * this only ever returns a `pending` row plus whatever the frontend
   * needs to complete payment (a checkout URL for all three
   * providers today, see each adapter's own comment on why).
   */
  async initiate(input: InitiateContributionInput) {
    // Closes a gap this method previously had: unlike
    // WaqfsService.createSelfService()/FoundationsService.create(), this
    // never checked onboarding step 1 (email + WhatsApp verification) at
    // all until now.
    await assertFounderVerified(prisma, input.founderId);

    // Routed through withFounderScope (2026-08-31 codebase audit finding)
    // — the ownership check below was already correct on its own, but
    // without the RLS session var set, founder_isolation was a silent
    // no-op on this read, leaving only one of the two independent
    // enforcement layers CLAUDE.md calls for actually engaged.
    const waqf = await withFounderScope(input.founderId, (tx) =>
      tx.waqf.findFirst({
        where: { id: input.waqfId, foundation: { foundationFounders: { some: { founderId: input.founderId } } } },
      }),
    );
    if (!waqf) {
      throw new ForbiddenException("This waqf fund doesn't belong to you.");
    }

    const adapter = this.adapters.get(input.provider);
    if (!adapter) {
      throw new NotFoundException(`Unknown payment provider "${input.provider}".`);
    }

    const minimum = await prisma.contributionMinimum.findUnique({ where: { currency: input.currency } });
    if (!minimum) {
      throw new BadRequestException(`No minimum contribution is configured for currency "${input.currency}".`);
    }

    // The corpus (and every contribution toward it) is only meaningful in
    // the currency it was declared in — comparing amounts across
    // currencies would mean comparing raw numbers with no FX conversion,
    // silently wrong either way it could go, and `WaqfsService`'s
    // amountRaised sum assumes every confirmed Contribution shares this
    // one currency. Checked on every contribution, not just the first —
    // a prior version of this check only ran when confirmedCount === 0,
    // so a second/later top-up in a different currency slipped through
    // unchecked and blended into amountRaised.
    if (waqf.corpusCurrency && input.currency !== waqf.corpusCurrency) {
      throw new BadRequestException(
        `This waqf's corpus was declared in ${waqf.corpusCurrency} — contributions must be made in the same currency.`,
      );
    }

    // A waqf's very first payment is floored by a percentage of its
    // declared corpus — 100% for a lump-sum plan ("pay it all now" is
    // the whole point — a partial first payment would leave a lump-sum
    // waqf permanently underfunded, since there's no "top up the rest"
    // step for that plan the way installment has), or the
    // admin-configured percentage for an installment plan. This
    // percentage floor is authoritative on its own for that one
    // payment — it does NOT additionally have to clear the platform's
    // general flat per-payment minimum (ContributionMinimum) too: a
    // founder who declared a smaller corpus should be able to make a
    // genuinely proportional first payment (e.g. exactly 25% of it),
    // not a larger one inflated by an unrelated flat floor that exists
    // to filter out trivial payments in general, not to second-guess a
    // percentage the founder's own declared corpus already determines.
    // The flat minimum still applies to every other payment (top-ups,
    // or any contribution to a waqf with no declared corpus at all).
    // Judged by "no confirmed contribution yet", not "no contribution
    // row at all", so a retry after a failed/abandoned first attempt
    // doesn't get treated as a second (unconstrained) payment.
    let firstPaymentFloor: Prisma.Decimal | null = null;
    let firstPaymentPercent: Prisma.Decimal | null = null;
    if (waqf.corpusAmount) {
      const confirmedCount = await prisma.contribution.count({
        where: { waqfId: input.waqfId, status: "confirmed" },
      });
      if (confirmedCount === 0) {
        if (waqf.fundingPlan === "lump_sum") {
          firstPaymentPercent = new Prisma.Decimal(100);
        } else {
          const settings = await prisma.waqfFundingSettings.findFirst();
          firstPaymentPercent = settings?.installmentMinimumPercent ?? new Prisma.Decimal(25);
        }
        firstPaymentFloor = new Prisma.Decimal(waqf.corpusAmount).mul(firstPaymentPercent).div(100);
      }
    }

    const amount = new Prisma.Decimal(input.amount);
    if (firstPaymentFloor) {
      if (amount.lt(firstPaymentFloor)) {
        throw new BadRequestException(
          waqf.fundingPlan === "lump_sum"
            ? `A lump-sum waqf's first payment must cover the full declared corpus (${firstPaymentFloor} ${input.currency}).`
            : `An installment plan's first payment must be at least ${firstPaymentPercent}% of the declared corpus (${firstPaymentFloor} ${input.currency}).`,
        );
      }
    } else if (amount.lt(minimum.minAmount)) {
      throw new BadRequestException(
        `The minimum contribution for ${input.currency} is ${minimum.minAmount}. Please increase the amount.`,
      );
    }

    // Generated up front (not left to Prisma's default) so it can be
    // handed to the provider as the correlation reference before the
    // Contribution row exists — every adapter is designed to echo this
    // exact value back in its webhook payload (see each adapter's own
    // comment), so providerReference below is always this same id.
    const id = randomUUID();
    const paymentResult = await adapter.createPayment({
      amount: input.amount,
      currency: input.currency,
      reference: id,
      payerEmail: input.payerEmail,
    });

    // Audited in the same transaction as every other governed-entity
    // create() in this codebase — a prior version created this row
    // standalone with no audit_logs entry at all. The external
    // createPayment() call above stays outside the transaction
    // deliberately (a DB transaction shouldn't hold locks across a
    // network round-trip to a payment provider). Routed through
    // withFounderScope for the same RLS reason as the ownership check
    // above.
    const contribution = await withFounderScope(input.founderId, async (tx) => {
      const contribution = await tx.contribution.create({
        data: {
          id,
          waqfId: input.waqfId,
          amount: input.amount,
          currency: input.currency,
          provider: input.provider,
          providerReference: paymentResult.providerReference,
          status: "pending",
        },
      });
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "founder_user",
          actorFounderId: input.founderId,
          action: "contribution.initiated",
          entityType: "Contribution",
          entityId: contribution.id,
          after: contribution as any,
        },
      });
      return contribution;
    });

    return { contribution, clientPayload: paymentResult.clientPayload };
  }

  /**
   * Called from the three webhook routes in
   * ContributionsController — never founder-session-authenticated, so
   * signature verification (inside the adapter) is the entire security
   * boundary. An invalid signature must be rejected outright (401)
   * before any state changes, not silently ignored.
   */
  async handleWebhook(provider: ContributionProvider, rawBody: Buffer, headers: Record<string, string | undefined>) {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new NotFoundException(`Unknown payment provider "${provider}".`);
    }

    const result = await adapter.verifyAndParseWebhook(rawBody, headers);
    if (!result) {
      throw new UnauthorizedException("Invalid webhook signature.");
    }

    const contribution = await prisma.contribution.findUnique({
      where: { providerReference: result.providerReference },
    });
    if (!contribution) {
      // A verified-but-unrecognized reference is odd but not a security
      // issue (the signature already proved the event is genuinely from
      // the provider) — likely a stale/replayed webhook for a
      // contribution that was somehow never created. Nothing to do.
      return null;
    }
    if (contribution.status !== "pending") {
      // Already processed (webhooks can legitimately be retried by the
      // provider) — idempotent no-op, not an error.
      return contribution;
    }

    if (result.status === "failed") {
      // Transactional + audited, same as the confirmed path below — a
      // prior version of this left a declined/reversed payment with zero
      // audit trail of when or why it failed, so a disputed payment ("I
      // have a bank receipt showing this cleared") had nothing to
      // reconcile against but the current row state.
      const failed = await prisma.$transaction(async (tx) => {
        const failed = await tx.contribution.update({ where: { id: contribution.id }, data: { status: "failed" } });
        await tx.auditLog.create({
          data: {
            waqfId: contribution.waqfId,
            actorType: "system",
            action: "contribution.failed",
            entityType: "Contribution",
            entityId: failed.id,
            before: contribution as any,
            after: failed as any,
          },
        });
        return failed;
      });
      this.notifyContributionOutcome(contribution.waqfId, "failed", failed).catch((err) => {
        console.error(`Failed to notify on failed contribution "${failed.id}":`, err);
      });
      return failed;
    }

    const { confirmed, waqfActivated } = await prisma.$transaction(async (tx) => {
      // Every previously-confirmed contribution before this one — 0 means
      // this is genuinely the first money in, anything else means it's a
      // later installment payment or a voluntary top-up. Was hardcoded to
      // always say "Initial contribution" regardless of which one this
      // was; fixed so the Asset trail actually reflects what happened.
      const priorConfirmedCount = await tx.contribution.count({
        where: { waqfId: contribution.waqfId, status: "confirmed" },
      });
      const asset = await this.assetsService.create(
        {
          waqfId: contribution.waqfId,
          name: priorConfirmedCount === 0 ? "Initial contribution" : "Corpus top-up",
          category: "cash",
          estimatedValue: contribution.amount,
        },
        { actorType: "system" },
        tx,
      );

      const confirmed = await tx.contribution.update({
        where: { id: contribution.id },
        data: { status: "confirmed", confirmedAt: new Date(), assetId: asset.id },
      });

      // The first confirmed contribution is what actually activates a
      // Waqf Fund — it stays draft at creation time precisely because
      // nothing has been dedicated to it yet. Checked here (before the
      // unconditional update below) specifically so the notification
      // fired after commit can tell "just activated" apart from "already
      // active, this is a later contribution" — the update itself
      // doesn't distinguish the two.
      const waqfBefore = await tx.waqf.findUnique({ where: { id: contribution.waqfId }, select: { status: true } });
      await tx.waqf.update({ where: { id: contribution.waqfId }, data: { status: "active" } });

      await tx.auditLog.create({
        data: {
          waqfId: contribution.waqfId,
          actorType: "system",
          action: "contribution.confirmed",
          entityType: "Contribution",
          entityId: confirmed.id,
          before: contribution as any,
          after: confirmed as any,
        },
      });

      return { confirmed, waqfActivated: waqfBefore?.status === "draft" };
    });

    this.notifyContributionOutcome(contribution.waqfId, "confirmed", confirmed).catch((err) => {
      console.error(`Failed to notify on confirmed contribution "${confirmed.id}":`, err);
    });
    if (waqfActivated) {
      this.notifyWaqfActivated(contribution.waqfId).catch((err) => {
        console.error(`Failed to notify on waqf activation for waqf "${contribution.waqfId}":`, err);
      });
    }

    return confirmed;
  }

  // Deliberately NOT awaited by handleWebhook — a payment provider's
  // webhook response time shouldn't depend on Resend/Twilio round-trips,
  // same posture as GovernedActionsService's fire-and-forget notify calls.
  private async notifyContributionOutcome(
    waqfId: string,
    outcome: "confirmed" | "failed",
    contribution: { id: string; amount: string | Prisma.Decimal; currency: string },
  ): Promise<void> {
    const recipientUserIds = await resolveFounderRecipientUserIdsForWaqf(waqfId);
    const type = outcome === "confirmed" ? "contribution.confirmed" : "contribution.failed";
    const title = outcome === "confirmed" ? "Contribution confirmed" : "Contribution failed";
    const body =
      outcome === "confirmed"
        ? `Your contribution of ${contribution.currency} ${contribution.amount} was confirmed.`
        : `Your contribution of ${contribution.currency} ${contribution.amount} could not be processed. Please try again.`;
    await Promise.all(
      recipientUserIds.map((userId) =>
        this.notificationsService.notify({
          recipientType: "founder_user",
          recipientUserId: userId,
          type,
          title,
          body,
          linkUrl: `/portfolio/${waqfId}`,
          relatedEntityType: "Contribution",
          relatedEntityId: contribution.id,
        }),
      ),
    );
  }

  private async notifyWaqfActivated(waqfId: string): Promise<void> {
    const waqf = await prisma.waqf.findUnique({ where: { id: waqfId }, select: { name: true } });
    if (!waqf) return;
    const recipientUserIds = await resolveFounderRecipientUserIdsForWaqf(waqfId);
    await Promise.all(
      recipientUserIds.map((userId) =>
        this.notificationsService.notify({
          recipientType: "founder_user",
          recipientUserId: userId,
          type: "waqf.activated",
          title: `${waqf.name} is now active`,
          body: `${waqf.name} has received its first contribution and is now an active Waqf Fund.`,
          linkUrl: `/portfolio/${waqfId}`,
          relatedEntityType: "Waqf",
          relatedEntityId: waqfId,
        }),
      ),
    );
  }

  findById(id: string) {
    return prisma.contribution.findUnique({ where: { id } });
  }

  // Founder-Portal read — the contribution history + running total the
  // new funding-progress UI needs. Ownership-checked the same way as
  // initiate(): the waqf must actually belong to the calling founder via
  // the foundationFounders join. Returns null (not throw) when the waqf
  // isn't found or isn't theirs — same indistinguishable-from-404
  // convention as every other founder-scoped read in this codebase.
  // Routed through withFounderScope (2026-08-31 codebase audit finding)
  // — the ownership check below was already correct on its own, but
  // without the RLS session var set, founder_isolation was a silent
  // no-op on this read.
  async listForWaqf(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;
      return tx.contribution.findMany({ where: { waqfId }, orderBy: { createdAt: "desc" } });
    });
  }

  // Ops Console — Birr staff need to see the actual payment record
  // behind a waqf's funding progress for oversight/audit, same as they
  // can for Assets/Beneficiaries/Distributions on this same waqf. No
  // ownership scoping (unlike listForWaqf above) — any active BirrStaff
  // may view any waqf's contributions, matching AssetsService.list()'s
  // own unscoped posture for its staff-facing counterpart.
  list(waqfId?: string) {
    return prisma.contribution.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  // Platform-wide total raised, for the Ops Console's own landing-page
  // overview (see apps/web/app/ops/page.tsx's PlatformOverview) —
  // across every waqf, not one. Only "confirmed" counts as actually
  // raised (a pending contribution hasn't cleared yet, a failed one
  // never will) — same "only count money that's actually moved"
  // posture as DistributionsService.summaryByCause's own "paid" filter.
  // Grouped by currency, never blended — same reasoning as
  // Distribution.currency's own schema comment.
  async platformSummary(): Promise<{ currency: string; totalAmount: Prisma.Decimal }[]> {
    const grouped = await prisma.contribution.groupBy({
      by: ["currency"],
      where: { status: "confirmed" },
      _sum: { amount: true },
    });
    return grouped.map((g) => ({ currency: g.currency, totalAmount: g._sum.amount ?? new Prisma.Decimal(0) }));
  }

  // Founder-scoped counterpart to platformSummary() above, for the
  // Founder Portal's own Overview page — confirmed-only total raised
  // across every waqf this founder has established (via the same
  // foundationFounders join listForWaqf() uses), grouped by currency.
  // Routed through withFounderScope — see listForWaqf's own comment on
  // this same fix (2026-08-31 codebase audit finding).
  async founderSummary(founderId: string): Promise<{ currency: string; totalAmount: Prisma.Decimal }[]> {
    const grouped = await withFounderScope(founderId, (tx) =>
      tx.contribution.groupBy({
        by: ["currency"],
        where: { status: "confirmed", waqf: { foundation: { foundationFounders: { some: { founderId } } } } },
        _sum: { amount: true },
      }),
    );
    return grouped.map((g) => ({ currency: g.currency, totalAmount: g._sum.amount ?? new Prisma.Decimal(0) }));
  }
}
