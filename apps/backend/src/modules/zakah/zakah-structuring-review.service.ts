import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@birr/db";

const CURRENCY = "NGN";

interface PaymentRow {
  id: string;
  pool: string;
  amount: string;
  createdAt: Date;
  heldAt: Date | null;
  payerId: string | null;
  payerEmail: string | null;
  payerFullName: string | null;
  payerIdCaptured: boolean;
}

/**
 * The zakah AML review list: patterns for a person to judge, never a
 * block. Mirrors VaultContributionsService.getStructuringReview — the
 * in-app threshold check only ever recognises a payer by email, so
 * splitting one large payment across several emails, or across Vault and
 * zakah, goes unseen without this (CLAUDE.md's 2026-09-15 note chose
 * manual review over an automated block for exactly that gap).
 *
 * Three signals:
 * - near the threshold: different payers each paying at least
 *   `minFraction` of the NGN AML threshold into the same pool;
 * - shared network: different payer identities paying from one IP;
 * - across Vault and zakah (owner's decision, 2026-11-11): the same email
 *   as both a Vault donor and a zakah payer whose combined NGN giving
 *   reaches the threshold, and networks shared between the two products.
 *
 * NGN only: amounts are never converted between currencies anywhere in
 * Birr, so Vault giving in other currencies isn't added in here.
 */
@Injectable()
export class ZakahStructuringReviewService {
  async review(minFraction = 0.5) {
    const threshold = (await prisma.vaultDonorThreshold.findUnique({ where: { currency: CURRENCY } }))?.thresholdAmount ?? null;
    const payments = await prisma.zakahPayment.findMany({
      where: { status: "confirmed", currency: CURRENCY },
      include: { payer: { select: { id: true, email: true, fullName: true, idType: true } } },
      orderBy: { createdAt: "desc" },
    });
    const rows = payments.map((p) => ({
      ipAddress: p.ipAddress,
      row: {
        id: p.id,
        pool: p.pool,
        amount: p.amount.toFixed(2),
        createdAt: p.createdAt,
        heldAt: p.heldAt,
        payerId: p.payerId,
        payerEmail: p.payer?.email ?? null,
        payerFullName: p.payer?.fullName ?? null,
        payerIdCaptured: p.payer?.idType != null,
      } satisfies PaymentRow,
    }));

    return {
      currency: CURRENCY,
      thresholdAmount: threshold?.toFixed(2) ?? null,
      nearThreshold: threshold ? this.nearThreshold(rows.map((r) => r.row), threshold, minFraction) : [],
      ipClusters: this.ipClusters(rows),
      acrossVault: await this.acrossVault(rows, threshold),
    };
  }

  /** Several different payers each paying close to the threshold into the same pool. */
  private nearThreshold(rows: PaymentRow[], threshold: Prisma.Decimal, minFraction: number) {
    if (threshold.lte(0)) return [];
    const near = rows.filter((r) => new Prisma.Decimal(r.amount).div(threshold).toNumber() >= minFraction);
    const byPool = new Map<string, PaymentRow[]>();
    for (const r of near) byPool.set(r.pool, [...(byPool.get(r.pool) ?? []), r]);
    return [...byPool.entries()]
      .map(([pool, payments]) => ({
        pool,
        // Anonymous payments each count as their own payer: the most evasive case.
        distinctPayerCount: new Set(payments.map((p) => p.payerId ?? p.id)).size,
        payments: payments.map((p) => ({ ...p, fractionOfThreshold: new Prisma.Decimal(p.amount).div(threshold).toNumber() })),
      }))
      // One payer making one large, ID-verified payment isn't a pattern.
      .filter((g) => g.distinctPayerCount >= 2)
      .sort((a, b) => b.distinctPayerCount - a.distinctPayerCount);
  }

  /** One network, two or more different payer identities. An IP is a signal (a household or office shares one), never proof. */
  private ipClusters(rows: { ipAddress: string | null; row: PaymentRow }[]) {
    const byIp = new Map<string, PaymentRow[]>();
    for (const { ipAddress, row } of rows) {
      if (!ipAddress || !row.payerId) continue;
      byIp.set(ipAddress, [...(byIp.get(ipAddress) ?? []), row]);
    }
    return [...byIp.entries()]
      .map(([ipAddress, payments]) => ({ ipAddress, distinctPayerCount: new Set(payments.map((p) => p.payerId)).size, payments }))
      .filter((c) => c.distinctPayerCount >= 2)
      .sort((a, b) => b.distinctPayerCount - a.distinctPayerCount);
  }

  /**
   * Giving that spans the two products — the gap the threshold check
   * leaves open, since each product only counts its own payments.
   */
  private async acrossVault(rows: { ipAddress: string | null; row: PaymentRow }[], threshold: Prisma.Decimal | null) {
    const vaultGifts = await prisma.vaultContribution.findMany({
      where: { status: "confirmed", currency: CURRENCY, donorId: { not: null } },
      include: { donor: { select: { email: true, fullName: true, idType: true } }, vault: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    const vaultRow = (g: (typeof vaultGifts)[number]) => ({
      id: g.id,
      vaultName: g.vault.name,
      amount: g.amount.toFixed(2),
      createdAt: g.createdAt,
      donorEmail: g.donor!.email,
      donorFullName: g.donor!.fullName,
      donorIdCaptured: g.donor!.idType != null,
    });

    // Same email on both sides (both products store emails lower-cased).
    const zakahByEmail = new Map<string, PaymentRow[]>();
    for (const { row } of rows) {
      if (row.payerEmail) zakahByEmail.set(row.payerEmail, [...(zakahByEmail.get(row.payerEmail) ?? []), row]);
    }
    const vaultByEmail = new Map<string, ReturnType<typeof vaultRow>[]>();
    for (const g of vaultGifts) {
      const email = g.donor!.email.toLowerCase();
      if (zakahByEmail.has(email)) vaultByEmail.set(email, [...(vaultByEmail.get(email) ?? []), vaultRow(g)]);
    }
    const sum = (amounts: string[]) => amounts.reduce((t, a) => t.plus(a), new Prisma.Decimal(0));
    const sameEmail = [...vaultByEmail.entries()]
      .map(([email, vault]) => {
        const zakah = zakahByEmail.get(email)!;
        const zakahTotal = sum(zakah.map((p) => p.amount));
        const vaultTotal = sum(vault.map((g) => g.amount));
        return { email, zakahTotal: zakahTotal.toFixed(2), vaultTotal: vaultTotal.toFixed(2), combined: zakahTotal.plus(vaultTotal), zakah, vault };
      })
      .filter((m) => threshold === null || m.combined.gte(threshold))
      .sort((a, b) => b.combined.comparedTo(a.combined))
      .map(({ combined, ...m }) => ({ ...m, combinedTotal: combined.toFixed(2) }));

    // A network both products' givers used, under two or more different emails.
    const vaultByIp = new Map<string, ReturnType<typeof vaultRow>[]>();
    for (const g of vaultGifts) {
      if (g.ipAddress) vaultByIp.set(g.ipAddress, [...(vaultByIp.get(g.ipAddress) ?? []), vaultRow(g)]);
    }
    const zakahByIp = new Map<string, PaymentRow[]>();
    for (const { ipAddress, row } of rows) {
      if (ipAddress && row.payerEmail) zakahByIp.set(ipAddress, [...(zakahByIp.get(ipAddress) ?? []), row]);
    }
    const sharedNetworks = [...zakahByIp.entries()]
      .filter(([ip]) => vaultByIp.has(ip))
      .map(([ipAddress, zakah]) => {
        const vault = vaultByIp.get(ipAddress)!;
        const emails = new Set([...zakah.map((p) => p.payerEmail!), ...vault.map((g) => g.donorEmail.toLowerCase())]);
        return { ipAddress, distinctEmailCount: emails.size, zakah, vault };
      })
      // One person giving to both from their own device isn't a pattern.
      .filter((n) => n.distinctEmailCount >= 2)
      .sort((a, b) => b.distinctEmailCount - a.distinctEmailCount);

    return { sameEmail, sharedNetworks };
  }
}
