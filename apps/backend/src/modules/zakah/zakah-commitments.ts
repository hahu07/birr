import { prisma, Prisma, ZakahPool } from "@birr/db";

type Db = Prisma.TransactionClient | typeof prisma;

const LIVE = ["pending_approval", "approved", "paid"] as const;

/**
 * Serialises everything that can change how much zakah is committed —
 * creating or approving a distribution or a refund, placing an AML hold —
 * so two of them can never both spend the same naira.
 */
export function lockZakahCommitments(tx: Prisma.TransactionClient) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('zakah_distribution_commitments'))`;
}

/**
 * What an AML hold on one payment reserves: its zakah not already being
 * refunded (a refund of a held payment takes over that part of the
 * reservation, so the two never count the same naira twice).
 */
export async function heldReservation(db: Db, payment: { id: string; amount: Prisma.Decimal; heldAt: Date | null }) {
  if (!payment.heldAt) return new Prisma.Decimal(0);
  const refunds = await db.zakahRefund.aggregate({ where: { paymentId: payment.id, status: { in: [...LIVE] } }, _sum: { amount: true } });
  return Prisma.Decimal.max(0, payment.amount.minus(refunds._sum.amount ?? 0));
}

/**
 * The spending limit distributions and refunds share, per pool: zakah
 * received into the pool, minus everything committed out of it (awaiting
 * approval, approved or paid — rejected releases) and everything frozen by
 * an AML hold, can never go below zero. Pools never lend to each other:
 * fitr can't pay out zakah on wealth, nor food fitr pay out cash.
 */
export async function zakahTotals(db: Db, currency = "NGN", pool: ZakahPool = "mal") {
  const [received, distributed, refunded, distributedPaid, refundedPaid, heldPayments] = await Promise.all([
    db.zakahPayment.aggregate({ where: { status: "confirmed", currency, pool }, _sum: { amount: true } }),
    db.zakahDistribution.aggregate({ where: { status: { in: [...LIVE] }, currency, pool }, _sum: { amount: true } }),
    db.zakahRefund.aggregate({ where: { status: { in: [...LIVE] }, currency, pool }, _sum: { amount: true } }),
    db.zakahDistribution.aggregate({ where: { status: "paid", currency, pool }, _sum: { amount: true } }),
    db.zakahRefund.aggregate({ where: { status: "paid", currency, pool }, _sum: { amount: true } }),
    db.zakahPayment.findMany({ where: { status: "confirmed", currency, pool, heldAt: { not: null } }, select: { id: true, amount: true, heldAt: true } }),
  ]);
  const zero = new Prisma.Decimal(0);
  let held = zero;
  for (const p of heldPayments) held = held.plus(await heldReservation(db, p));
  const distributionsCommitted = distributed._sum.amount ?? zero;
  const refundsCommitted = refunded._sum.amount ?? zero;
  return {
    received: received._sum.amount ?? zero,
    committed: distributionsCommitted.plus(refundsCommitted).plus(held),
    /** Frozen by AML holds (included in committed). */
    held,
    /** Paid out to recipients. */
    paid: distributedPaid._sum.amount ?? zero,
    /** Paid back to payers. */
    refunded: refundedPaid._sum.amount ?? zero,
  };
}
