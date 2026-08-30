import { Prisma } from "@birr/db";

export interface ProRataShare {
  key: string;
  weight: Prisma.Decimal;
}

/**
 * Splits `total` proportionally across `shares` by weight, to the cent,
 * using the largest-remainder method — a naive per-share round (each
 * share's exact cut, rounded independently) drifts by a cent or more
 * once N shares are summed, which is exactly wrong for money: the
 * result has to sum to precisely `total`, not "close to" it. This
 * floors every share to its exact whole-cent amount first, then hands
 * out the few leftover cents one at a time to the shares with the
 * largest fractional remainder — the standard apportionment method for
 * this problem (same idea used for allocating seats to voters).
 */
export function splitProRata(total: Prisma.Decimal, shares: ProRataShare[]): Map<string, Prisma.Decimal> {
  if (shares.length === 0) return new Map();

  const totalWeight = shares.reduce((sum, s) => sum.plus(s.weight), new Prisma.Decimal(0));
  if (totalWeight.lessThanOrEqualTo(0)) {
    throw new Error("Total weight of all shares must be positive to split proportionally.");
  }

  const withRemainders = shares.map((s) => {
    const exact = total.times(s.weight).dividedBy(totalWeight);
    const floor = exact.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    return { key: s.key, floor, remainder: exact.minus(floor) };
  });

  const flooredSum = withRemainders.reduce((sum, w) => sum.plus(w.floor), new Prisma.Decimal(0));
  const leftoverCents = total
    .minus(flooredSum)
    .times(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const byRemainderDesc = [...withRemainders].sort((a, b) => b.remainder.comparedTo(a.remainder));

  const result = new Map<string, Prisma.Decimal>();
  for (const w of withRemainders) result.set(w.key, w.floor);
  for (let i = 0; i < leftoverCents && i < byRemainderDesc.length; i++) {
    const key = byRemainderDesc[i]!.key;
    result.set(key, result.get(key)!.plus("0.01"));
  }
  return result;
}
