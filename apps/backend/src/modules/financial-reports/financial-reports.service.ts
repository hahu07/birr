import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@birr/db";
import { DistributionsService } from "../distributions/distributions.service";
import { WaqfProceedsService } from "../waqf-proceeds/waqf-proceeds.service";

export type FinancialReportRequester =
  | { actorType: "birr_staff"; actorUserId: string }
  | { actorType: "founder_user"; actorUserId: string; founderId: string };

/**
 * Computed fresh on every call, never persisted as a "report" row —
 * same posture as ComplianceReportsService.generate(). A thin
 * composition layer over existing summary methods, not new queries
 * reinvented from scratch — see summaryByCause/sumForWaqf below.
 */
@Injectable()
export class FinancialReportsService {
  constructor(
    private readonly distributionsService: DistributionsService,
    private readonly waqfProceedsService: WaqfProceedsService,
  ) {}

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

    const [raisedGrouped, distributionsByCause, proceedsTotal, causes] = await Promise.all([
      prisma.contribution.groupBy({ by: ["currency"], where: { waqfId, status: "confirmed" }, _sum: { amount: true } }),
      // includeBeneficiaryNames left at its default false — this report
      // is shared verbatim between both dashboards, so it stays
      // uniformly PII-safe rather than building two divergent variants.
      this.distributionsService.summaryByCause(waqfId),
      waqf.type === "investment" ? this.waqfProceedsService.sumForWaqf(waqfId) : Promise.resolve(null),
      prisma.waqfCause.findMany({
        where: { waqfId, deletedAt: null },
        select: { id: true, name: true, allocatedAmount: true, proceedsAllocatedAmount: true },
      }),
    ]);

    const raised = raisedGrouped.map((g) => ({ currency: g.currency, totalAmount: g._sum.amount ?? new Prisma.Decimal(0) }));

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
      proceeds: proceedsTotal !== null ? { total: proceedsTotal } : null,
      causeAllocations: causes,
      generatedAt: new Date(),
    };
  }
}
