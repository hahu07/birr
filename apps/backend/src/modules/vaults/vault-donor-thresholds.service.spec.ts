import { prisma } from "@birr/db";
import { VaultDonorThresholdsService } from "./vault-donor-thresholds.service";

// Mirrors WaqfFundingService's own upsertContributionMinimum/
// upsertCorpusMinimum spec exactly — same "real ops-editable table,
// create vs. update audit action, before/after snapshot" shape. This
// one has no test coverage at all before this (found in a codebase
// audit) despite being the table VaultContributionsService.
// findOrCreateDonor's AML anti-structuring check reads directly —
// compliance-load-bearing code, not just settings CRUD.
describe("VaultDonorThresholdsService", () => {
  const service = new VaultDonorThresholdsService();

  // A distinctive per-run currency code, not a real one — this is a
  // shared dev DB with pre-existing VaultDonorThreshold rows for real
  // currencies (packages/db/prisma/seed-data.ts), and currency is that
  // table's unique key, so reusing a real code would collide with
  // seeded data rather than exercising a clean create path.
  const currency = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;

  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `vault-donor-thresholds-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "compliance_officer" } });
  });

  afterAll(async () => {
    await prisma.vaultDonorThreshold.deleteMany({ where: { currency } });
    await prisma.$disconnect();
  });

  test("upsert() creates on first call and writes a *.created audit log", async () => {
    const created = await service.upsert(currency, { thresholdAmount: "1000" }, actorUserId);
    expect(created.thresholdAmount.toString()).toBe("1000");

    const logs = await prisma.auditLog.findMany({ where: { entityId: created.id, action: "vault_donor_threshold.created" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, before: null });
  });

  test("upsert() updates on a second call and writes a *.updated audit log with a before snapshot", async () => {
    const updated = await service.upsert(currency, { thresholdAmount: "2000" }, actorUserId);
    expect(updated.thresholdAmount.toString()).toBe("2000");

    const logs = await prisma.auditLog.findMany({ where: { entityId: updated.id, action: "vault_donor_threshold.updated" } });
    expect(logs).toHaveLength(1);
    // The before/after snapshot is a JSONB column — a Prisma.Decimal
    // serializes into it as a plain JSON number, not the Decimal-typed
    // string every other field on the live row would show.
    expect(logs[0].before).toMatchObject({ thresholdAmount: 1000 });
  });

  test("list() includes the fixture currency", async () => {
    const list = await service.list();
    expect(list.some((t) => t.currency === currency)).toBe(true);
  });
});
