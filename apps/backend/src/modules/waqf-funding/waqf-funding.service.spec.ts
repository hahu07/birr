import { prisma } from "@birr/db";
import { WaqfFundingService } from "./waqf-funding.service";

describe("WaqfFundingService", () => {
  const service = new WaqfFundingService();

  // A distinctive per-run currency code, not a real one — this is a
  // shared dev DB with pre-existing CorpusMinimum/ContributionMinimum
  // rows for real currencies (from packages/db/prisma/seed-data.ts),
  // and both models' currency column is the primary key equivalent
  // (@@unique/@id), so reusing a real currency code here would collide
  // with seeded data rather than exercising a clean create path.
  const currency = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;

  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `waqf-funding-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "platform_admin" },
    });
  });

  afterAll(async () => {
    await prisma.corpusMinimum.deleteMany({ where: { currency } });
    await prisma.contributionMinimum.deleteMany({ where: { currency } });
    await prisma.$disconnect();
  });

  test("upsertCorpusMinimum() creates on first call and writes a *.created audit log", async () => {
    const created = await service.upsertCorpusMinimum(currency, { minAmount: "1000" }, actorUserId);
    expect(created.minAmount.toString()).toBe("1000");

    const logs = await prisma.auditLog.findMany({ where: { entityId: created.id, action: "corpus_minimum.created" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, before: null });
  });

  test("upsertCorpusMinimum() updates on a second call and writes a *.updated audit log with a before snapshot", async () => {
    const updated = await service.upsertCorpusMinimum(currency, { minAmount: "2000" }, actorUserId);
    expect(updated.minAmount.toString()).toBe("2000");

    const logs = await prisma.auditLog.findMany({ where: { entityId: updated.id, action: "corpus_minimum.updated" } });
    expect(logs).toHaveLength(1);
    // The before/after snapshot is a JSONB column — a Prisma.Decimal
    // serializes into it as a plain JSON number, not the Decimal-typed
    // string every other field on the live row would show.
    expect(logs[0].before).toMatchObject({ minAmount: 1000 });
  });

  test("listCorpusMinimums() includes the fixture currency", async () => {
    const list = await service.listCorpusMinimums();
    expect(list.some((m) => m.currency === currency)).toBe(true);
  });

  test("upsertContributionMinimum() creates on first call and writes a *.created audit log", async () => {
    const created = await service.upsertContributionMinimum(currency, { minAmount: "10" }, actorUserId);
    expect(created.minAmount.toString()).toBe("10");

    const logs = await prisma.auditLog.findMany({ where: { entityId: created.id, action: "contribution_minimum.created" } });
    expect(logs).toHaveLength(1);
  });

  test("upsertContributionMinimum() updates on a second call", async () => {
    const updated = await service.upsertContributionMinimum(currency, { minAmount: "25" }, actorUserId);
    expect(updated.minAmount.toString()).toBe("25");

    const logs = await prisma.auditLog.findMany({ where: { entityId: updated.id, action: "contribution_minimum.updated" } });
    expect(logs).toHaveLength(1);
  });

  test("listContributionMinimums() includes the fixture currency", async () => {
    const list = await service.listContributionMinimums();
    expect(list.some((m) => m.currency === currency)).toBe(true);
  });

  test("getSettings() returns the singleton row, creating it if somehow missing", async () => {
    const settings = await service.getSettings();
    expect(settings.id).toBeDefined();
    expect(settings.installmentMinimumPercent).toBeDefined();

    // Calling again must return the SAME row, not create a second one —
    // proves the "singleton, create only if truly missing" guarantee.
    const again = await service.getSettings();
    expect(again.id).toBe(settings.id);
  });

  test("updateSettings() updates the singleton and writes an audit log with a before snapshot", async () => {
    const before = await service.getSettings();
    const updated = await service.updateSettings({ installmentMinimumPercent: "40" }, actorUserId);
    expect(updated.id).toBe(before.id);
    expect(updated.installmentMinimumPercent.toString()).toBe("40");

    const logs = await prisma.auditLog.findMany({
      where: { entityId: updated.id, action: "waqf_funding_settings.updated" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId });

    // Restore the shared singleton's original percentage so this spec
    // doesn't leave global funding config mutated for every other test
    // run against this shared dev database.
    await service.updateSettings({ installmentMinimumPercent: before.installmentMinimumPercent.toString() }, actorUserId);
  });
});
