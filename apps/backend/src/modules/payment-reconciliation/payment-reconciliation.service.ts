import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";
import { prisma, Prisma, type ReconciliationDirection } from "@birr/db";
import { PaystackReportsClient } from "../../common/payments/paystack-reports.client";
import { holdsAnyRole } from "../../common/auth/staff-roles";
import { NotificationsService } from "../notifications/notifications.service";
import { ContributionsService } from "../contributions/contributions.service";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { ZakahPaymentsService } from "../zakah/zakah-payments.service";
import {
  type BirrPayment,
  type BirrPayout,
  type BirrRefund,
  type IssueDraft,
  type Window,
  compareMoneyIn,
  compareMoneyOut,
  compareRefunds,
} from "./reconciliation-compare";

const DAY_MS = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
/** A run still "running" after this is taken to have died, so the day can be run again. */
const STALE_RUN_MS = 60 * 60 * 1000;
const kobo = (amount: Prisma.Decimal | string | number) => Math.round(Number(amount.toString()) * 100);
const fromKobo = (k: number | null) => (k == null ? null : new Prisma.Decimal(k).div(100));

export class RunReconciliationInput {
  /** The Lagos day to check, "YYYY-MM-DD". */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day!: string;
}

export class ResolveReconciliationIssueInput {
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  note!: string;
}

/** "2026-11-15" → that Lagos day as a UTC window. */
export function windowForDay(day: string): Window {
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - LAGOS_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** The Lagos day a moment falls in. */
export function lagosDay(date: Date): string {
  return new Date(date.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

type Trigger = { type: "scheduler" } | { type: "staff"; userId: string };

/**
 * Daily Paystack reconciliation (owner's decisions, 2026-11-15): money in,
 * money out, and Vault refunds, compared with Birr's own records for one
 * Lagos day. Every mismatch becomes an open issue for Compliance, who are
 * notified. Nothing is corrected automatically; Compliance can ask
 * Paystack again through each product's own safe re-check, and must write
 * a note to resolve an issue.
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly paystack: PaystackReportsClient,
    private readonly notifications: NotificationsService,
    private readonly contributions: ContributionsService,
    private readonly vaultContributions: VaultContributionsService,
    private readonly zakahPayments: ZakahPaymentsService,
  ) {}

  // ─── Running a day ───────────────────────────────────────────────────

  /** The scheduler's hourly check: after 02:00 Lagos, reconcile yesterday if it hasn't been. */
  async runScheduled(now = new Date()) {
    const lagosHour = new Date(now.getTime() + LAGOS_OFFSET_MS).getUTCHours();
    if (lagosHour < 2) return null;
    const day = lagosDay(new Date(now.getTime() - DAY_MS));
    await this.failStaleRuns(now);
    const done = await prisma.paymentReconciliationRun.findFirst({ where: { day, trigger: "scheduler", status: { not: "failed" } } });
    if (done) return null;
    return this.run(day, { type: "scheduler" });
  }

  /** Compliance runs (or re-runs) a past day from the Ops Console. */
  async runForStaff(input: RunReconciliationInput, userId: string) {
    if (input.day > lagosDay(new Date())) throw new BadRequestException("That day hasn't happened yet.");
    await this.failStaleRuns(new Date());
    const running = await prisma.paymentReconciliationRun.findFirst({ where: { day: input.day, status: "running" } });
    if (running) throw new ConflictException("That day is being reconciled right now. Try again in a minute.");
    return this.run(input.day, { type: "staff", userId });
  }

  private async failStaleRuns(now: Date) {
    await prisma.paymentReconciliationRun.updateMany({
      where: { status: "running", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
      data: { status: "failed", error: "Stopped before finishing.", finishedAt: now },
    });
  }

  async run(day: string, trigger: Trigger) {
    const window = windowForDay(day);
    let run;
    try {
      run = await prisma.paymentReconciliationRun.create({
        data: { day, windowStart: window.start, windowEnd: window.end, trigger: trigger.type, startedByUserId: trigger.type === "staff" ? trigger.userId : null },
      });
    } catch (err) {
      // Another server's scheduler claimed this day first (one scheduled run per day).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
      throw err;
    }

    try {
      const { drafts, counts } = await this.compare(window);
      const created = await this.recordIssues(run.id, drafts);
      const finished = await prisma.$transaction(async (tx) => {
        const after = await tx.paymentReconciliationRun.update({
          where: { id: run.id },
          data: { status: drafts.length > 0 ? "issues" : "clean", counts: { ...counts, mismatches: drafts.length, newIssues: created }, finishedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            ...(trigger.type === "staff" ? { actorType: "birr_staff" as const, actorUserId: trigger.userId } : { actorType: "system" as const }),
            action: "payment_reconciliation.run_finished",
            entityType: "PaymentReconciliationRun",
            entityId: run.id,
            after: after as unknown as Prisma.InputJsonValue,
          },
        });
        return after;
      });
      if (created > 0) await this.notifyCompliance(day, created);
      return finished;
    } catch (err) {
      this.logger.error(`Reconciliation for ${day} failed:`, err instanceof Error ? err.stack : String(err));
      return prisma.paymentReconciliationRun.update({
        where: { id: run.id },
        data: { status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : String(err), finishedAt: new Date() },
      });
    }
  }

  /** Both sides for the window, compared. Paystack is read for the day ±1 day; see reconciliation-compare.ts. */
  private async compare(window: Window) {
    const from = new Date(window.start.getTime() - DAY_MS);
    const to = new Date(window.end.getTime() + DAY_MS);
    const [transactions, transfers, refunds] = await Promise.all([
      this.paystack.transactions(from, to),
      this.paystack.transfers(from, to),
      this.paystack.refunds(from, to),
    ]);

    // Money in: Birr's payments from the day, plus any Paystack names.
    const refs = transactions.map((t) => t.reference);
    const created = { createdAt: { gte: window.start, lt: window.end } };
    const inScope = (extra: object) => ({ provider: "paystack" as const, OR: [created, { providerReference: { in: refs } }], ...extra });
    const [contributions, vaultGifts, zakah] = await Promise.all([
      prisma.contribution.findMany({ where: inScope({}), select: { id: true, providerReference: true, status: true, amount: true, currency: true, createdAt: true } }),
      prisma.vaultContribution.findMany({ where: inScope({}), select: { id: true, providerReference: true, status: true, amount: true, currency: true, createdAt: true } }),
      prisma.zakahPayment.findMany({ where: inScope({}), select: { id: true, providerReference: true, status: true, amount: true, feeCover: true, currency: true, createdAt: true } }),
    ]);
    const payments: BirrPayment[] = [
      ...contributions.map((c) => ({ product: "waqf_contribution" as const, id: c.id, reference: c.providerReference, status: c.status, amountKobo: kobo(c.amount), currency: c.currency, createdAt: c.createdAt })),
      ...vaultGifts.map((c) => ({ product: "vault_contribution" as const, id: c.id, reference: c.providerReference, status: c.status, amountKobo: kobo(c.amount), currency: c.currency, createdAt: c.createdAt })),
      ...zakah.map((z) => ({ product: "zakah_payment" as const, id: z.id, reference: z.providerReference, status: z.status, amountKobo: kobo(z.amount) + kobo(z.feeCover), currency: z.currency, createdAt: z.createdAt })),
    ];

    // Money out: Paystack payouts touched that day, plus any Paystack names.
    const transferRefs = transfers.map((t) => t.reference);
    const touched = { OR: [{ updatedAt: { gte: window.start, lt: window.end } }, { paidAt: { gte: window.start, lt: window.end } }, { payoutReference: { in: transferRefs } }] };
    const payoutSelect = { id: true, payoutReference: true, status: true, amount: true, currency: true, updatedAt: true, paidAt: true } as const;
    const [waqfPayouts, vaultPayouts] = await Promise.all([
      prisma.distribution.findMany({ where: { payoutProvider: "paystack", payoutReference: { not: null }, ...touched }, select: payoutSelect }),
      prisma.vaultDistribution.findMany({ where: { payoutProvider: "paystack", payoutReference: { not: null }, ...touched }, select: payoutSelect }),
    ]);
    const payouts: BirrPayout[] = [
      ...waqfPayouts.map((d) => ({ product: "waqf_distribution" as const, id: d.id, reference: d.payoutReference!, status: d.status, amountKobo: kobo(d.amount), currency: d.currency, activityAt: d.paidAt ?? d.updatedAt })),
      ...vaultPayouts.map((d) => ({ product: "vault_distribution" as const, id: d.id, reference: d.payoutReference!, status: d.status, amountKobo: kobo(d.amount), currency: d.currency, activityAt: d.paidAt ?? d.updatedAt })),
    ];

    // Refunds: Vault gifts refunded (or being refunded) that day, plus any Paystack names.
    const refundRefs = refunds.map((r) => r.transactionReference).filter((r): r is string => r != null);
    const refundIds = refunds.map((r) => r.transactionId).filter((r): r is number => r != null).map(String);
    const refunded = await prisma.vaultContribution.findMany({
      where: {
        provider: "paystack",
        OR: [
          { refundStatus: { in: ["refunded", "processing"] }, OR: [{ refundedAt: { gte: window.start, lt: window.end } }, { updatedAt: { gte: window.start, lt: window.end } }] },
          { providerReference: { in: refundRefs } },
          { providerPaymentId: { in: refundIds } },
        ],
      },
      select: { id: true, providerReference: true, providerPaymentId: true, refundStatus: true, amount: true, currency: true, refundedAt: true, updatedAt: true },
    });
    const birrRefunds: BirrRefund[] = refunded
      .filter((r) => r.refundStatus === "refunded" || r.refundStatus === "processing")
      .map((r) => ({ id: r.id, paymentReference: r.providerReference, paymentProviderId: r.providerPaymentId, refundStatus: r.refundStatus!, amountKobo: kobo(r.amount), currency: r.currency, activityAt: r.refundedAt ?? r.updatedAt }));
    const paymentIdToRef = new Map<string, string>([
      ...transactions.map((t) => [String(t.id), t.reference] as [string, string]),
      ...refunded.filter((r) => r.providerPaymentId).map((r) => [r.providerPaymentId!, r.providerReference] as [string, string]),
    ]);

    const drafts = [
      ...compareMoneyIn(transactions, payments, window),
      ...compareMoneyOut(transfers, payouts, window),
      ...compareRefunds(refunds, birrRefunds, paymentIdToRef, window),
    ];
    const counts = {
      in: { paystack: transactions.filter((t) => t.createdAt >= window.start && t.createdAt < window.end).length, birr: payments.filter((p) => p.createdAt >= window.start && p.createdAt < window.end).length },
      out: { paystack: transfers.filter((t) => t.createdAt >= window.start && t.createdAt < window.end).length, birr: payouts.length },
      refunds: { paystack: refunds.filter((r) => r.createdAt >= window.start && r.createdAt < window.end).length, birr: birrRefunds.length },
    };
    return { drafts, counts };
  }

  /** New issues only: one already open for the same kind and reference isn't opened twice. */
  private async recordIssues(runId: string, drafts: IssueDraft[]): Promise<number> {
    if (drafts.length === 0) return 0;
    const result = await prisma.paymentReconciliationIssue.createMany({
      data: drafts.map((d) => ({
        runId,
        direction: d.direction,
        kind: d.kind,
        providerReference: d.providerReference,
        product: d.product,
        recordId: d.recordId,
        paystackStatus: d.paystackStatus,
        paystackAmount: fromKobo(d.paystackAmountKobo),
        birrStatus: d.birrStatus,
        birrAmount: fromKobo(d.birrAmountKobo),
        currency: d.currency,
        detail: d.detail,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  private async notifyCompliance(day: string, count: number) {
    const officers = await prisma.birrStaff.findMany({ where: { status: "active", ...holdsAnyRole("compliance_officer") }, select: { userId: true } });
    await Promise.all(
      officers.map((o) =>
        this.notifications
          .notify({
            recipientType: "birr_staff",
            recipientUserId: o.userId,
            type: "payments.reconciliation_issues",
            title: `Paystack reconciliation: ${count} new mismatch${count === 1 ? "" : "es"}`,
            body: `Checking ${day} against Paystack found ${count} new mismatch${count === 1 ? "" : "es"} between Paystack's records and Birr's.`,
            linkUrl: "/ops/payment-reconciliation",
            relatedEntityType: "PaymentReconciliationRun",
          })
          .catch((err) => this.logger.error("Couldn't notify Compliance of reconciliation issues:", err instanceof Error ? err.stack : String(err))),
      ),
    );
  }

  // ─── Reading and acting ──────────────────────────────────────────────

  listRuns() {
    return prisma.paymentReconciliationRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
      include: { startedBy: { select: { fullName: true } } },
    });
  }

  listIssues(filter: { status?: string; direction?: string }) {
    const directions: ReconciliationDirection[] = ["in", "out", "refund"];
    return prisma.paymentReconciliationIssue.findMany({
      where: {
        status: filter.status === "resolved" ? "resolved" : filter.status === "all" ? undefined : "open",
        ...(directions.includes(filter.direction as ReconciliationDirection) && { direction: filter.direction as ReconciliationDirection }),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { run: { select: { day: true } }, resolvedBy: { select: { fullName: true } } },
    });
  }

  /**
   * "Ask Paystack again" on an incoming payment: the product's own re-check
   * (with its amount check), the same path a giver's return page uses. It
   * may confirm or fail the payment; it never resolves the issue.
   */
  async recheck(issueId: string, userId: string) {
    const issue = await prisma.paymentReconciliationIssue.findUnique({ where: { id: issueId } });
    if (!issue) throw new NotFoundException("Issue not found.");
    if (issue.direction !== "in" || !issue.recordId || !issue.product) {
      throw new BadRequestException("Only an incoming payment Birr has a record of can be checked with Paystack again.");
    }
    const before = issue.birrStatus;
    const record =
      issue.product === "waqf_contribution"
        ? await this.contributions.reconcile(issue.recordId)
        : issue.product === "vault_contribution"
          ? await this.vaultContributions.reconcile(issue.recordId)
          : await this.zakahPayments.reconcile(issue.recordId);
    const now = (record as { status?: string } | null)?.status ?? null;
    await prisma.auditLog.create({
      data: {
        actorType: "birr_staff",
        actorUserId: userId,
        action: "payment_reconciliation.issue_rechecked",
        entityType: "PaymentReconciliationIssue",
        entityId: issue.id,
        after: { product: issue.product, recordId: issue.recordId, birrStatusBefore: before, birrStatusNow: now },
      },
    });
    return { issueId: issue.id, birrStatusBefore: before, birrStatusNow: now };
  }

  async resolve(issueId: string, input: ResolveReconciliationIssueInput, userId: string) {
    return prisma.$transaction(async (tx) => {
      const issue = await tx.paymentReconciliationIssue.findUnique({ where: { id: issueId } });
      if (!issue) throw new NotFoundException("Issue not found.");
      const claim = await tx.paymentReconciliationIssue.updateMany({
        where: { id: issueId, status: "open" },
        data: { status: "resolved", resolvedAt: new Date(), resolvedByUserId: userId, resolutionNote: input.note.trim() },
      });
      if (claim.count !== 1) throw new ConflictException("This issue is already resolved.");
      const after = await tx.paymentReconciliationIssue.findUniqueOrThrow({ where: { id: issueId } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId: userId,
          action: "payment_reconciliation.issue_resolved",
          entityType: "PaymentReconciliationIssue",
          entityId: issueId,
          before: issue as unknown as Prisma.InputJsonValue,
          after: after as unknown as Prisma.InputJsonValue,
        },
      });
      return after;
    });
  }
}
