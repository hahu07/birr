import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@birr/db";
import { SPENDABLE_CONTRIBUTION_WHERE } from "../vaults/spendable-contributions";

export interface CurrencyTotal {
  currency: string;
  amount: string;
}

export interface ImpactSummary {
  /** Confirmed gifts: Waqf Fund contributions plus Vault gifts Birr actually holds. */
  giftsReceived: number;
  /** Total given, per currency — never converted or added across currencies. Largest first. */
  givenByCurrency: CurrencyTotal[];
  /** Active Waqf Funds plus Vaults that are or were open for giving. */
  fundsAndCampaigns: number;
  /** Money actually paid out to causes (payout confirmed), per currency. Largest first. */
  paidOutByCurrency: CurrencyTotal[];
}

/** Adds same-currency totals from several grouped queries (exact decimal arithmetic); different currencies stay separate. */
export function mergeByCurrency(...groups: { currency: string; amount: string | null }[][]): CurrencyTotal[] {
  const totals = new Map<string, Prisma.Decimal>();
  for (const group of groups) {
    for (const row of group) {
      if (!row.amount) continue;
      totals.set(row.currency, (totals.get(row.currency) ?? new Prisma.Decimal(0)).plus(row.amount));
    }
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount.greaterThan(0))
    .sort((a, b) => b[1].comparedTo(a[1]))
    .map(([currency, amount]) => ({ currency, amount: amount.toString() }));
}

@Injectable()
export class ImpactService {
  /**
   * Public, aggregate-only: counts and sums over records that are real and
   * settled, nothing donor- or founder-identifying. Used by the marketing
   * homepage's Impact section — every figure there is a claim about a
   * fiduciary service, so each one is deliberately conservative:
   *  - Vault gifts use SPENDABLE_CONTRIBUTION_WHERE (not a bare
   *    status: "confirmed"), so a refunded or AML-held gift is not counted
   *    as impact;
   *  - paid-out means `paid` (payout confirmed by the provider's webhook),
   *    not merely approved or disbursing;
   *  - currencies are never combined (no live exchange rate, same posture
   *    as the rest of this codebase).
   */
  async summary(): Promise<ImpactSummary> {
    const [
      waqfGiftCount,
      vaultGiftCount,
      waqfGiven,
      vaultGiven,
      activeWaqfs,
      vaults,
      waqfPaid,
      vaultPaid,
    ] = await Promise.all([
      prisma.contribution.count({ where: { status: "confirmed" } }),
      prisma.vaultContribution.count({ where: SPENDABLE_CONTRIBUTION_WHERE }),
      prisma.contribution.groupBy({ by: ["currency"], where: { status: "confirmed" }, _sum: { amount: true } }),
      prisma.vaultContribution.groupBy({ by: ["currency"], where: SPENDABLE_CONTRIBUTION_WHERE, _sum: { amount: true } }),
      prisma.waqf.count({ where: { status: "active", deletedAt: null } }),
      prisma.vault.count({ where: { status: { in: ["open", "closed"] }, deletedAt: null } }),
      prisma.distribution.groupBy({ by: ["currency"], where: { status: "paid", deletedAt: null }, _sum: { amount: true } }),
      prisma.vaultDistribution.groupBy({ by: ["currency"], where: { status: "paid", deletedAt: null }, _sum: { amount: true } }),
    ]);

    const toRows = (rows: { currency: string; _sum: { amount: { toString(): string } | null } }[]) =>
      rows.map((r) => ({ currency: r.currency, amount: r._sum.amount?.toString() ?? null }));

    return {
      giftsReceived: waqfGiftCount + vaultGiftCount,
      givenByCurrency: mergeByCurrency(toRows(waqfGiven), toRows(vaultGiven)),
      fundsAndCampaigns: activeWaqfs + vaults,
      paidOutByCurrency: mergeByCurrency(toRows(waqfPaid), toRows(vaultPaid)),
    };
  }
}
