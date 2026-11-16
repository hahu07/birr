import { ConflictException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { PaymentReconciliationService, windowForDay } from "./payment-reconciliation.service";
import type { PaystackReportsClient, PaystackTransactionRecord } from "../../common/payments/paystack-reports.client";
import { createFakeNotificationsServiceWithSpies } from "../notifications/test-support/fake-notifications-service";

/**
 * Against the dev database, with Paystack faked. Each run checks a day far
 * in the past that only this file's fixtures fall in, so nothing else in
 * the shared database shows up.
 */
describe("PaymentReconciliationService", () => {
  const run = Date.now();
  let n = 0;
  /** A distinct past day per test, so reruns of this file never collide. */
  const nextDay = () => {
    const d = new Date(Date.UTC(1990, 0, 1) + ((run / 1000 + n++ * 7919) % 7000) * 86_400_000);
    return d.toISOString().slice(0, 10);
  };

  let paystackTransactions: PaystackTransactionRecord[] = [];
  const paystack = {
    transactions: async () => paystackTransactions,
    transfers: async () => [],
    refunds: async () => [],
  } as unknown as PaystackReportsClient;
  const vaultReconcile = jest.fn(async (id: string) => ({ id, status: "confirmed" }));
  const { service: notifications } = createFakeNotificationsServiceWithSpies();
  const service = new PaymentReconciliationService(
    paystack,
    notifications,
    { reconcile: jest.fn() } as any,
    { reconcile: vaultReconcile } as any,
    { reconcile: jest.fn() } as any,
  );

  let userId: string;
  let vaultId: string;
  const runIds: string[] = [];
  const giftIds: string[] = [];

  async function gift(reference: string, day: string, status: "confirmed" | "pending" = "confirmed") {
    const { start } = windowForDay(day);
    const row = await prisma.vaultContribution.create({
      data: { vaultId, amount: "250000", currency: "NGN", provider: "paystack", providerReference: reference, status, createdAt: new Date(start.getTime() + 3_600_000) },
    });
    giftIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `recon-${run}@example.com`, fullName: "Recon Officer" } });
    userId = user.id;
    await prisma.birrStaff.create({ data: { userId, roles: { create: { role: "compliance_officer" } } } });
    const vault = await prisma.vault.create({
      data: { name: "Recon Fixture Vault", slug: `recon-fixture-${run}`, type: "project", currency: "NGN", jurisdiction: "NG", createdByUserId: userId },
    });
    vaultId = vault.id;
  });

  afterAll(async () => {
    await prisma.paymentReconciliationIssue.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.paymentReconciliationRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.vaultContribution.deleteMany({ where: { id: { in: giftIds } } });
    await prisma.vault.deleteMany({ where: { id: vaultId } });
    await prisma.$disconnect();
  });

  test("a day where both sides agree is clean, and audited", async () => {
    const day = nextDay();
    const row = await gift(`recon-ok-${run}`, day);
    paystackTransactions = [{ id: 1, reference: row.providerReference, status: "success", amount: 25_000_000, currency: "NGN", createdAt: row.createdAt }];
    const result = await service.run(day, { type: "staff", userId });
    runIds.push(result!.id);
    expect(result).toMatchObject({ status: "clean", day });
    expect(result!.counts).toMatchObject({ in: { paystack: 1, birr: 1 }, mismatches: 0 });
    expect(await prisma.auditLog.count({ where: { entityId: result!.id, action: "payment_reconciliation.run_finished", actorUserId: userId } })).toBe(1);
  });

  test("mismatches become open issues, Compliance is told, and a re-run doesn't open them twice", async () => {
    const day = nextDay();
    const confirmedOnlyAtBirr = await gift(`recon-birr-only-${run}`, day);
    const pendingAtBirr = await gift(`recon-pending-${run}`, day, "pending");
    const { start } = windowForDay(day);
    paystackTransactions = [
      { id: 2, reference: pendingAtBirr.providerReference, status: "success", amount: 25_000_000, currency: "NGN", createdAt: new Date(start.getTime() + 3_600_000) },
      { id: 3, reference: `recon-paystack-only-${run}`, status: "success", amount: 10_000_000, currency: "NGN", createdAt: new Date(start.getTime() + 7_200_000) },
    ];

    const first = await service.run(day, { type: "staff", userId });
    runIds.push(first!.id);
    expect(first).toMatchObject({ status: "issues" });
    const issues = await prisma.paymentReconciliationIssue.findMany({ where: { runId: first!.id }, orderBy: { kind: "asc" } });
    expect(issues.map((i) => [i.kind, i.providerReference])).toEqual([
      ["in_missing_in_birr", `recon-paystack-only-${run}`],
      ["in_missing_at_paystack", confirmedOnlyAtBirr.providerReference],
      ["in_status_mismatch", pendingAtBirr.providerReference],
    ]);
    expect(issues.every((i) => i.status === "open")).toBe(true);

    const again = await service.run(day, { type: "staff", userId });
    runIds.push(again!.id);
    expect(again!.counts).toMatchObject({ mismatches: 3, newIssues: 0 });
    expect(await prisma.paymentReconciliationIssue.count({ where: { runId: again!.id } })).toBe(0);
  });

  test("Ask Paystack again goes through the product's own re-check; resolving needs a note and is audited", async () => {
    const day = nextDay();
    const pending = await gift(`recon-recheck-${run}`, day, "pending");
    paystackTransactions = [{ id: 4, reference: pending.providerReference, status: "success", amount: 25_000_000, currency: "NGN", createdAt: pending.createdAt }];
    const result = await service.run(day, { type: "staff", userId });
    runIds.push(result!.id);
    const issue = await prisma.paymentReconciliationIssue.findFirstOrThrow({ where: { runId: result!.id } });

    expect(await service.recheck(issue.id, userId)).toMatchObject({ birrStatusBefore: "pending", birrStatusNow: "confirmed" });
    expect(vaultReconcile).toHaveBeenCalledWith(pending.id);
    // Re-checking never resolves the issue by itself.
    expect((await prisma.paymentReconciliationIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("open");

    const resolved = await service.resolve(issue.id, { note: "Webhook was late; Paystack confirms paid, now confirmed at Birr." }, userId);
    expect(resolved).toMatchObject({ status: "resolved", resolvedByUserId: userId });
    expect(await prisma.auditLog.count({ where: { entityId: issue.id, action: "payment_reconciliation.issue_resolved" } })).toBe(1);
    await expect(service.resolve(issue.id, { note: "again please" }, userId)).rejects.toThrow(ConflictException);

    // The database won't accept a resolution without who and why.
    const other = await prisma.paymentReconciliationIssue.create({
      data: { runId: result!.id, direction: "in", kind: "in_amount_mismatch", providerReference: `recon-db-check-${run}`, detail: "fixture" },
    });
    await expect(prisma.paymentReconciliationIssue.update({ where: { id: other.id }, data: { status: "resolved" } })).rejects.toThrow();
  });

  test("two scheduled runs of the same day don't both run", async () => {
    const day = nextDay();
    paystackTransactions = [];
    const [a, b] = await Promise.all([service.run(day, { type: "scheduler" }), service.run(day, { type: "scheduler" })]);
    for (const r of [a, b]) if (r) runIds.push(r.id);
    expect([a, b].filter((r) => r !== null)).toHaveLength(1);
  });

  test("a failed Paystack read leaves a failed run, so the day can be run again", async () => {
    const day = nextDay();
    const broken = new PaymentReconciliationService(
      { transactions: async () => Promise.reject(new Error("Paystack is down")), transfers: async () => [], refunds: async () => [] } as unknown as PaystackReportsClient,
      notifications,
      {} as any,
      {} as any,
      {} as any,
    );
    const failed = await broken.run(day, { type: "scheduler" });
    runIds.push(failed!.id);
    expect(failed).toMatchObject({ status: "failed", error: "Paystack is down" });
    paystackTransactions = [];
    const retried = await service.run(day, { type: "scheduler" });
    runIds.push(retried!.id);
    expect(retried).toMatchObject({ status: "clean" });
  });
});
