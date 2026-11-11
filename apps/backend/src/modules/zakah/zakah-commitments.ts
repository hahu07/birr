import { prisma, Prisma, ZakahPool } from "@birr/db";

type Db = Prisma.TransactionClient | typeof prisma;

const LIVE = ["pending_approval", "approved", "paid"] as const;

/**
 * Serialises everything that can change how much zakah is committed —
 * creating or approving a distribution or a refund — so two of them can
 * never both spend the same naira.
 */
export function lockZakahCommitments(tx: Prisma.TransactionClient) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('zakah_distribution_commitments'))`;
}

/**
 * The spending limit distributions and refunds share, per pool: zakah
 * received into the pool, minus everything committed out of it (awaiting
 * approval, approved or paid — rejected releases), can never go below
 * zero. Pools never lend to each other: fitr can't pay out zakah on
 * wealth, nor food fitr pay out cash.
 */
export async function zakahTotals(db: Db, currency = "NGN", pool: ZakahPool = "mal") {
  const [received, distributed, refunded, distributedPaid, refundedPaid] = await Promise.all([
    db.zakahPayment.aggregate({ where: { status: "confirmed", currency, pool }, _sum: { amount: true } }),
    db.zakahDistribution.aggregate({ where: { status: { in: [...LIVE] }, currency, pool }, _sum: { amount: true } }),
    db.zakahRefund.aggregate({ where: { status: { in: [...LIVE] }, currency, pool }, _sum: { amount: true } }),
    db.zakahDistribution.aggregate({ where: { status: "paid", currency, pool }, _sum: { amount: true } }),
    db.zakahRefund.aggregate({ where: { status: "paid", currency, pool }, _sum: { amount: true } }),
  ]);
  const zero = new Prisma.Decimal(0);
  const distributionsCommitted = distributed._sum.amount ?? zero;
  const refundsCommitted = refunded._sum.amount ?? zero;
  return {
    received: received._sum.amount ?? zero,
    committed: distributionsCommitted.plus(refundsCommitted),
    /** Paid out to recipients. */
    paid: distributedPaid._sum.amount ?? zero,
    /** Paid back to payers. */
    refunded: refundedPaid._sum.amount ?? zero,
  };
}
