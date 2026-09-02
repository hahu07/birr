import { prisma } from "@birr/db";
import { WaqfDeedsService } from "./waqf-deeds.service";

// WaqfDeedsService.create() is retired (see this module's own comment —
// FoundationDeedsService is the current Foundation-level replacement),
// so this spec seeds a WaqfDeed row directly via Prisma, exactly as a
// real historical row would look, and only exercises the two read paths
// this service still serves.
describe("WaqfDeedsService", () => {
  const service = new WaqfDeedsService();

  let founderId: string;
  let otherFounderId: string;
  let waqfWithDeedId: string;
  let waqfWithoutDeedId: string;

  beforeAll(async () => {
    const founder = await prisma.founder.create({ data: { name: "Waqf Deeds Fixture Founder", kind: "institution" } });
    founderId = founder.id;
    const otherFounder = await prisma.founder.create({ data: { name: "Waqf Deeds Fixture Other Founder", kind: "institution" } });
    otherFounderId = otherFounder.id;

    const foundation = await prisma.foundation.create({ data: { name: "Waqf Deeds Fixture Foundation" } });
    await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId } });

    const user = await prisma.user.create({
      data: { email: `waqf-deeds-signer-${Date.now()}@example.com`, fullName: "Fixture Signer" },
    });

    const waqfWithDeed = await prisma.waqf.create({
      data: { name: "Waqf Deeds Fixture Waqf With Deed", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfWithDeedId = waqfWithDeed.id;

    await prisma.waqfDeed.create({
      data: {
        waqfId: waqfWithDeedId,
        signedByUserId: user.id,
        signedByFounderId: founderId,
        typedLegalName: "Fixture Signer",
        deedTemplateVersion: "v1-legacy",
        deedText: "This is a historical, legacy per-waqf deed.",
        affirmed: true,
      },
    });

    const waqfWithoutDeed = await prisma.waqf.create({
      data: { name: "Waqf Deeds Fixture Waqf Without Deed", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfWithoutDeedId = waqfWithoutDeed.id;
  });

  // waqf_deeds is immutable once written — a DB trigger blocks DELETE
  // outright (see 20260828.../migration.sql's own comment), so the
  // fixture WaqfDeed row above is never cleaned up, same "insert-only,
  // left in place" posture as every other spec's User/BirrStaff
  // fixtures. The fixture Waqf rows can't be deleted either as long as
  // that WaqfDeed row references them (RESTRICT FK) — left in place too.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("findByWaqfId() returns the signed deed for a waqf that has one", async () => {
    const deed = await service.findByWaqfId(waqfWithDeedId);
    expect(deed).not.toBeNull();
    expect(deed!.typedLegalName).toBe("Fixture Signer");
    expect(deed!.affirmed).toBe(true);
  });

  test("findByWaqfId() returns null for a waqf with no deed", async () => {
    const deed = await service.findByWaqfId(waqfWithoutDeedId);
    expect(deed).toBeNull();
  });

  test("findByWaqfIdForFounder() returns the deed when the founder actually owns the waqf", async () => {
    const deed = await service.findByWaqfIdForFounder(waqfWithDeedId, founderId);
    expect(deed).not.toBeNull();
    expect(deed!.waqfId).toBe(waqfWithDeedId);
  });

  test("findByWaqfIdForFounder() returns null for a founder who doesn't own the waqf", async () => {
    const deed = await service.findByWaqfIdForFounder(waqfWithDeedId, otherFounderId);
    expect(deed).toBeNull();
  });

  test("findByWaqfIdForFounder() returns null for a waqf with no deed, even for its real owner", async () => {
    const deed = await service.findByWaqfIdForFounder(waqfWithoutDeedId, founderId);
    expect(deed).toBeNull();
  });
});
