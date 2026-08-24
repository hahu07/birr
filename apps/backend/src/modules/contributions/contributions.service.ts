import { randomUUID } from "crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { prisma, Prisma, ContributionProvider } from "@birr/db";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { AssetsService } from "../assets/assets.service";
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

    const waqf = await prisma.waqf.findFirst({
      where: { id: input.waqfId, foundation: { foundationFounders: { some: { founderId: input.founderId } } } },
    });
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
    if (new Prisma.Decimal(input.amount).lt(minimum.minAmount)) {
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

    const contribution = await prisma.contribution.create({
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
      return prisma.contribution.update({ where: { id: contribution.id }, data: { status: "failed" } });
    }

    return prisma.$transaction(async (tx) => {
      const asset = await this.assetsService.create(
        {
          waqfId: contribution.waqfId,
          name: "Initial contribution",
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
      // nothing has been dedicated to it yet.
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

      return confirmed;
    });
  }

  findById(id: string) {
    return prisma.contribution.findUnique({ where: { id } });
  }
}
