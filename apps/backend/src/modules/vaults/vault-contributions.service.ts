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
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";

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
  @IsPositiveDecimal()
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

// A pending gift still counts toward a donor's ID threshold for this long —
// comfortably past any provider's checkout expiry, so an abandoned checkout
// stops counting eventually instead of forever.
const PENDING_COUNTS_TOWARD_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// Emails are the donor's only identity thread, so "Donor@X.com" and
// "donor@x.com" must not become two donors with separate thresholds.
function normalizeEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function normalizeIdNumber(idNumber: string): string {
  return idNumber.replace(/[\s-]/g, "").toUpperCase();
}

// Never write the (encrypted) ID number into the audit trail — only that one exists.
function donorAuditSnapshot<T extends { idNumberEncrypted: string | null }>(donor: T) {
  const { idNumberEncrypted, ...rest } = donor;
  return { ...rest, idNumberOnFile: idNumberEncrypted != null };
}

@Injectable()
export class VaultContributionsService {
  private readonly logger = new Logger(VaultContributionsService.name);
  private readonly adapters: Map<ContributionProvider, PaymentProviderAdapter>;

  constructor(
    private readonly encryption: EncryptionService,
    private readonly receiptEmail: ResendVaultReceiptEmailAdapter,
    private readonly ledger: VaultLedgerService,
    private readonly funnelEvents: FunnelEventsService,
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

    const donorEmail = normalizeEmail(input.donorEmail);
    const id = randomUUID();

    // Reserve the row BEFORE calling the payment provider, under a
    // per-email lock: the threshold check below counts this donor's
    // recent pending gifts, so two gifts started in parallel under the
    // same email now see each other instead of each passing alone. The
    // provider's own reference isn't known yet — our id stands in until
    // createPayment() returns (no webhook can arrive before the donor has
    // even reached checkout).
    const { contribution, donor } = await prisma.$transaction(async (tx) => {
      if (donorEmail) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${donorEmail}))`;
      }
      const donor = donorEmail ? await this.findOrCreateDonor(tx, donorEmail, input, amount) : null;
      const contribution = await tx.vaultContribution.create({
        data: {
          id,
          vaultId: input.vaultId,
          vaultCauseId: input.vaultCauseId,
          donorId: donor?.id,
          amount: input.amount,
          currency: input.currency,
          provider: input.provider,
          providerReference: id,
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
      return { contribution, donor };
    });

    // Best-effort — record() never throws. sessionId falls back to the
    // contribution's own id for an anonymous gift (donorEmail is
    // optional) — there's no other stable per-giver handle at all in
    // that case.
    void this.funnelEvents.record({
      funnel: "vault",
      step: "contribution_initiated",
      sessionId: donor?.id ?? contribution.id,
      vaultId: input.vaultId,
      metadata: { currency: input.currency, provider: input.provider },
    });

    let paymentResult;
    try {
      paymentResult = await adapter.createPayment({
        amount: input.amount,
        currency: input.currency,
        reference: id,
        payerEmail: donorEmail,
        returnPath: "vault-contributions",
      });
    } catch (err) {
      // The reservation must not linger as "pending" and keep counting
      // toward this donor's threshold for a payment that never started.
      await prisma.$transaction(async (tx) => {
        const failed = await tx.vaultContribution.update({ where: { id }, data: { status: "failed" } });
        await tx.auditLog.create({
          data: {
            vaultId: input.vaultId,
            actorType: "public_donor",
            actorDonorId: donor?.id,
            action: "vault_contribution.failed",
            entityType: "VaultContribution",
            entityId: id,
            before: contribution as any,
            after: failed as any,
          },
        });
      });
      throw err;
    }

    if (paymentResult.providerReference === id) {
      return { contribution, clientPayload: paymentResult.clientPayload };
    }
    const withReference = await prisma.$transaction(async (tx) => {
      const updated = await tx.vaultContribution.update({
        where: { id },
        data: { providerReference: paymentResult.providerReference },
      });
      await tx.auditLog.create({
        data: {
          vaultId: input.vaultId,
          actorType: "public_donor",
          actorDonorId: donor?.id,
          action: "vault_contribution.payment_created",
          entityType: "VaultContribution",
          entityId: id,
          before: contribution as any,
          after: updated as any,
        },
      });
      return updated;
    });
    return { contribution: withReference, clientPayload: paymentResult.clientPayload };
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
  //
  // 2026-09-29 hardening, three changes:
  // - Recent *pending* gifts count toward the fraction, not just confirmed
  //   ones — otherwise several just-under-threshold gifts started before
  //   any confirms all pass (initiate() serializes same-email calls so
  //   they see each other's reservations).
  // - An email is typed, never verified, so existing identity is never
  //   overwritten from this unauthenticated input — only blank fields are
  //   filled in. Otherwise anyone could rewrite a real donor's KYC record.
  // - An already-identified donor no longer skips the check: past the
  //   threshold they must re-enter the ID on file, and it must match.
  //   Otherwise reusing a verified donor's email skipped ID capture
  //   entirely, leaving someone else's ID on file for the money.
  private async findOrCreateDonor(
    tx: Prisma.TransactionClient,
    donorEmail: string,
    input: InitiateVaultContributionInput,
    amount: Prisma.Decimal,
  ) {
    const existing = await tx.vaultDonor.findFirst({ where: { email: { equals: donorEmail, mode: "insensitive" } } });

    const recentSince = new Date(Date.now() - PENDING_COUNTS_TOWARD_THRESHOLD_MS);
    const prior = existing
      ? await tx.vaultContribution.findMany({
          where: {
            donorId: existing.id,
            OR: [{ status: "confirmed" }, { status: "pending", createdAt: { gte: recentSince } }],
          },
          select: { amount: true, currency: true },
        })
      : [];
    const currencies = [...new Set([input.currency, ...prior.map((c) => c.currency)])];
    const thresholds = await tx.vaultDonorThreshold.findMany({ where: { currency: { in: currencies } } });
    const thresholdByCurrency = new Map(thresholds.map((t) => [t.currency, t.thresholdAmount]));

    const fractionOf = (amt: Prisma.Decimal, currency: string): Prisma.Decimal => {
      const limit = thresholdByCurrency.get(currency);
      return limit && limit.gt(0) ? amt.div(limit) : new Prisma.Decimal(0);
    };
    const fractionUsed = prior.reduce(
      (sum, c) => sum.plus(fractionOf(c.amount, c.currency)),
      fractionOf(amount, input.currency),
    );

    const identifiedOnFile = existing?.idType != null && existing.idNumberEncrypted != null;
    if (fractionUsed.gte(1)) {
      if (identifiedOnFile) {
        if (!input.idType || !input.idNumber) {
          throw new BadRequestException({
            statusCode: 400,
            code: "IDENTITY_CONFIRMATION_REQUIRED",
            message: "For a gift of this size we need to confirm your identity. Please re-enter the ID you gave us before.",
          });
        }
        const onFile = normalizeIdNumber(this.encryption.decrypt(existing!.idNumberEncrypted!));
        if (existing!.idType !== input.idType || onFile !== normalizeIdNumber(input.idNumber)) {
          throw new BadRequestException({
            statusCode: 400,
            code: "IDENTITY_MISMATCH",
            message: "Those ID details don't match what we have on file for this email. Please check them, or contact Birr if your details have changed.",
          });
        }
      } else if (!input.donorFullName || !input.idType || !input.idNumber) {
        throw new BadRequestException({
          statusCode: 400,
          code: "IDENTITY_REQUIRED",
          message: "Because of the total you've given to Birr, we're required to confirm your identity for this gift. Please add your full name and an ID.",
        });
      }
    }

    const fill: Prisma.VaultDonorUpdateInput = {};
    if (!existing?.fullName && input.donorFullName) fill.fullName = input.donorFullName;
    if (!identifiedOnFile && input.idType && input.idNumber) {
      fill.idType = input.idType;
      fill.idNumberEncrypted = this.encryption.encrypt(input.idNumber);
    }

    if (existing) {
      if (Object.keys(fill).length === 0) return existing;
      const updated = await tx.vaultDonor.update({ where: { id: existing.id }, data: fill });
      await tx.auditLog.create({
        data: {
          actorType: "public_donor",
          actorDonorId: existing.id,
          action: "vault_donor.identity_captured",
          entityType: "VaultDonor",
          entityId: existing.id,
          before: donorAuditSnapshot(existing) as any,
          after: donorAuditSnapshot(updated) as any,
        },
      });
      return updated;
    }

    const created = await tx.vaultDonor.create({
      data: {
        email: donorEmail,
        fullName: fill.fullName as string | undefined,
        idType: fill.idType as IdType | undefined,
        idNumberEncrypted: fill.idNumberEncrypted as string | undefined,
      },
    });
    await tx.auditLog.create({
      data: {
        actorType: "public_donor",
        actorDonorId: created.id,
        action: "vault_donor.created",
        entityType: "VaultDonor",
        entityId: created.id,
        after: donorAuditSnapshot(created) as any,
      },
    });
    return created;
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

    // Every status flip below is a conditional claim (still "pending"), not
    // a blind update: providers retry webhooks, and two concurrent
    // deliveries both passing the read above used to both flip the row and
    // both post the ledger — double-counting the money. The loser of the
    // claim changes nothing and just returns the row as it now stands.
    const current = () => prisma.vaultContribution.findUniqueOrThrow({ where: { id: contribution.id } });

    if (result.status === "failed") {
      const failed = await prisma.$transaction(async (tx) => {
        const claim = await tx.vaultContribution.updateMany({
          where: { id: contribution.id, status: "pending" },
          data: { status: "failed" },
        });
        if (claim.count !== 1) return null;
        const failed = await tx.vaultContribution.findUniqueOrThrow({ where: { id: contribution.id } });
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
      return failed ?? current();
    }

    const confirmed = await prisma.$transaction(async (tx) => {
      const claim = await tx.vaultContribution.updateMany({
        where: { id: contribution.id, status: "pending" },
        data: {
          status: "confirmed",
          confirmedAt: new Date(),
          providerPaymentId: result.providerPaymentId ?? contribution.providerPaymentId,
        },
      });
      if (claim.count !== 1) return null;
      const confirmed = await tx.vaultContribution.findUniqueOrThrow({ where: { id: contribution.id } });
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
    if (!confirmed) return current();

    // Best-effort — record() never throws. Same sessionId fallback as
    // initiate() above, so an anonymous gift's two events still share a
    // handle even without a donor row.
    void this.funnelEvents.record({
      funnel: "vault",
      step: "contribution_confirmed",
      sessionId: contribution.donorId ?? confirmed.id,
      vaultId: contribution.vaultId,
      metadata: { currency: confirmed.currency, provider: confirmed.provider },
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

  // Backs a @Public() polling route whose id travels in the donor's return
  // URL (browser history, referrers, shared screenshots) — so an explicit
  // allow-list, never the full row. The full row carries ipAddress
  // (personal data) and heldReason (a compliance officer's AML note;
  // showing it to its subject would be tipping off).
  findPublicStatus(id: string) {
    return prisma.vaultContribution.findUnique({
      where: { id },
      select: {
        id: true,
        vaultId: true,
        amount: true,
        currency: true,
        provider: true,
        status: true,
        createdAt: true,
        confirmedAt: true,
        vault: { select: { name: true, slug: true } },
      },
    });
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
    let refundReference: string | null = null;
    try {
      if (adapter?.refund) {
        const result = await adapter.refund({
          providerReference: contribution.providerReference,
          providerPaymentId: contribution.providerPaymentId,
          amount: contribution.amount.toString(),
          currency: contribution.currency,
        });
        refundReference = result.refundReference;
      }
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
      return;
    }

    // The money has left by this point. If recording it fails, the row
    // deliberately stays "processing" — truthful and visibly stuck for a
    // human — rather than "failed", which would invite a second refund of
    // money already returned.
    try {
      await prisma.$transaction(async (tx) => {
        const refunded = await tx.vaultContribution.update({
          where: { id },
          data: { refundStatus: "refunded", refundedAt: new Date(), refundReference },
        });
        await tx.auditLog.create({
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
        // Reverses the confirmation's own posting (Debit Cash & Bank,
        // Credit Donations Revenue) — without this the books kept showing
        // money that had already gone back to the donor. Same transaction
        // as the status flip, same reasoning as handleWebhook's posting.
        const cashAndBank = await this.ledger.getAccountByCode(tx, CASH_AND_BANK_ACCOUNT_CODE);
        const donationsRevenue = await this.ledger.getAccountByCode(tx, DONATIONS_REVENUE_ACCOUNT_CODE);
        await this.ledger.post(tx, {
          vaultId: contribution.vaultId,
          description: `Contribution refunded (${contribution.provider})`,
          currency: contribution.currency,
          source: "contribution_refund",
          sourceId: id,
          actorType: "system",
          lines: [
            { ledgerAccountId: donationsRevenue.id, debit: contribution.amount },
            { ledgerAccountId: cashAndBank.id, credit: contribution.amount },
          ],
        });
      });
    } catch (err) {
      this.logger.error(
        `Refund for vault contribution "${id}" succeeded at the provider (reference ${refundReference ?? "none"}) but recording it failed — left in "processing" for manual reconciliation:`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
