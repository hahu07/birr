import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
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
      data: { name: "Assets Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
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

  test("create() derives currency from the waqf's own corpusCurrency, never client-supplied", async () => {
    const asset = await service.create(
      { waqfId, name: "Currency Derivation Fixture Asset", category: "cash", estimatedValue: "100" },
      { actorType: "birr_staff", actorUserId },
    );
    assetIds.push(asset.id);
    expect(asset.currency).toBe("USD");
  });

  test("create() rejects an unknown waqfId", async () => {
    await expect(
      service.create(
        { waqfId: "00000000-0000-0000-0000-000000000000", name: "Orphan Fixture Asset", category: "cash", estimatedValue: "100" },
        { actorType: "birr_staff", actorUserId },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  test("create() rejects a waqf with no declared corpus currency yet", async () => {
    const foundation = await prisma.foundation.create({
      data: { name: "Assets No-Currency Fixture Foundation" },
    });
    const noCurrencyWaqf = await prisma.waqf.create({
      data: { name: "Assets No-Currency Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfIds.push(noCurrencyWaqf.id);

    await expect(
      service.create(
        { waqfId: noCurrencyWaqf.id, name: "Should Not Be Created", category: "cash", estimatedValue: "100" },
        { actorType: "birr_staff", actorUserId },
      ),
    ).rejects.toThrow(BadRequestException);
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

  // Regression coverage for a 2026-10-03 codebase audit finding: list()
  // had no deletedAt: null filter in either branch, unlike its sibling
  // listForFounder() below — a no-op today (nothing in this service ever
  // sets Asset.deletedAt; disposal uses the separate status field
  // instead — see dispose() above), but list() would have silently
  // resurrected a soft-deleted asset in the Ops Console the moment any
  // future code path started setting it. Sets deletedAt directly via
  // Prisma (not through service code, since nothing in this service
  // exposes a way to) specifically to simulate that future path.
  describe("list()", () => {
    // waqfId-scoped only — the unscoped branch is capped at
    // MAX_UNSCOPED_LIST_ROWS most-recent rows, which a shared dev
    // database running many concurrent spec files could push this
    // fixture out of regardless of the filter under test, making that
    // branch's absence-of-a-row assertion unreliable. This branch is
    // deterministic: scoping to one fixture waqf means the result set
    // is small and fully under this test's control.
    test("excludes a soft-deleted asset, but still returns a non-deleted sibling on the same waqf", async () => {
      const kept = await service.create(
        { waqfId, name: "Kept Fixture Asset", category: "cash", estimatedValue: "50" },
        { actorType: "birr_staff", actorUserId },
      );
      assetIds.push(kept.id);
      const softDeleted = await service.create(
        { waqfId, name: "Soft-Deleted Fixture Asset", category: "cash", estimatedValue: "50" },
        { actorType: "birr_staff", actorUserId },
      );
      assetIds.push(softDeleted.id);
      await prisma.asset.update({ where: { id: softDeleted.id }, data: { deletedAt: new Date() } });

      const scoped = await service.list(waqfId);
      expect(scoped.find((a) => a.id === softDeleted.id)).toBeUndefined();
      expect(scoped.find((a) => a.id === kept.id)).toBeDefined();
    });
  });

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
