import { prisma } from "@birr/db";
import { AssetsService } from "./assets.service";

describe("AssetsService", () => {
  const service = new AssetsService();

  const assetIds: string[] = [];
  const waqfIds: string[] = [];

  let waqfId: string;
  let actorUserId: string;
  let founderId: string;
  let otherFounderId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `assets-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const foundation = await prisma.foundation.create({
      data: { name: "Assets Fixture Foundation" },
    });
    const waqf = await prisma.waqf.create({
      data: { name: "Assets Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);

    // A second, unrelated Founder for listForFounder()'s own isolation
    // test below — confirms a founder can never read another founder's
    // assets by guessing/enumerating a waqfId.
    const founder = await prisma.founder.create({ data: { name: "Assets Fixture Founder", kind: "institution" } });
    founderId = founder.id;
    await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId } });
    const otherFounder = await prisma.founder.create({ data: { name: "Assets Fixture Other Founder", kind: "institution" } });
    otherFounderId = otherFounder.id;
  });

  afterAll(async () => {
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("create() writes the asset and a matching audit_logs record for a birr_staff actor", async () => {
    const asset = await service.create(
      { waqfId, name: "Fixture Asset", category: "cash", estimatedValue: "100" },
      { actorType: "birr_staff", actorUserId },
    );
    assetIds.push(asset.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: asset.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "Asset",
      action: "asset.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });

  test("create() writes a matching audit_logs record for a system actor (webhook-triggered path)", async () => {
    const asset = await service.create(
      { waqfId, name: "Fixture System Asset", category: "cash", estimatedValue: "50" },
      { actorType: "system" },
    );
    assetIds.push(asset.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: asset.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "Asset",
      action: "asset.created",
      actorType: "system",
      actorUserId: null,
    });
  });

  // Regression coverage for the 2026-08-31 codebase audit finding:
  // listForFounder() had no test at all, unlike its sibling
  // WaqfCausesService.listForFounder/InvestmentsService.list — a
  // regression dropping the ownership WHERE clause or RLS binding here
  // would have gone undetected.
  describe("listForFounder()", () => {
    test("returns the waqf's own assets for the founder that owns it", async () => {
      const asset = await service.create(
        { waqfId, name: "Founder-Scoped Fixture Asset", category: "cash", estimatedValue: "75" },
        { actorType: "birr_staff", actorUserId },
      );
      assetIds.push(asset.id);

      const result = await service.listForFounder(waqfId, founderId);
      expect(result?.map((a) => a.id)).toContain(asset.id);
    });

    test("returns null for a founder who doesn't own the waqf (isolation)", async () => {
      const result = await service.listForFounder(waqfId, otherFounderId);
      expect(result).toBeNull();
    });
  });
});
