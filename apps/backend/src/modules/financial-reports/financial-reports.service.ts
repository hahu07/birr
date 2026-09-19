import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@birr/db";
import { DistributionsService } from "../distributions/distributions.service";

export type FinancialReportRequester =
  | { actorType: "birr_staff"; actorUserId: string }
  | { actorType: "founder_user"; actorUserId: string; founderId: string };

/**
 * Computed fresh on every call, never persisted as a "report" row —
 * same posture as ComplianceReportsService.generate(). A thin
 * composition layer over existing summary methods, not new queries
 * reinvented from scratch — see summaryByCause below.
 */
@Injectable()
export class FinancialReportsService {
  constructor(private readonly distributionsService: DistributionsService) {}

  async generate(waqfId: string, requester: FinancialReportRequester) {
    const waqf = await prisma.waqf.findUnique({ where: { id: waqfId } });
    if (!waqf) throw new NotFoundException(`Waqf "${waqfId}" not found.`);

    // Founder ownership check — indistinguishable-from-404, same
    // convention as every other founder-scoped read in this codebase.
    // Done here (not withFounderScope) since nothing below needs RLS —
    // every query after this point is a plain read already scoped by
    // this one verified waqfId.
    if (requester.actorType === "founder_user") {
      const owns = await prisma.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId: requester.founderId } } } },
        select: { id: true },
      });
      if (!owns) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
    }

    const [raisedGrouped, distributionsByCause, proceedsGrouped, causes] = await Promise.all([
      prisma.contribution.groupBy({ by: ["currency"], where: { waqfId, status: "confirmed" }, _sum: { amount: true } }),
      // includeBeneficiaryNames left at its default false — this report
      // is shared verbatim between both dashboards, so it stays
      // uniformly PII-safe rather than building two divergent variants.
      this.distributionsService.summaryByCause(waqfId),
      // 2026-09-16 codebase audit finding: this used to be a single
      // WaqfProceedsService.sumForWaqf(waqfId) call with no currency —
      // the same cross-currency-blending bug found and fixed on the
      // Vault side. Grouped per-currency instead, same shape as `raised`
      // above — a compliance report showing one blended-currency figure
      // is worse than one that never blends currencies to begin with.
      waqf.type === "investment"
        ? prisma.waqfProceeds.groupBy({ by: ["currency"], where: { waqfId }, _sum: { amount: true } })
        : Promise.resolve([]),
      prisma.waqfCause.findMany({
        where: { waqfId, deletedAt: null },
        select: { id: true, name: true, allocatedAmount: true, proceedsAllocatedAmount: true },
      }),
    ]);

    const raised = raisedGrouped.map((g) => ({ currency: g.currency, totalAmount: g._sum.amount ?? new Prisma.Decimal(0) }));
    const proceeds = proceedsGrouped.map((g) => ({ currency: g.currency, totalAmount: g._sum.amount ?? new Prisma.Decimal(0) }));

    // Blended-by-currency total distributed, derived from
    // distributionsByCause rather than a second query — one currency
    // can span several causes, so this sums across causeId, never
    // across currency.
    const distributedByCurrency = new Map<string, Prisma.Decimal>();
    for (const row of distributionsByCause) {
      distributedByCurrency.set(row.currency, (distributedByCurrency.get(row.currency) ?? new Prisma.Decimal(0)).plus(row.totalAmount));
    }
    const distributed = [...distributedByCurrency.entries()].map(([currency, totalAmount]) => ({ currency, totalAmount }));

    // Generating this report is itself a meaningful, traceable event —
    // same reasoning as compliance_report.exported. Doubles as the real
    // signal WaqfsService.getLifecycleStatus's financialReporting stage
    // checks — no separate "was this generated" flag needed.
    await prisma.auditLog.create({
      data: {
        waqfId,
        actorType: requester.actorType,
        actorUserId: requester.actorUserId,
        actorFounderId: requester.actorType === "founder_user" ? requester.founderId : undefined,
        action: "financial_report.exported",
        entityType: "Waqf",
        entityId: waqfId,
      },
    });

    return {
      waqf: {
        id: waqf.id,
        name: waqf.name,
        type: waqf.type,
        jurisdiction: waqf.jurisdiction,
        corpusAmount: waqf.corpusAmount,
        corpusCurrency: waqf.corpusCurrency,
      },
      raised,
      distributed,
      distributionsByCause,
      proceeds,
      causeAllocations: causes,
      generatedAt: new Date(),
    };
  }
}
