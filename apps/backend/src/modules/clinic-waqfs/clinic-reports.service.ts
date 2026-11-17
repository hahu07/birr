import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { IsInt, Matches, Max, Min } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { TextField } from "../../common/validation/fields";
import { lagosToday } from "../counterparties/counterparty-licenses.service";
import { ClinicLedgerService } from "./clinic-ledger.service";

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const COUNT_MAX = 1_000_000;
const MONTHS_SHOWN = 12;

export class RecordClinicReportInput {
  @TextField(7)
  @Matches(PERIOD, { message: "period must be a month like 2027-03." })
  period!: string;

  @IsInt()
  @Min(0)
  @Max(COUNT_MAX)
  visits!: number;

  @IsInt()
  @Min(0)
  @Max(COUNT_MAX)
  childrenImmunised!: number;

  @IsInt()
  @Min(0)
  @Max(COUNT_MAX)
  testsRun!: number;

  @IsInt()
  @Min(0)
  @Max(COUNT_MAX)
  referrals!: number;
}

const zero = () => new Prisma.Decimal(0);
const userName = { select: { id: true, fullName: true } };

/** The last n months, newest first, ending with this Lagos month. */
function recentMonths(n: number) {
  const [y, m] = lagosToday().split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * A clinic waqf's monthly reports and public report (2026-11-17, clinic
 * slice 8).
 *
 * - Monthly figures: a Mutawalli Officer records the operator's visits,
 *   children immunised, tests run and referrals (clinic_waqf.report_record);
 *   Compliance or the Audit Committee publishes them
 *   (clinic_waqf.report_publish), never whoever recorded them.
 * - The public report: the endowment, the running fund and zakah, each
 *   shown on its own, from the ledger and approved claims; published
 *   figures; targets. Nothing about any giver or patient.
 */
@Injectable()
export class ClinicReportsService {
  constructor(private readonly ledger: ClinicLedgerService) {}

  async record(clinicWaqfId: string, input: RecordClinicReportInput, actorUserId: string) {
    if (input.period > lagosToday().slice(0, 7)) throw new BadRequestException("A report can't be for a month that hasn't started.");
    return prisma.$transaction(async (tx) => {
      const clinic = await tx.clinicWaqf.findUnique({ where: { id: clinicWaqfId } });
      if (!clinic) throw new NotFoundException(`Clinic waqf "${clinicWaqfId}" not found.`);
      if (clinic.status !== "established") throw new BadRequestException(`${clinic.name} isn't established yet.`);
      const existing = await tx.clinicMonthlyReport.findFirst({ where: { clinicWaqfId, period: input.period, status: { in: ["draft", "published"] } } });
      if (existing) {
        throw new ConflictException(
          existing.status === "published" ? "That month's figures are already published." : "That month already has a draft. Publish or discard it first.",
        );
      }
      const report = await tx.clinicMonthlyReport.create({ data: { clinicWaqfId, ...input, recordedByUserId: actorUserId } });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_report.recorded", entityType: "ClinicMonthlyReport", entityId: report.id, after: report as any },
      });
      return report;
    });
  }

  publish(clinicWaqfId: string, reportId: string, actorUserId: string) {
    return this.decide(clinicWaqfId, reportId, actorUserId, "published");
  }

  discard(clinicWaqfId: string, reportId: string, actorUserId: string) {
    return this.decide(clinicWaqfId, reportId, actorUserId, "discarded");
  }

  private async decide(clinicWaqfId: string, reportId: string, actorUserId: string, status: "published" | "discarded") {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "clinic_monthly_reports" WHERE "id" = ${reportId} FOR UPDATE`;
      const before = await tx.clinicMonthlyReport.findUnique({ where: { id: reportId } });
      if (!before || before.clinicWaqfId !== clinicWaqfId) throw new NotFoundException(`Report "${reportId}" not found.`);
      if (before.status !== "draft") throw new BadRequestException(`This report is already ${before.status}.`);
      if (status === "published" && before.recordedByUserId === actorUserId) {
        throw new ForbiddenException("You recorded these figures, so someone else must check and publish them.");
      }
      const after = await tx.clinicMonthlyReport.update({
        where: { id: reportId },
        data: status === "published" ? { status, publishedByUserId: actorUserId, publishedAt: new Date() } : { status },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: `clinic_report.${status}`, entityType: "ClinicMonthlyReport", entityId: reportId, before: before as any, after: after as any },
      });
      return after;
    });
  }

  list(clinicWaqfId: string) {
    return prisma.clinicMonthlyReport.findMany({
      where: { clinicWaqfId },
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      include: { recordedByUser: userName, publishedByUser: userName },
    });
  }

  /** The public report. Only established clinics have one. */
  async publicReport(slug: string) {
    const clinic = await prisma.clinicWaqf.findUnique({ where: { slug } });
    if (!clinic || clinic.status !== "established") throw new NotFoundException("Clinic not found.");
    const balances = await this.ledger.balances(clinic.id);
    const all = [...balances.endowment, ...balances.running];
    const bal = (code: string) => all.find((a) => a.code === code)?.balance ?? "0.00";

    const month = lagosToday().slice(0, 7);
    // Lagos is UTC+1 all year.
    const monthStart = new Date(`${month}-01T00:00:00+01:00`);
    const thisMonth = await prisma.clinicJournalEntryLine.aggregate({
      where: { journalEntry: { clinicWaqfId: clinic.id, currency: "NGN", entryDate: { gte: monthStart } }, ledgerAccount: { code: { in: ["4000", "4100"] } } },
      _sum: { credit: true, debit: true },
    });
    const runningThisMonth = (thisMonth._sum.credit ?? zero()).minus(thisMonth._sum.debit ?? 0);

    const zakahPaid = await prisma.clinicClaim.aggregate({
      where: { clinicWaqfId: clinic.id, zakahDistribution: { status: "paid" } },
      _sum: { zakahAmount: true },
    });

    const months = recentMonths(MONTHS_SHOWN);
    const [reports, claims] = await Promise.all([
      prisma.clinicMonthlyReport.findMany({ where: { clinicWaqfId: clinic.id, status: "published", period: { in: months } } }),
      prisma.clinicClaim.findMany({
        where: { clinicWaqfId: clinic.id, status: { in: ["approved", "paid"] }, period: { in: months } },
        include: { priceList: { select: { content: true } }, lines: { select: { visitReference: true, serviceCode: true, subsidy: true, zakahEligible: true } } },
      }),
    ]);

    const byMonth = months
      .map((period) => {
        const report = reports.find((r) => r.period === period);
        const claim = claims.find((c) => c.period === period);
        let subsidised = null;
        if (claim) {
          const names = new Map((JSON.parse(claim.priceList.content).services as { code: string; name: string }[]).map((s) => [s.code, s.name]));
          const counts = new Map<string, number>();
          for (const l of claim.lines) if (l.subsidy.gt(0)) counts.set(l.serviceCode, (counts.get(l.serviceCode) ?? 0) + 1);
          subsidised = {
            patients: new Set(claim.lines.filter((l) => l.subsidy.gt(0)).map((l) => l.visitReference)).size,
            byService: [...counts].map(([code, visits]) => ({ service: names.get(code) ?? code, visits })).sort((a, b) => b.visits - a.visits),
            fromRunningFund: claim.runningFundAmount.toFixed(2),
            fromZakah: claim.zakahAmount.toFixed(2),
          };
        }
        return {
          period,
          figures: report ? { visits: report.visits, childrenImmunised: report.childrenImmunised, testsRun: report.testsRun, referrals: report.referrals } : null,
          subsidised,
        };
      })
      .filter((m) => m.figures || m.subsidised);

    return {
      clinic: { name: clinic.name, slug: clinic.slug, city: clinic.city, description: clinic.description },
      currency: "NGN",
      targets: { endowment: clinic.endowmentTarget?.toFixed(2) ?? null, runningMonthly: clinic.runningMonthlyTarget?.toFixed(2) ?? null },
      // Kept for ever: what's been endowed, and what it's held as.
      endowment: { endowed: bal("3000"), cash: bal("1000"), invested: bal("1200"), premisesAndEquipment: bal("1500") },
      // Spent on care: what came in (gifts and the endowment's income) and where it went.
      running: {
        gifts: bal("4000"),
        endowmentIncome: bal("4100"),
        receivedThisMonth: runningThisMonth.toFixed(2),
        subsidisedVisits: bal("5000"),
        runningCosts: bal("5100"),
        cash: bal("1100"),
      },
      // Zakah, never part of the waqf: paid for poor or needy patients' bills.
      zakah: { paidForPatients: (zakahPaid._sum.zakahAmount ?? zero()).toFixed(2) },
      months: byMonth,
    };
  }
}
