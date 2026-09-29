import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@birr/db";

export interface AllocationCeilingCause {
  allocatedAmount: Prisma.Decimal | null;
  proceedsAllocatedAmount: Prisma.Decimal | null;
}

/**
 * The table/model-specific plumbing a caller supplies —
 * DistributionsService (WaqfCause/Distribution) and
 * VaultDistributionsService (VaultCause/VaultDistribution) each pass a
 * thin adapter built from their own already-open transaction; this
 * module never touches Prisma delegates directly, only these callbacks.
 */
export interface AllocationCeilingConfig {
  /**
   * Row-locks the cause for the rest of this transaction (a real
   * `SELECT ... FOR UPDATE`) so two concurrent commits against the same
   * cause can't both read the pre-commit "already committed" sum below
   * and jointly exceed the ceiling (TOCTOU) — this lock is what makes
   * the ceiling real under concurrency, not just the comparison on its
   * own.
   */
  lockCause(causeId: string): Promise<void>;
  /**
   * The cause's own allocation fields for the given currency, plus its
   * parent's (Waqf/Vault) type. Investment-type parents only count
   * proceedsAllocatedAmount toward the ceiling — corpus (allocatedAmount)
   * is preserved principal, not itself distributable, per classical
   * waqf perpetuity (see CLAUDE.md's 2026-09-04 update). Every other
   * type has no proceeds concept at all, so allocatedAmount stays its
   * only, fully distributable, pool. `currency` lets a caller whose
   * ceiling genuinely varies by currency (VaultCauseAllocation) return
   * the right row; a caller whose ceiling has no currency dimension at
   * all (WaqfCause) can just ignore the parameter.
   */
  loadCauseAndParentType(
    causeId: string,
    currency: string,
  ): Promise<{ cause: AllocationCeilingCause | null; parentType: string | null }>;
  /**
   * A committed row (any status counted toward the ceiling) against
   * this cause in a currency other than the one being checked, if one
   * exists — was originally a guard against a *bare, currency-less*
   * ceiling number silently being reused across two different
   * currencies (found 2026-09-04). A caller whose ceiling is itself
   * genuinely currency-scoped (VaultCauseAllocation, one row per
   * currency) has nothing to guard against here and should just return
   * `null` unconditionally — legitimate multi-currency commitments
   * against the same cause are exactly the point. A caller whose
   * ceiling has no currency dimension (WaqfCause, on a legacy waqf with
   * no declared corpusCurrency) still needs this to catch that edge
   * case for real.
   */
  findCommittedInOtherCurrency(currency: string): Promise<{ currency: string } | null>;
  /** Sum of every committed row's amount against this cause in the given currency. */
  sumCommittedInCurrency(currency: string): Promise<Prisma.Decimal | null>;
}

/**
 * The real, enforced ceiling on how much can be committed against a
 * single Cause (WaqfCause or VaultCause) — "a real enforced ceiling,
 * not a decorative figure" per CLAUDE.md. Shared between
 * DistributionsService and VaultDistributionsService rather than
 * duplicated, because this exact policy has already changed twice
 * (CLAUDE.md's 2026-08-27 and 2026-09-04 updates) — a third change
 * should be one edit here, not a search for a second copy that's
 * quietly drifted. Callers own the table-specific plumbing (row lock,
 * cause+parent lookup, committed-sum queries); this function owns only
 * the policy itself.
 */
export async function assertWithinAllocation(
  causeId: string,
  additionalAmount: Prisma.Decimal,
  currency: string,
  config: AllocationCeilingConfig,
): Promise<void> {
  // A non-positive commitment would lower the committed total and so
  // raise everyone else's headroom — reject it here too, not only in DTOs.
  if (!additionalAmount.gt(0)) {
    throw new BadRequestException("A distribution amount must be greater than zero.");
  }
  await config.lockCause(causeId);
  const { cause, parentType } = await config.loadCauseAndParentType(causeId, currency);
  const allocated =
    parentType === "investment"
      ? new Prisma.Decimal(cause?.proceedsAllocatedAmount ?? 0)
      : new Prisma.Decimal(cause?.allocatedAmount ?? 0).plus(cause?.proceedsAllocatedAmount ?? 0);

  const otherCurrencyCommitment = await config.findCommittedInOtherCurrency(currency);
  if (otherCurrencyCommitment) {
    throw new BadRequestException(
      `This cause already has committed distributions in ${otherCurrencyCommitment.currency} — a distribution against the same cause can't switch to ${currency} without first resolving the earlier ones.`,
    );
  }

  const alreadyCommitted = (await config.sumCommittedInCurrency(currency)) ?? new Prisma.Decimal(0);

  if (alreadyCommitted.plus(additionalAmount).gt(allocated)) {
    const remaining = allocated.minus(alreadyCommitted);
    throw new BadRequestException(
      `This distribution's amount (${additionalAmount} ${currency}) exceeds this cause's unused allocation — only ${remaining.isNegative() ? 0 : remaining} ${currency} of its ${allocated} allocation is unused.`,
    );
  }
}
