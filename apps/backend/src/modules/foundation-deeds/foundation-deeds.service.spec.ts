import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { FoundationDeedsService } from "./foundation-deeds.service";
import { renderFoundationDeedText } from "./foundation-deed-template";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";

describe("FoundationDeedsService", () => {
  const service = new FoundationDeedsService(createFakeNotificationsService());

  const userIds: string[] = [];
  const founderIds: string[] = [];
  const foundationIds: string[] = [];
  const waqfIds: string[] = [];

  async function createFounderWithFoundation(waqfStatus: "draft" | "active") {
    const user = await prisma.user.create({
      data: {
        email: `foundation-deed-spec-${Date.now()}-${Math.random()}@example.test`,
        fullName: "Amina Yusuf",
        status: "active",
        whatsappVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const founder = await prisma.founder.create({ data: { name: "Foundation Deed Spec Founder", kind: "institution" } });
    founderIds.push(founder.id);
    await prisma.founderMembership.create({
      data: { founderId: founder.id, userId: user.id, permissionLevel: "primary_contact" },
    });
    const foundation = await prisma.foundation.create({
      data: { name: "Foundation Deed Spec Foundation", purpose: "Testing" },
    });
    foundationIds.push(foundation.id);
    await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId: founder.id } });
    const waqf = await prisma.waqf.create({
      data: {
        name: "Foundation Deed Spec Waqf",
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

  test("sign() rejects a foundation with no active waqf", async () => {
    const { founder, foundation } = await createFounderWithFoundation("draft");
    await expect(
      service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true }),
    ).rejects.toThrow(BadRequestException);
  });

  test("sign() rejects a foundation that doesn't belong to the calling founder", async () => {
    const { foundation } = await createFounderWithFoundation("active");
    const { founder: otherFounder } = await createFounderWithFoundation("active");
    await expect(
      service.sign({ foundationId: foundation.id, founderId: otherFounder.id, typedLegalName: "Amina Yusuf", affirmed: true }),
    ).rejects.toThrow(ForbiddenException);
  });

  test("sign() rejects a mismatched typed legal name", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    await expect(
      service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Someone Else", affirmed: true }),
    ).rejects.toThrow(BadRequestException);
  });

  test("sign() rejects affirmed: false", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    await expect(
      service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: false }),
    ).rejects.toThrow(BadRequestException);
  });

  test("happy path: deed created, deedText matches render-at-signing-time, audit log written", async () => {
    const { founder, foundation, waqf } = await createFounderWithFoundation("active");
    const deed = await service.sign({
      foundationId: foundation.id,
      founderId: founder.id,
      typedLegalName: "Amina Yusuf",
      affirmed: true,
      ipAddress: "203.0.113.7",
    });

    expect(deed.typedLegalName).toBe("Amina Yusuf");
    expect(deed.ipAddress).toBe("203.0.113.7");

    const founderRow = await prisma.founder.findUniqueOrThrow({ where: { id: founder.id } });
    const expectedText = renderFoundationDeedText(foundation, founderRow, [waqf]);
    expect(deed.deedText).toBe(expectedText);
    expect(deed.deedText).toContain(waqf.name);

    const logs = await prisma.auditLog.findMany({ where: { entityId: deed.id, action: "foundation_deed.signed" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "founder_user", actorFounderId: founder.id, ipAddress: "203.0.113.7" });
  });

  test("sign() rejects signing the same foundation's deed twice", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    await service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true });

    await expect(
      service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true }),
    ).rejects.toThrow(ConflictException);
  });

  test("deedText lists every active waqf under the foundation as of signing, and never a later one", async () => {
    const { founder, foundation, waqf } = await createFounderWithFoundation("active");
    const secondWaqf = await prisma.waqf.create({
      data: { name: "Foundation Deed Spec Second Waqf", type: "investment", jurisdiction: "NG", foundationId: foundation.id, status: "active" },
    });
    waqfIds.push(secondWaqf.id);

    const deed = await service.sign({
      foundationId: foundation.id,
      founderId: founder.id,
      typedLegalName: "Amina Yusuf",
      affirmed: true,
    });
    expect(deed.deedText).toContain(waqf.name);
    expect(deed.deedText).toContain(secondWaqf.name);

    // A waqf created AFTER signing must not retroactively appear in the
    // already-signed, immutable deedText snapshot.
    const thirdWaqf = await prisma.waqf.create({
      data: { name: "Foundation Deed Spec Third Waqf (after signing)", type: "project", jurisdiction: "NG", foundationId: foundation.id, status: "active" },
    });
    waqfIds.push(thirdWaqf.id);

    const reloaded = await prisma.foundationDeed.findUniqueOrThrow({ where: { id: deed.id } });
    expect(reloaded.deedText).not.toContain(thirdWaqf.name);
  });

  test("foundation_deeds is immutable at the DB level — UPDATE and DELETE are both rejected by a trigger", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    const deed = await service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true });

    // Enforced via a BEFORE UPDATE/DELETE trigger — see
    // 20260827145212_add_foundation_deed/migration.sql.
    await expect(
      prisma.foundationDeed.update({ where: { id: deed.id }, data: { typedLegalName: "Tampered Name" } }),
    ).rejects.toThrow(/immutable once written/i);

    await expect(prisma.foundationDeed.delete({ where: { id: deed.id } })).rejects.toThrow(/immutable once written/i);
  });
});
