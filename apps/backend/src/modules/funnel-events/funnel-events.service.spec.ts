import { prisma } from "@birr/db";
import { FunnelEventsService } from "./funnel-events.service";

describe("FunnelEventsService", () => {
  const service = new FunnelEventsService();
  const eventIds: string[] = [];
  let founderId: string;

  beforeAll(async () => {
    const founder = await prisma.founder.create({ data: { name: "Funnel Event Fixture Founder", kind: "institution" } });
    founderId = founder.id;
  });

  afterAll(async () => {
    await prisma.funnelEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.founder.deleteMany({ where: { id: founderId } });
    await prisma.$disconnect();
  });

  test("record() writes a row with the given funnel, step, and correlation ids", async () => {
    await service.record({
      funnel: "founder",
      step: "signup_completed",
      sessionId: founderId,
      founderId,
      metadata: { source: "test" },
    });

    const rows = await prisma.funnelEvent.findMany({ where: { founderId, step: "signup_completed" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].funnel).toBe("founder");
    expect(rows[0].sessionId).toBe(founderId);
    expect(rows[0].metadata).toEqual({ source: "test" });
    eventIds.push(...rows.map((r) => r.id));
  });

  test("report() returns every canonical step in order, including zero-count ones, and counts a new event", async () => {
    // Deltas rather than absolute counts — this table already carries
    // rows from other specs/manual runs, and this assertion has to hold
    // regardless of what else has landed in it.
    const before = await service.report();
    expect(before.founder.map((s) => s.step)).toEqual([
      "signup_started",
      "signup_completed",
      "foundation_created",
      "deed_signed",
      "waqf_fund_created",
    ]);
    expect(before.vault.map((s) => s.step)).toEqual([
      "page_viewed",
      "checkout_started",
      "contribution_initiated",
      "contribution_confirmed",
    ]);
    const beforeCount = before.founder.find((s) => s.step === "signup_completed")!.count;

    await service.record({ funnel: "founder", step: "signup_completed", sessionId: founderId, founderId });
    const [row] = await prisma.funnelEvent.findMany({
      where: { founderId, step: "signup_completed" },
      orderBy: { occurredAt: "desc" },
      take: 1,
    });
    eventIds.push(row.id);

    const after = await service.report();
    const afterCount = after.founder.find((s) => s.step === "signup_completed")!.count;
    expect(afterCount).toBe(beforeCount + 1);
  });

  test("report() scopes to events at or after a given `since` date", async () => {
    const since = new Date(Date.now() + 60_000); // one minute in the future — nothing can be at or after it yet
    const report = await service.report(since);
    expect(report.founder.every((s) => s.count === 0)).toBe(true);
    expect(report.vault.every((s) => s.count === 0)).toBe(true);
  });

  test("record() never throws, even when the write itself would fail", async () => {
    // No such founderId — the foreign key doesn't exist, so the insert
    // fails at the DB layer. record() must swallow this, not propagate
    // it into whatever real action just happened to trigger it.
    await expect(
      service.record({
        funnel: "vault",
        step: "contribution_confirmed",
        sessionId: "does-not-exist",
        founderId: "00000000-0000-0000-0000-000000000000",
      }),
    ).resolves.toBeUndefined();
  });
});
