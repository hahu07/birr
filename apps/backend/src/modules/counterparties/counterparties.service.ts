import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { prisma, Prisma, CounterpartyType, CounterpartyStatus, PayoutProvider } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { SanctionsScreeningService } from "./sanctions-screening.service";

export class RegisterCounterpartyInput {
  @IsString()
  name!: string;

  @IsEnum(CounterpartyType)
  institutionType!: CounterpartyType;

  @IsString()
  jurisdiction!: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // Required, with a real substance floor — this is the primary thing a
  // shariah_board_member actually reads before recordShariahApproval.
  // Used to be optional and unchecked for content, which left that
  // review with nothing to go on (found 2026-09-04); update() below
  // leaves it optional since a correction there is touching an already-
  // reviewed or already-populated record, not a first-time intake gap.
  @IsString()
  @IsNotEmpty()
  @MinLength(20, { message: "businessActivities must describe what this counterparty actually does in enough detail for a Shariah review (at least 20 characters)." })
  businessActivities!: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  regulatoryLicenseNumber?: string;

  @IsOptional()
  @IsString()
  regulatingAuthority?: string;

  @IsOptional()
  @IsString()
  licenseExpiresAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Not itself a judgment — just a fact (name/reference of any existing
  // Shariah board or certification this counterparty already holds
  // elsewhere) for the reviewer to weigh alongside businessActivities.
  @IsOptional()
  @IsString()
  existingShariahCertification?: string;
}

// Everything about a counterparty's identity/profile that can change
// after registration without touching either fiduciary gate — Shariah
// approval and status stay on their own dedicated, more tightly gated
// methods (recordShariahApproval/onboard/suspend/blacklist), not this
// generic update.
export class UpdateCounterpartyInput {
  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  businessActivities?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  regulatoryLicenseNumber?: string;

  @IsOptional()
  @IsString()
  regulatingAuthority?: string;

  @IsOptional()
  @IsString()
  licenseExpiresAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  existingShariahCertification?: string;
}

export class SetConcentrationLimitInput {
  @IsString()
  amount!: Prisma.Decimal | number | string;

  @IsString()
  currency!: string;
}

// Only Paystack payouts exist anywhere in this codebase today (see
// DistributionsService.assertPayoutReady's own comment) — payoutProvider
// is still a real field, not hardcoded, so a second rail slots in later
// without a schema change, same posture as Beneficiary.payoutProvider.
export class SetPayoutDetailsInput {
  @IsEnum(PayoutProvider)
  payoutProvider!: PayoutProvider;

  @IsString()
  bankName!: string;

  @IsString()
  accountNumber!: string;

  @IsString()
  accountName!: string;

  @IsString()
  bankCode!: string;
}

@Injectable()
export class CounterpartiesService {
  constructor(
    private readonly encryption: EncryptionService,
    private readonly sanctionsScreening: SanctionsScreeningService,
  ) {}

  /**
   * Plain CRUD, gated to investment_committee (they source and vet
   * counterparty relationships day-to-day) — registering a candidate
   * moves nothing, commits nothing. Three gates now stand between this
   * and `active`: Shariah sign-off, the automatic sanctions/PEP
   * screening below (2026-09-15), and the counterparty.onboard governed
   * action — see this model's own schema comment.
   *
   * The screening call happens right here, in the same transaction as
   * the create — a hit or an outright screening failure (vendor
   * unconfigured, network error) both land this row at `under_review`
   * instead of the default `pending_review`, fail-closed: see
   * SanctionsScreeningStatus's own schema comment on why "error" isn't
   * treated as "clear." onboard() re-checks the latest screening
   * independently, so this isn't the only enforcement point — it's what
   * makes the need for review visible immediately, on the Counterparties
   * list, rather than only discovered when someone tries to onboard.
   */
  async register(input: RegisterCounterpartyInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const counterparty = await tx.counterparty.create({
        data: {
          ...input,
          licenseExpiresAt: input.licenseExpiresAt ? new Date(input.licenseExpiresAt) : undefined,
        },
      });

      const screening = await this.sanctionsScreening.screen(counterparty.id, counterparty.name, tx);
      const flagged = screening.status === "hit" || screening.status === "error";
      const withScreeningStatus = flagged
        ? await tx.counterparty.update({ where: { id: counterparty.id }, data: { status: "under_review" } })
        : counterparty;

      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "counterparty.registered",
          entityType: "Counterparty",
          entityId: counterparty.id,
          after: withScreeningStatus as any,
        },
      });
      return withScreeningStatus;
    });
  }

  /**
   * Corrections to the profile/KYC details — jurisdiction, contact
   * info, license number, etc. Deliberately excludes `name` (the
   * unique, stable identity a Shariah approval and every Investment
   * reference by id anyway, so renaming isn't needed) and `status`
   * (only ever changes via recordShariahApproval/onboard/suspend/
   * blacklist, each with their own real gate — a generic update
   * bypassing those would defeat the point of having them).
   */
  async update(id: string, input: UpdateCounterpartyInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const counterparty = await tx.counterparty.findUnique({ where: { id } });
      if (!counterparty) throw new NotFoundException(`Counterparty "${id}" not found.`);

      const updated = await tx.counterparty.update({
        where: { id },
        data: {
          ...input,
          licenseExpiresAt: input.licenseExpiresAt ? new Date(input.licenseExpiresAt) : undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "counterparty.updated",
          entityType: "Counterparty",
          entityId: id,
          before: counterparty as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  /**
   * Gate 1 of 2 — a shariah_board_member's own domain sign-off (not
   * maker-checker; a single qualified expert's structured declaration,
   * same posture as ConflictOfInterestDeclaration). Required before
   * onboard() below will ever let `status` become `active`. Rejects a
   * second sign-off attempt — a correction means registering the
   * counterparty afresh, not silently overwriting who approved what.
   */
  async recordShariahApproval(id: string, approverUserId: string) {
    return prisma.$transaction(async (tx) => {
      const counterparty = await tx.counterparty.findUnique({ where: { id } });
      if (!counterparty) throw new NotFoundException(`Counterparty "${id}" not found.`);
      if (counterparty.shariahApprovedAt) {
        throw new ConflictException("This counterparty already has a recorded Shariah approval.");
      }
      // "blacklisted" is included deliberately — blacklist() clears any
      // prior sign-off (see that method's own comment), so reactivating a
      // blacklisted counterparty genuinely needs a fresh one, not a reuse
      // of an approval that predates whatever caused the blacklist.
      // "suspended" is NOT included: suspend() keeps the existing
      // sign-off intact, so re-onboarding it hits the ConflictException
      // above instead — correctly, no new review needed there.
      if (counterparty.status !== "pending_review" && counterparty.status !== "under_review" && counterparty.status !== "blacklisted") {
        throw new BadRequestException(`Counterparty is ${counterparty.status} — not awaiting Shariah review.`);
      }

      const updated = await tx.counterparty.update({
        where: { id },
        data: { shariahApprovedAt: new Date(), shariahApprovedByUserId: approverUserId },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId: approverUserId,
          action: "counterparty.shariah_approved",
          entityType: "Counterparty",
          entityId: id,
          before: counterparty as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  /**
   * Risk & Compliance's own ceiling on total exposure to this one
   * counterparty, across every waqf combined — enforced for real in
   * InvestmentsService.create()/changeAllocation(), not a decorative
   * figure. Plain CRUD, same admin-configurable-value posture as
   * CorpusMinimum/ContributionMinimum.
   */
  async setConcentrationLimit(id: string, input: SetConcentrationLimitInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const counterparty = await tx.counterparty.findUnique({ where: { id } });
      if (!counterparty) throw new NotFoundException(`Counterparty "${id}" not found.`);

      const updated = await tx.counterparty.update({
        where: { id },
        data: { concentrationLimit: input.amount, concentrationLimitCurrency: input.currency },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "counterparty.concentration_limit_set",
          entityType: "Counterparty",
          entityId: id,
          before: counterparty as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  /**
   * Where a Counterparty's own payout bank details get set — needed
   * before VaultDistributionsService.approve() can succeed for any
   * distribution paying this counterparty (see that service's own
   * assertPayoutReady). Same AES-256-GCM encrypted-JSON-blob shape as
   * Beneficiary.bankDetailsEncrypted, via the same EncryptionService —
   * not a new pattern.
   */
  async setPayoutDetails(id: string, input: SetPayoutDetailsInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const counterparty = await tx.counterparty.findUnique({ where: { id } });
      if (!counterparty) throw new NotFoundException(`Counterparty "${id}" not found.`);

      const { payoutProvider, ...bankDetails } = input;
      const updated = await tx.counterparty.update({
        where: { id },
        data: { payoutProvider, payoutBankDetailsEncrypted: this.encryption.encrypt(JSON.stringify(bankDetails)) },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "counterparty.payout_details_set",
          entityType: "Counterparty",
          entityId: id,
          // Never logs the plaintext bank details, even in the audit
          // trail — same PII-exclusion posture as
          // WaqfCausesService/GovernedActionsService strip
          // bankDetailsEncrypted from a Beneficiary snapshot everywhere
          // it appears.
          before: { payoutProvider: counterparty.payoutProvider },
          after: { payoutProvider: updated.payoutProvider },
        },
      });
      return updated;
    });
  }

  /**
   * Immediate, unilateral compliance_officer action — deliberately NOT
   * maker-checker. Stopping a bad actor needs speed, not dual control;
   * existing investments already placed are untouched (flagged for
   * wind-down on blacklist, not auto-liquidated — that stays a human
   * investment.change decision). Reactivating goes back through the full
   * onboard() gate, not this method. Blacklisting additionally clears
   * any recorded Shariah approval — see recordShariahApproval's own
   * comment on why reactivating a blacklisted counterparty needs a
   * fresh one, unlike a merely suspended one.
   */
  private async setStatus(id: string, status: "suspended" | "blacklisted", reason: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const counterparty = await tx.counterparty.findUnique({ where: { id } });
      if (!counterparty) throw new NotFoundException(`Counterparty "${id}" not found.`);

      const updated = await tx.counterparty.update({
        where: { id },
        data: {
          status,
          notes: counterparty.notes ? `${counterparty.notes}\n\n${reason}` : reason,
          ...(status === "blacklisted" ? { shariahApprovedAt: null, shariahApprovedByUserId: null } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: `counterparty.${status}`,
          entityType: "Counterparty",
          entityId: id,
          before: counterparty as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  suspend(id: string, reason: string, actorUserId: string) {
    return this.setStatus(id, "suspended", reason, actorUserId);
  }

  blacklist(id: string, reason: string, actorUserId: string) {
    return this.setStatus(id, "blacklisted", reason, actorUserId);
  }

  /**
   * Soft-delete only (CLAUDE.md: never hard-delete a governed record) —
   * for cleaning up a registration mistake, not for a counterparty that
   * actually held money. Blocked entirely if any Investment (any status,
   * including liquidated) ever referenced it, since that's real
   * financial history the registry entry needs to stay resolvable for —
   * suspend()/blacklist() are the correct path for "stop dealing with
   * this counterparty" once it's actually been used.
   */
  async deregister(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const counterparty = await tx.counterparty.findUnique({ where: { id } });
      if (!counterparty) throw new NotFoundException(`Counterparty "${id}" not found.`);
      if (counterparty.deletedAt) throw new ConflictException("This counterparty is already deregistered.");

      const investmentCount = await tx.investment.count({ where: { counterpartyId: id } });
      if (investmentCount > 0) {
        throw new BadRequestException(
          `Can't deregister — ${investmentCount} investment${investmentCount === 1 ? "" : "s"} already reference this counterparty. Suspend or blacklist it instead.`,
        );
      }

      const updated = await tx.counterparty.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "counterparty.deregistered",
          entityType: "Counterparty",
          entityId: id,
          before: counterparty as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  /**
   * Gate 3 of 3 (2026-09-15: was gate 2 of 2 before sanctions/PEP
   * screening) — internal only, never a public route. counterparty.onboard
   * is a governed action (see this model's own schema comment); the only
   * caller is GovernedActionsService's handler map, on approval, inside
   * its own transaction. Refuses to flip `status` to `active` unless
   * gate 1 (Shariah sign-off) already passed AND gate 2 (screening) is
   * clear — re-checked here independently of whatever register() set
   * `status` to, since a screening result can be resolve()'d well after
   * registration, and this is the actual money-adjacent moment that
   * matters, not a status label read at proposal time. Missing screening
   * entirely (a counterparty that predates this feature) blocks the same
   * as a real hit — fail-closed, not "no record means fine."
   */
  async onboard(id: string, tx: Prisma.TransactionClient) {
    const counterparty = await tx.counterparty.findUnique({ where: { id } });
    if (!counterparty) throw new NotFoundException(`Counterparty "${id}" not found.`);
    if (!counterparty.shariahApprovedAt) {
      throw new BadRequestException(
        "This counterparty has no recorded Shariah approval yet — that must happen before onboarding can be approved.",
      );
    }
    const screening = await this.sanctionsScreening.latestFor(id, tx);
    if (!screening || screening.status === "hit" || screening.status === "error") {
      throw new BadRequestException(
        screening
          ? `This counterparty's sanctions/PEP screening is unresolved (${screening.status}) — a compliance officer must resolve it before onboarding can be approved.`
          : "This counterparty has no sanctions/PEP screening on file — a compliance officer must resolve one before onboarding can be approved.",
      );
    }
    return tx.counterparty.update({ where: { id }, data: { status: "active" } });
  }

  findById(id: string) {
    return prisma.counterparty.findUnique({ where: { id } });
  }

  /**
   * `totalInvested` rides along on every row (one groupBy query, not N+1
   * per-row exposure() calls) so the registry table can show exposure at
   * a glance — the entire reason this model exists — without a click
   * into each entry. Same additive-computed-field posture as
   * WaqfsService.attachAmountRaised.
   */
  async list(status?: CounterpartyStatus) {
    const counterparties = await prisma.counterparty.findMany({
      where: { deletedAt: null, ...(status ? { status } : {}) },
      orderBy: { name: "asc" },
    });

    // A plain groupBy can't scope by each counterparty's own
    // concentrationLimitCurrency (that needs a join through to each
    // Investment's waqf, which groupBy doesn't support) — fetched as
    // rows instead and reduced in JS. Same currency-scoping reasoning as
    // exposure()/InvestmentsService.assertWithinConcentrationLimit: an
    // unscoped sum would blend currencies into one meaningless number.
    const investments = await prisma.investment.findMany({
      where: { counterpartyId: { in: counterparties.map((c) => c.id) }, status: "active" },
      select: { counterpartyId: true, allocatedAmount: true, waqf: { select: { corpusCurrency: true } } },
    });
    const concentrationLimitCurrencyById = new Map(counterparties.map((c) => [c.id, c.concentrationLimitCurrency]));
    const totalInvestedById = new Map<string, Prisma.Decimal>();
    for (const i of investments) {
      if (!i.counterpartyId) continue;
      const limitCurrency = concentrationLimitCurrencyById.get(i.counterpartyId);
      // Excludes only a KNOWN mismatch — see exposure()'s own comment.
      if (limitCurrency && i.waqf.corpusCurrency && i.waqf.corpusCurrency !== limitCurrency) continue;
      totalInvestedById.set(i.counterpartyId, (totalInvestedById.get(i.counterpartyId) ?? new Prisma.Decimal(0)).plus(i.allocatedAmount));
    }

    return counterparties.map((c) => ({
      ...c,
      totalInvested: totalInvestedById.get(c.id) ?? new Prisma.Decimal(0),
    }));
  }

  /**
   * Total exposure to this counterparty across every waqf combined —
   * the entire reason this model exists. Only counts `active`
   * Investments (a liquidated one has released its corpus back).
   * `remaining` is null when no concentrationLimit is configured yet.
   */
  async exposure(id: string) {
    const counterparty = await prisma.counterparty.findUnique({ where: { id } });
    if (!counterparty) throw new NotFoundException(`Counterparty "${id}" not found.`);

    // Scoped to concentrationLimitCurrency, same reasoning as
    // InvestmentsService.assertWithinConcentrationLimit — an unscoped sum
    // would blend currencies into one meaningless raw number the way a
    // prior version of this did.
    const investments = await prisma.investment.findMany({
      where: { counterpartyId: id, status: "active" },
      select: { allocatedAmount: true, currency: true },
    });
    // Excludes only a KNOWN currency mismatch (both currencies present
    // and different) — see InvestmentsService.assertWithinConcentrationLimit's
    // own comment on why an investment with no currency recorded counts
    // toward this total rather than being excluded from it.
    const totalInvested = investments
      .filter(
        (i) =>
          !counterparty.concentrationLimitCurrency ||
          !i.currency ||
          i.currency === counterparty.concentrationLimitCurrency,
      )
      .reduce((sum, i) => sum.plus(i.allocatedAmount), new Prisma.Decimal(0));

    return {
      counterpartyId: id,
      totalInvested,
      concentrationLimit: counterparty.concentrationLimit,
      concentrationLimitCurrency: counterparty.concentrationLimitCurrency,
      remaining: counterparty.concentrationLimit ? counterparty.concentrationLimit.minus(totalInvested) : null,
    };
  }
}
