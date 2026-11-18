import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma, type WaqfProgrammeProduct } from "@birr/db";
import { lagosToday } from "../counterparties/counterparty-licenses.service";
import { ProgrammeLedgerService } from "./programme-ledger.service";

/**
 * A waqf programme's public report, each pot on its own, from its ledger
 * (need-based NB4, 2026-11-19). The clinic keeps its own, fuller report
 * (claims, subsidised visits, monthly figures: ClinicReportsService); this
 * one serves products without those parts.
 *
 * The need-based waqf launches giving first, so its report shows what has
 * been given and what's held, and nothing about support until support
 * starts. Nothing about any giver or member of staff is shown.
 */
@Injectable()
export class ProgrammeReportService {
  constructor(private readonly ledger: ProgrammeLedgerService) {}

  async publicReport(product: WaqfProgrammeProduct, slug: string) {
    const programme = await prisma.waqfProgramme.findUnique({ where: { slug } });
    if (!programme || programme.status !== "established" || programme.product !== product) throw new NotFoundException("Not found.");
    const balances = await this.ledger.balances(programme.id);
    const all = [...balances.endowment, ...balances.running];
    const bal = (code: string) => all.find((a) => a.code === code)?.balance ?? "0.00";

    // Received this month into the running pot (gifts and the endowment's income).
    const month = lagosToday().slice(0, 7);
    // Lagos is UTC+1 all year.
    const monthStart = new Date(`${month}-01T00:00:00+01:00`);
    const thisMonth = await prisma.programmeJournalEntryLine.aggregate({
      where: { journalEntry: { programmeId: programme.id, currency: "NGN", entryDate: { gte: monthStart } }, ledgerAccount: { code: { in: ["4000", "4100"] } } },
      _sum: { credit: true, debit: true },
    });
    const receivedThisMonth = (thisMonth._sum.credit ?? new Prisma.Decimal(0)).minus(thisMonth._sum.debit ?? 0);

    return {
      programme: { name: programme.name, slug: programme.slug, city: programme.city, description: programme.description, product: programme.product },
      currency: "NGN",
      targets: { endowment: programme.endowmentTarget?.toFixed(2) ?? null, runningMonthly: programme.runningMonthlyTarget?.toFixed(2) ?? null },
      // Kept for ever: what's been endowed, and what it's held as.
      endowment: { endowed: bal("3000"), cash: bal("1000"), invested: bal("1200") },
      // The running pot (a need-based waqf's spending fund): what came in, and what's held for support.
      running: { gifts: bal("4000"), endowmentIncome: bal("4100"), receivedThisMonth: receivedThisMonth.toFixed(2), held: bal("1100") },
    };
  }
}
