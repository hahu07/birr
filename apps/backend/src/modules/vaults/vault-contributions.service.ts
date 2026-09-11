import { randomUUID } from "crypto";
import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { IsEmail, IsEnum, IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma, ContributionProvider, IdType } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { PaymentProviderAdapter } from "../contributions/providers/payment-provider.interface";
import { StripeAdapter } from "../contributions/providers/stripe.adapter";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { StablecoinAdapter } from "../contributions/providers/stablecoin.adapter";
import { ResendVaultReceiptEmailAdapter } from "./email/resend-vault-receipt.adapter";

export class InitiateVaultContributionInput {
  @IsString()
  vaultId!: string;

  @IsOptional()
  @IsString()
  vaultCauseId?: string;

  @IsNumberString()
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
   */
  async initiate(input: InitiateVaultContributionInput) {
    const vault = await prisma.vault.findFirst({ where: { id: input.vaultId, deletedAt: null } });
    if (!vault) throw new NotFoundException(`Vault "${input.vaultId}" not found.`);
    if (vault.status !== "open") {
      throw new BadRequestException(`"${vault.name}" isn't currently open for contributions.`);
    }
    if (input.currency !== vault.currency) {
      throw new BadRequestException(`This vault only accepts contributions in ${vault.currency}.`);
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
   * enforced: a per-currency VaultDonorThreshold, checked two ways —
   * this single contribution alone crossing it, or this donor's existing
   * confirmed total (matched by email) plus this new pending amount
   * crossing it. The second check is the actual anti-structuring guard;
   * a pure per-transaction check would miss someone splitting one large
   * gift into several small ones to stay under the radar each time.
   *
   * Returns null when no email is given — donorEmail is optional (owner's
   * explicit direction, 2026-09-11), so a fully anonymous contribution is
   * allowed with no VaultDonor row at all. This is a real, accepted
   * tradeoff: an anonymous gift gets no receipt, AND skips the AML check
   * entirely (there's no identity thread to check a running total
   * against) — a donor who omits their email can give any amount without
   * ever triggering identity capture. That's the cost of allowing
   * anonymous giving, not an oversight.
   */
  private async findOrCreateDonor(input: InitiateVaultContributionInput, amount: Prisma.Decimal) {
    if (!input.donorEmail) return null;

    const existing = await prisma.vaultDonor.findUnique({ where: { email: input.donorEmail } });

    const threshold = await prisma.vaultDonorThreshold.findUnique({ where: { currency: input.currency } });
    if (threshold) {
      const confirmedTotal = existing
        ? await prisma.vaultContribution.aggregate({
            where: { donorId: existing.id, currency: input.currency, status: "confirmed" },
            _sum: { amount: true },
          })
        : null;
      const runningTotal = (confirmedTotal?._sum.amount ?? new Prisma.Decimal(0)).plus(amount);
      const alreadyIdentified = existing?.idType != null;

      if (!alreadyIdentified && (amount.gte(threshold.thresholdAmount) || runningTotal.gte(threshold.thresholdAmount))) {
        if (!input.donorFullName || !input.idType || !input.idNumber) {
          throw new BadRequestException(
            `Contributions to this vault at or above ${input.currency} ${threshold.thresholdAmount} (including your total giving so far) require your full name and an ID for compliance — please provide donorFullName, idType, and idNumber.`,
          );
        }
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
        data: { status: "confirmed", confirmedAt: new Date() },
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
}
