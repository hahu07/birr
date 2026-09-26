import { randomUUID } from "crypto";
import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { IsEmail, IsEnum, IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma, ContributionProvider, IdType } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { MAX_PUBLIC_CONTRIBUTION_AMOUNT, MaxDecimal } from "../../common/validation/max-decimal";
import { PaymentProviderAdapter } from "../contributions/providers/payment-provider.interface";
import { StripeAdapter } from "../contributions/providers/stripe.adapter";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { StablecoinAdapter } from "../contributions/providers/stablecoin.adapter";
import { ResendVaultReceiptEmailAdapter } from "./email/resend-vault-receipt.adapter";
import { CASH_AND_BANK_ACCOUNT_CODE, DONATIONS_REVENUE_ACCOUNT_CODE, VaultLedgerService } from "./vault-ledger.service";
import { findVaultOrThrow } from "./find-vault-or-throw";

export class HoldVaultContributionInput {
  @IsString()
  reason!: string;
}

export class InitiateVaultContributionInput {
  @IsString()
  vaultId!: string;

  @IsOptional()
  @IsString()
  vaultCauseId?: string;

  // Unauthenticated, public route — MaxDecimal is a blunt sanity
  // ceiling against a malformed/malicious value, not a business rule
  // (found in a codebase audit: nothing previously bounded this at
  // all). See MaxDecimal's own comment.
  @IsNumberString()
  @MaxDecimal(MAX_PUBLIC_CONTRIBUTION_AMOUNT)
  amount!: string;

  @IsString()
  currency!: string;

  @IsEnum(ContributionProvider)
  provider!: ContributionProvider;

  // Optional, at the owner's explicit direction (2026-09-11) — accepting
  // the tradeoffs that come with it: no receipt possible, and no
  // identity thread for the AML anti-structuring check to match repeat
  // anonymous gifts against (see findOrCreateDonor's own comment).
  @IsOptional()
  @IsEmail()
  donorEmail?: string;

  @IsOptional()
  @IsString()
  donorFullName?: string;

  // Only actually required when the AML threshold check below triggers
  // — enforced programmatically in initiate(), not via @IsEnum/@IsString
  // here, since whether these are required at all depends on live data
  // (this donor's running total), not something a static DTO decorator
  // can express.
  @IsOptional()
  @IsEnum(IdType)
  idType?: IdType;

  @IsOptional()
  @IsString()
  idNumber?: string;
}

@Injectable()
export class VaultContributionsService {
  private readonly logger = new Logger(VaultContributionsService.name);
  private readonly adapters: Map<ContributionProvider, PaymentProviderAdapter>;

  constructor(
    private readonly encryption: EncryptionService,
    private readonly receiptEmail: ResendVaultReceiptEmailAdapter,
    private readonly ledger: VaultLedgerService,
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
   * Public, unauthenticated — there is no Founder/owner to check
   * ownership against (see schema.prisma's own top-of-section comment
   * on why Vault has no Founder at all). Structurally mirrors
   * ContributionsService.initiate(), minus the founder-session/ownership
   * checks that method has and this one categorically can't.
   *
   * ipAddress is never part of InitiateVaultContributionInput — like
   * FoundationDeed's own ipAddress, it's captured server-side by the
   * controller from the request itself, never client-supplied. Stored
   * purely for getStructuringReview's own ipClusters signal below; never
   * read here, never gates this call (see VaultContribution.ipAddress's
   * own schema comment on why).
   */
  async initiate(input: InitiateVaultContributionInput, ipAddress?: string) {
    const vault = await findVaultOrThrow(prisma, input.vaultId);
    if (vault.status !== "open") {
      throw new BadRequestException(`"${vault.name}" isn't currently open for contributions.`);
    }
    // Accepts the vault's primary currency or any of its
    // additionalCurrencies (2026-09-13) — everything downstream of this
    // check (minimum lookup, payment adapter selection, the AML
    // fraction-sum) already keys off input.currency directly, so no
    // other change was needed to let a contribution actually land in
    // one of the additional currencies once it passes here.
    const acceptedCurrencies = [vault.currency, ...vault.additionalCurrencies];
    if (!acceptedCurrencies.includes(input.currency)) {
      throw new BadRequestException(`This vault only accepts contributions in ${acceptedCurrencies.join(", ")}.`);
    }
    if (input.vaultCauseId) {
      const cause = await prisma.vaultCause.findFirst({
        where: { id: input.vaultCauseId, vaultId: input.vaultId, deletedAt: null },
      });
      if (!cause) throw new NotFoundException(`Cause "${input.vaultCauseId}" not found on this vault.`);
    }

    const adapter = this.adapters.get(input.provider);
    if (!adapter) throw new NotFoundException(`Unknown payment provider "${input.provider}".`);

    // Reuses ContributionMinimum as-is — genuinely shared payment infra
    // (keyed only by currency, no FK to Waqf/Contribution), not a
    // Founder-flow-specific rule.
    const minimum = await prisma.contributionMinimum.findUnique({ where: { currency: input.currency } });
    if (!minimum) {
      throw new BadRequestException(`No minimum contribution is configured for currency "${input.currency}".`);
    }
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lt(minimum.minAmount)) {
      throw new BadRequestException(
        `The minimum contribution for ${input.currency} is ${minimum.minAmount}. Please increase the amount.`,
      );
    }

    const donor = await this.findOrCreateDonor(input, amount);

    const id = randomUUID();
    const paymentResult = await adapter.createPayment({
      amount: input.amount,
      currency: input.currency,
      reference: id,
      payerEmail: input.donorEmail,
    });

    const contribution = await prisma.$transaction(async (tx) => {
      const contribution = await tx.vaultContribution.create({
        data: {
          id,
          vaultId: input.vaultId,
          vaultCauseId: input.vaultCauseId,
          donorId: donor?.id,
          amount: input.amount,
          currency: input.currency,
          provider: input.provider,
          providerReference: paymentResult.providerReference,
          status: "pending",
          ipAddress,
        },
      });
      await tx.auditLog.create({
        data: {
          vaultId: input.vaultId,
          actorType: "public_donor",
          actorDonorId: donor?.id,
          action: "vault_contribution.initiated",
          entityType: "VaultContribution",
          entityId: contribution.id,
          after: contribution as any,
        },
      });
      return contribution;
    });

    return { contribution, clientPayload: paymentResult.clientPayload };
  }

  /**
   * Find-or-create by email — the one identity thread a public donor
   * has, no account/login involved (see VaultDonor's own schema
   * comment). Also where the AML identity-capture requirement is
   * enforced, against every currency this donor has ever given in at
   * once, not just the one in front of us right now.
   *
   * VaultDonorThreshold is deliberately a per-currency table, not one
   * flat number, because ops set each currency's figure to its own
   * AML-equivalent ceiling — e.g. a stablecoin threshold an order of
   * magnitude lower than fiat, per seed-data.ts's own comment, since
   * that rail is harder to unwind after the fact. That means
   * `amount ÷ that currency's own threshold` is a real, comparable
   * fraction of "how much of this donor's compliance headroom did this
   * gift use up" — comparable *across* currencies with no live FX
   * conversion needed. Summing that fraction over every confirmed gift
   * this donor has made, in every currency, is what closes a gap a
   * single-currency running total leaves wide open: giving
   * just-under-threshold amounts in several different currencies would
   * otherwise never trip any one currency's own check, even though the
   * donor's real combined giving is well past what any of those
   * thresholds represents (found in a codebase audit). A single
   * oversized contribution, or several in the same currency, still
   * trip this the same way the old same-currency-only check did — this
   * is a strict generalization of it, not a separate rule.
   *
   * What this does NOT close, and what no code-only fix can: a donor
   * who gives a genuinely different email each time gets a genuinely
   * different VaultDonor identity each time, with its own zeroed
   * history — there is no account, session, or other identity signal
   * collected today to link two different emails as the same person.
   * Decided, 2026-09-15 (owner's explicit call): accepted as a residual
   * risk for v1 rather than closed here — covered by manual/off-platform
   * compliance review instead of a second identity signal or a flat
   * per-gift ID requirement. See CLAUDE.md's own dated note.
   *
   * Returns null when no email is given — donorEmail is optional (owner's
   * explicit direction, 2026-09-11), so a fully anonymous contribution is
   * allowed with no VaultDonor row at all. This is a real, accepted
   * tradeoff: an anonymous gift gets no receipt, AND skips this whole
   * check (there's no identity thread to accumulate a history against)
   * — a donor who omits their email can give any amount without ever
   * triggering identity capture. That's the cost of allowing anonymous
   * giving, not an oversight.
   */
  private async findOrCreateDonor(input: InitiateVaultContributionInput, amount: Prisma.Decimal) {
    if (!input.donorEmail) return null;

    const existing = await prisma.vaultDonor.findUnique({ where: { email: input.donorEmail } });
    const alreadyIdentified = existing?.idType != null;

    if (!alreadyIdentified) {
      const confirmed = existing
        ? await prisma.vaultContribution.findMany({
            where: { donorId: existing.id, status: "confirmed" },
            select: { amount: true, currency: true },
          })
        : [];
      const currencies = [...new Set([input.currency, ...confirmed.map((c) => c.currency)])];
      const thresholds = await prisma.vaultDonorThreshold.findMany({ where: { currency: { in: currencies } } });
      const thresholdByCurrency = new Map(thresholds.map((t) => [t.currency, t.thresholdAmount]));

      const fractionOf = (amt: Prisma.Decimal, currency: string): Prisma.Decimal => {
        const limit = thresholdByCurrency.get(currency);
        return limit && limit.gt(0) ? amt.div(limit) : new Prisma.Decimal(0);
      };

      const fractionUsed = confirmed.reduce(
        (sum, c) => sum.plus(fractionOf(c.amount, c.currency)),
        fractionOf(amount, input.currency),
      );

      if (fractionUsed.gte(1) && (!input.donorFullName || !input.idType || !input.idNumber)) {
        throw new BadRequestException(
          `Your giving to Birr — across this and any other currency — has reached a point where compliance requires your full name and an ID; please provide donorFullName, idType, and idNumber.`,
        );
      }
    }

    const idNumberEncrypted = input.idNumber ? this.encryption.encrypt(input.idNumber) : undefined;

    if (existing) {
      if (input.donorFullName || input.idType || idNumberEncrypted) {
        return prisma.vaultDonor.update({
          where: { id: existing.id },
          data: {
            fullName: input.donorFullName ?? existing.fullName,
            idType: input.idType ?? existing.idType,
            idNumberEncrypted: idNumberEncrypted ?? existing.idNumberEncrypted,
          },
        });
      }
      return existing;
    }

    return prisma.vaultDonor.create({
      data: {
        email: input.donorEmail,
        fullName: input.donorFullName,
        idType: input.idType,
        idNumberEncrypted,
      },
    });
  }

  /**
   * Called as a fallback from ContributionsController's own webhook
   * dispatch (see that controller's own comment on the multi-parser
   * chain this joins) — after the payout parser (paystack only) and the
   * Founder-flow ContributionsService.handleWebhook both return null
   * ("valid signature, but not a reference either of us recognizes").
   * Same "verify again, look up by reference, null means not mine"
   * contract as both of those, so the chain can keep falling through
   * correctly regardless of how many participants eventually join it.
   */
  async handleWebhook(provider: ContributionProvider, rawBody: Buffer, headers: Record<string, string | undefined>) {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new NotFoundException(`Unknown payment provider "${provider}".`);

    const result = await adapter.verifyAndParseWebhook(rawBody, headers);
    if (!result) {
      throw new UnauthorizedException("Invalid webhook signature.");
    }

    const contribution = await prisma.vaultContribution.findUnique({
      where: { providerReference: result.providerReference },
      include: { vault: true, vaultCause: true, donor: true },
    });
    if (!contribution) {
      // Genuinely not ours either — nothing left to try after this.
      return null;
    }
    if (contribution.status !== "pending") {
      return contribution;
    }

    if (result.status === "failed") {
      const failed = await prisma.$transaction(async (tx) => {
        const failed = await tx.vaultContribution.update({ where: { id: contribution.id }, data: { status: "failed" } });
        await tx.auditLog.create({
          data: {
            vaultId: contribution.vaultId,
            actorType: "public_donor",
            actorDonorId: contribution.donorId,
            action: "vault_contribution.failed",
            entityType: "VaultContribution",
            entityId: failed.id,
            before: contribution as any,
            after: failed as any,
          },
        });
        return failed;
      });
      return failed;
    }

    const confirmed = await prisma.$transaction(async (tx) => {
      const confirmed = await tx.vaultContribution.update({
        where: { id: contribution.id },
        data: {
          status: "confirmed",
          confirmedAt: new Date(),
          providerPaymentId: result.providerPaymentId ?? contribution.providerPaymentId,
        },
      });
      await tx.auditLog.create({
        data: {
          vaultId: contribution.vaultId,
          actorType: "public_donor",
          actorDonorId: contribution.donorId,
          action: "vault_contribution.confirmed",
          entityType: "VaultContribution",
          entityId: confirmed.id,
          before: contribution as any,
          after: confirmed as any,
        },
      });

      // Double-entry auto-post (2026-09-13) — Debit Cash & Bank, Credit
      // Donations Revenue, same transaction as the status flip so the
      // ledger and the contribution row can never disagree about
      // whether this money landed.
      const cashAndBank = await this.ledger.getAccountByCode(tx, CASH_AND_BANK_ACCOUNT_CODE);
      const donationsRevenue = await this.ledger.getAccountByCode(tx, DONATIONS_REVENUE_ACCOUNT_CODE);
      await this.ledger.post(tx, {
        vaultId: contribution.vaultId,
        description: `Contribution confirmed (${contribution.provider})`,
        currency: contribution.currency,
        source: "contribution",
        sourceId: confirmed.id,
        actorType: "system",
        lines: [
          { ledgerAccountId: cashAndBank.id, debit: confirmed.amount },
          { ledgerAccountId: donationsRevenue.id, credit: confirmed.amount },
        ],
      });

      return confirmed;
    });

    // No donor row at all means an anonymous contribution (donorEmail
    // was optional) — nowhere to send a receipt, an accepted tradeoff of
    // allowing anonymous giving (see findOrCreateDonor's own comment).
    if (contribution.donor) {
      // Deliberately NOT awaited — a payment provider's webhook response
      // time shouldn't depend on a Resend round-trip, same posture as
      // ContributionsService's own fire-and-forget notify calls.
      this.receiptEmail
        .sendReceipt({
          to: contribution.donor.email,
          vaultName: contribution.vault.name,
          causeName: contribution.vaultCause?.name,
          amount: contribution.amount.toString(),
          currency: contribution.currency,
          contributionId: contribution.id,
        })
        .catch((err) => {
          this.logger.error(
            `Failed to send receipt for vault contribution "${confirmed.id}":`,
            err instanceof Error ? err.stack : String(err),
          );
        });
    }

    return confirmed;
  }

  findById(id: string) {
    return prisma.vaultContribution.findUnique({ where: { id } });
  }

  // Ops Console's contributions table (VaultContributionsSection) only
  // ever needs an identifying label for the donor column — select the
  // exact fields apps/web/lib/ops-types.ts's VaultContribution.donor
  // declares, not the full row (which carries phone/country/
  // idNumberEncrypted — unnecessary to ship to the browser, encrypted
  // or not).
  listByVault(vaultId: string) {
    return prisma.vaultContribution.findMany({
      where: { vaultId },
      orderBy: { createdAt: "desc" },
      include: { donor: { select: { id: true, email: true, fullName: true } } },
    });
  }

  /**
   * The manual/off-platform review this file's own findOrCreateDonor
   * comment points to (see CLAUDE.md's dated note, 2026-09-15): the AML
   * threshold check only ever recognizes a donor by email, so someone
   * splitting one large gift across several emails never trips it
   * automatically. Rather than build (and risk over-trusting) an
   * automatic clustering heuristic, this surfaces the raw near-threshold
   * data — every confirmed contribution at or above `minFraction` of its
   * currency's threshold — grouped by vault+currency so a human can
   * actually spot "several different donors, each just under, to the
   * same vault, close together" for themselves. A currency with no
   * VaultDonorThreshold row is skipped entirely (nothing to be "near").
   *
   * minFraction defaults to 0.5 — half the threshold — deliberately
   * lower than the 1.0 the automatic check itself fires at, since this
   * is a human-reviewed list, not an enforcement gate; false positives
   * here cost a staff member a glance, not a blocked donor.
   */
  async getStructuringReview(minFraction = 0.5) {
    const ipClusters = await this.getIpClusters();

    const thresholds = await prisma.vaultDonorThreshold.findMany();
    const thresholdByCurrency = new Map(thresholds.map((t) => [t.currency, t.thresholdAmount]));
    if (thresholdByCurrency.size === 0) return { groups: [], ipClusters };

    const contributions = await prisma.vaultContribution.findMany({
      where: { status: "confirmed", currency: { in: [...thresholdByCurrency.keys()] } },
      include: { vault: { select: { id: true, name: true } }, donor: { select: { id: true, email: true, fullName: true, idType: true } } },
      orderBy: { createdAt: "desc" },
    });

    const nearThreshold = contributions
      .map((c) => {
        const limit = thresholdByCurrency.get(c.currency)!;
        const fraction = limit.gt(0) ? c.amount.div(limit).toNumber() : 0;
        return { contribution: c, fraction };
      })
      .filter((row) => row.fraction >= minFraction);

    const groupsByKey = new Map<string, typeof nearThreshold>();
    for (const row of nearThreshold) {
      const key = `${row.contribution.vaultId}:${row.contribution.currency}`;
      const group = groupsByKey.get(key) ?? [];
      group.push(row);
      groupsByKey.set(key, group);
    }

    const groups = [...groupsByKey.values()]
      .map((rows) => {
        const { vault, currency } = rows[0].contribution;
        // Anonymous (no donorId) contributions are the most evasive case
        // — each counted as its own "distinct" giver, same reasoning
        // findOrCreateDonor's own comment gives for why an anonymous
        // gift skips the automatic check entirely.
        const distinctDonorIds = new Set(rows.map((r) => r.contribution.donorId ?? r.contribution.id));
        return {
          vaultId: vault.id,
          vaultName: vault.name,
          currency,
          thresholdAmount: thresholdByCurrency.get(currency)!.toString(),
          distinctDonorCount: distinctDonorIds.size,
          contributions: rows
            .sort((a, b) => b.contribution.createdAt.getTime() - a.contribution.createdAt.getTime())
            .map((r) => ({
              id: r.contribution.id,
              donorId: r.contribution.donorId,
              donorEmail: r.contribution.donor?.email ?? null,
              donorFullName: r.contribution.donor?.fullName ?? null,
              donorIdCaptured: r.contribution.donor?.idType != null,
              amount: r.contribution.amount.toString(),
              fractionOfThreshold: r.fraction,
              createdAt: r.contribution.createdAt,
            })),
        };
      })
      // The whole point is spotting several different givers clustering
      // near the same threshold — a single donor legitimately giving
      // one large, ID-verified gift isn't a review candidate at all.
      .filter((group) => group.distinctDonorCount >= 2)
      .sort((a, b) => b.distinctDonorCount - a.distinctDonorCount);

    return { groups, ipClusters };
  }

  /**
   * The second, complementary signal getStructuringReview() surfaces
   * alongside near-threshold grouping — see VaultContribution.ipAddress's
   * own schema comment for the full reasoning. Deliberately a *different*
   * shape from the threshold groups above: it ignores amount entirely
   * (the "$9,999 five times under five different emails" scenario
   * CLAUDE.md's own note describes never gets near any one currency's
   * threshold at all) and instead looks for the one thing a rotating-email
   * donor can't easily rotate — the network they're giving from.
   *
   * donorId: { not: null } deliberately excludes fully anonymous gifts
   * (no email at all) — that's a separate, already-accepted tradeoff
   * (see findOrCreateDonor's own comment); this signal is specifically
   * about *different declared identities* sharing a network, which
   * anonymous giving has no identity to compare in the first place.
   *
   * Purely observational, same as the caller: never blocks anything,
   * only surfaced for a compliance officer's own judgment call, since an
   * IP alone is a signal (a household, office, or shared network/VPN can
   * legitimately produce this) and never proof by itself.
   */
  private async getIpClusters() {
    const contributions = await prisma.vaultContribution.findMany({
      where: { status: "confirmed", ipAddress: { not: null }, donorId: { not: null } },
      include: { vault: { select: { id: true, name: true } }, donor: { select: { id: true, email: true, fullName: true, idType: true } } },
      orderBy: { createdAt: "desc" },
    });

    const byIp = new Map<string, typeof contributions>();
    for (const c of contributions) {
      const list = byIp.get(c.ipAddress!) ?? [];
      list.push(c);
      byIp.set(c.ipAddress!, list);
    }

    return [...byIp.entries()]
      .map(([ipAddress, rows]) => {
        const distinctDonorIds = new Set(rows.map((r) => r.donorId));
        return {
          ipAddress,
          distinctDonorCount: distinctDonorIds.size,
          contributions: rows.map((r) => ({
            id: r.id,
            vaultId: r.vault.id,
            vaultName: r.vault.name,
            donorId: r.donorId,
            donorEmail: r.donor?.email ?? null,
            donorFullName: r.donor?.fullName ?? null,
            donorIdCaptured: r.donor?.idType != null,
            amount: r.amount.toString(),
            currency: r.currency,
            createdAt: r.createdAt,
          })),
        };
      })
      // Only a network shared across more than one distinct declared
      // identity is a review candidate — one donor giving several times
      // from their own device isn't itself a signal of anything.
      .filter((cluster) => cluster.distinctDonorCount >= 2)
      .sort((a, b) => b.distinctDonorCount - a.distinctDonorCount);
  }

  /**
   * Staff-only (compliance_officer, see the controller's own route
   * guard) — flags an already-confirmed contribution for review without
   * moving any money. Independent of status: a held contribution is
   * still "confirmed" underneath, just paused pending review. Plain
   * CRUD, not governed — same trust level as a Vault status transition
   * that doesn't touch money (see VaultsService.updateStatus), unlike
   * the actual refund below.
   */
  async hold(id: string, reason: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const contribution = await tx.vaultContribution.findFirst({ where: { id } });
      if (!contribution) throw new NotFoundException(`VaultContribution "${id}" not found.`);
      if (contribution.status !== "confirmed") {
        throw new BadRequestException(`Only a confirmed contribution can be held (this one is "${contribution.status}").`);
      }
      if (contribution.heldAt) {
        throw new BadRequestException("This contribution is already held.");
      }

      const held = await tx.vaultContribution.update({ where: { id }, data: { heldAt: new Date(), heldReason: reason } });
      await tx.auditLog.create({
        data: {
          vaultId: contribution.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_contribution.held",
          entityType: "VaultContribution",
          entityId: id,
          before: contribution as any,
          after: held as any,
        },
      });
      return held;
    });
  }

  /** Reverses hold() — same trust level, same reasoning. */
  async release(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const contribution = await tx.vaultContribution.findFirst({ where: { id } });
      if (!contribution) throw new NotFoundException(`VaultContribution "${id}" not found.`);
      if (!contribution.heldAt) {
        throw new BadRequestException("This contribution isn't currently held.");
      }

      const released = await tx.vaultContribution.update({ where: { id }, data: { heldAt: null, heldReason: null } });
      await tx.auditLog.create({
        data: {
          vaultId: contribution.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_contribution.hold_released",
          entityType: "VaultContribution",
          entityId: id,
          before: contribution as any,
          after: released as any,
        },
      });
      return released;
    });
  }

  /**
   * Internal only — never exposed behind a public controller route.
   * vault.contribution_refund is a governed action; the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. Only records the decision here — the real external
   * refund call happens separately in initiateRefund() below, fired
   * fire-and-forget after this transaction commits, same "approve
   * records the decision, a later step does the actual money movement"
   * split as VaultDistributionsService.approve()/initiateDisbursement().
   */
  async requestRefund(id: string, tx: Prisma.TransactionClient) {
    const contribution = await tx.vaultContribution.findFirst({ where: { id } });
    if (!contribution) throw new NotFoundException(`VaultContribution "${id}" not found.`);
    if (contribution.status !== "confirmed") {
      throw new BadRequestException(`Only a confirmed contribution can be refunded (this one is "${contribution.status}").`);
    }
    if (contribution.refundStatus) {
      throw new BadRequestException(`A refund has already been ${contribution.refundStatus} for this contribution.`);
    }

    return tx.vaultContribution.update({ where: { id }, data: { refundStatus: "requested" } });
  }

  /**
   * Fire-and-forget follow-up from GovernedActionsService, same shape as
   * VaultDistributionsService.initiateDisbursement — an atomic claim
   * (requested -> processing) before the real external call, so a retry
   * or a race can't fire the same refund twice. Never throws past its
   * own boundary; a real failure is caught and recorded as
   * refundStatus: "failed" internally, same posture as that method.
   *
   * Not every rail can reverse a payment automatically — adapter.refund
   * is optional (StablecoinAdapter has none, see its own comment on why
   * a crypto payment has no reversible API call this platform can
   * invoke, and never even collects the payer's wallet address to send
   * funds back to). For those, this still records the contribution as
   * refunded with a null refundReference: the actual money movement is
   * understood to happen manually, off-platform, and the point of this
   * workflow is giving staff an auditable in-system record of that
   * decision, not that every rail can be reversed by an API call.
   */
  async initiateRefund(id: string): Promise<void> {
    const contribution = await prisma.vaultContribution.findUnique({ where: { id } });
    if (!contribution || contribution.refundStatus !== "requested") return;

    const claim = await prisma.vaultContribution.updateMany({
      where: { id, refundStatus: "requested" },
      data: { refundStatus: "processing" },
    });
    if (claim.count !== 1) return;

    const adapter = this.adapters.get(contribution.provider);
    try {
      let refundReference: string | null = null;
      if (adapter?.refund) {
        const result = await adapter.refund({
          providerReference: contribution.providerReference,
          providerPaymentId: contribution.providerPaymentId,
          amount: contribution.amount.toString(),
          currency: contribution.currency,
        });
        refundReference = result.refundReference;
      }

      const refunded = await prisma.vaultContribution.update({
        where: { id },
        data: { refundStatus: "refunded", refundedAt: new Date(), refundReference },
      });
      await prisma.auditLog.create({
        data: {
          vaultId: contribution.vaultId,
          actorType: "system",
          action: "vault_contribution.refunded",
          entityType: "VaultContribution",
          entityId: id,
          before: contribution as any,
          after: refunded as any,
        },
      });
    } catch (err) {
      const failed = await prisma.vaultContribution.update({
        where: { id },
        data: { refundStatus: "failed", refundFailedReason: err instanceof Error ? err.message : String(err) },
      });
      await prisma.auditLog.create({
        data: {
          vaultId: contribution.vaultId,
          actorType: "system",
          action: "vault_contribution.refund_failed",
          entityType: "VaultContribution",
          entityId: id,
          before: contribution as any,
          after: failed as any,
        },
      });
    }
  }
}
