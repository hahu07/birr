import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { WaqfDeedsService } from "./waqf-deeds.service";
import { renderDeedText } from "./deed-template";

describe("WaqfDeedsService", () => {
  const service = new WaqfDeedsService();

  const userIds: string[] = [];
  const founderIds: string[] = [];
  const foundationIds: string[] = [];
  const waqfIds: string[] = [];

  async function createFounderWithWaqf(waqfStatus: "draft" | "active") {
    const user = await prisma.user.create({
      data: {
        email: `deed-spec-${Date.now()}-${Math.random()}@example.test`,
        fullName: "Amina Yusuf",
        status: "active",
        whatsappVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const founder = await prisma.founder.create({ data: { name: "Deed Spec Founder", kind: "institution" } });
    founderIds.push(founder.id);
    await prisma.founderMembership.create({
      data: { founderId: founder.id, userId: user.id, permissionLevel: "primary_contact" },
    });
    const foundation = await prisma.foundation.create({
      data: { name: "Deed Spec Foundation", purpose: "Testing" },
    });
    foundationIds.push(foundation.id);
    await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId: founder.id } });
    const waqf = await prisma.waqf.create({
      data: {
        name: "Deed Spec Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundation.id,
        status: waqfStatus,
      },
    });
    waqfIds.push(waqf.id);
    return { user, founder, foundation, waqf };
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("sign() rejects a draft (unfunded) waqf", async () => {
    const { founder, waqf } = await createFounderWithWaqf("draft");
    await expect(
      service.sign({ waqfId: waqf.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true }),
    ).rejects.toThrow(BadRequestException);
  });

  test("sign() rejects a waqf that doesn't belong to the calling founder", async () => {
    const { waqf } = await createFounderWithWaqf("active");
    const { founder: otherFounder } = await createFounderWithWaqf("active");
    await expect(
      service.sign({ waqfId: waqf.id, founderId: otherFounder.id, typedLegalName: "Amina Yusuf", affirmed: true }),
    ).rejects.toThrow(ForbiddenException);
  });

  test("sign() rejects a mismatched typed legal name", async () => {
    const { founder, waqf } = await createFounderWithWaqf("active");
    await expect(
      service.sign({ waqfId: waqf.id, founderId: founder.id, typedLegalName: "Someone Else", affirmed: true }),
    ).rejects.toThrow(BadRequestException);
  });

  test("sign() rejects affirmed: false", async () => {
    const { founder, waqf } = await createFounderWithWaqf("active");
    await expect(
      service.sign({ waqfId: waqf.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: false }),
    ).rejects.toThrow(BadRequestException);
  });

  test("happy path: deed created, deedText matches render-at-signing-time, audit log written", async () => {
    const { founder, waqf, foundation } = await createFounderWithWaqf("active");
    const deed = await service.sign({
      waqfId: waqf.id,
      founderId: founder.id,
      typedLegalName: "Amina Yusuf",
      affirmed: true,
      ipAddress: "203.0.113.7",
    });

    expect(deed.typedLegalName).toBe("Amina Yusuf");
    expect(deed.ipAddress).toBe("203.0.113.7");

    const founderRow = await prisma.founder.findUniqueOrThrow({ where: { id: founder.id } });
    const expectedText = renderDeedText(waqf, foundation, founderRow);
    expect(deed.deedText).toBe(expectedText);

    const logs = await prisma.auditLog.findMany({ where: { entityId: deed.id, action: "waqf_deed.signed" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "founder_user", actorFounderId: founder.id, ipAddress: "203.0.113.7" });
  });

  test("sign() rejects signing the same waqf's deed twice", async () => {
    const { founder, waqf } = await createFounderWithWaqf("active");
    await service.sign({ waqfId: waqf.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true });

    await expect(
      service.sign({ waqfId: waqf.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true }),
    ).rejects.toThrow(ConflictException);
  });

  test("waqf_deeds is immutable at the DB level — UPDATE and DELETE are both rejected by a trigger", async () => {
    const { founder, waqf } = await createFounderWithWaqf("active");
    const deed = await service.sign({ waqfId: waqf.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true });

    // Enforced via a BEFORE UPDATE/DELETE trigger, not a bare REVOKE —
    // see 20260803180000_waqf_deeds_immutable_via_trigger/migration.sql
    // for why a plain REVOKE breaks the incoming FK check from waqfs.
    await expect(
      prisma.waqfDeed.update({ where: { id: deed.id }, data: { typedLegalName: "Tampered Name" } }),
    ).rejects.toThrow(/immutable once written/i);

    await expect(prisma.waqfDeed.delete({ where: { id: deed.id } })).rejects.toThrow(/immutable once written/i);
  });
});
