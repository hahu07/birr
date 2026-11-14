import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { FoundationDeedsService } from "./foundation-deeds.service";
import { JOINT_FOUNDATION_DEED_TEMPLATE_VERSION, FOUNDATION_DEED_TEMPLATE_VERSION, renderFoundationDeedText } from "./foundation-deed-template";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";

describe("FoundationDeedsService", () => {
  const service = new FoundationDeedsService(createFakeNotificationsService(), new FunnelEventsService());

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

  // What the signing page sends back: the hash of the preview it showed.
  async function textHashFor(foundationId: string, founderId: string) {
    return (await service.preview(foundationId, founderId)).textHash;
  }

  async function addCoFounder(foundationId: string, name: string) {
    const coFounder = await prisma.founder.create({ data: { name, kind: "individual" } });
    founderIds.push(coFounder.id);
    await prisma.foundationFounder.create({ data: { foundationId, founderId: coFounder.id } });
    return coFounder;
  }

  test("sign() rejects a foundation with no active waqf", async () => {
    const { founder, foundation } = await createFounderWithFoundation("draft");
    await expect(
      service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true, textHash: await textHashFor(foundation.id, founder.id) }),
    ).rejects.toThrow(BadRequestException);
  });

  test("sign() rejects a foundation that doesn't belong to the calling founder", async () => {
    const { foundation } = await createFounderWithFoundation("active");
    const { founder: otherFounder } = await createFounderWithFoundation("active");
    await expect(
      service.sign({ foundationId: foundation.id, founderId: otherFounder.id, typedLegalName: "Amina Yusuf", affirmed: true, textHash: "unused" }),
    ).rejects.toThrow(ForbiddenException);
  });

  test("sign() rejects a mismatched typed legal name", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    await expect(
      service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Someone Else", affirmed: true, textHash: await textHashFor(foundation.id, founder.id) }),
    ).rejects.toThrow(BadRequestException);
  });

  test("sign() rejects affirmed: false", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    await expect(
      service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: false, textHash: await textHashFor(foundation.id, founder.id) }),
    ).rejects.toThrow(BadRequestException);
  });

  test("happy path: deed created, deedText matches render-at-signing-time, audit log written", async () => {
    const { founder, foundation, waqf } = await createFounderWithFoundation("active");
    const deed = await service.sign({
      foundationId: foundation.id,
      founderId: founder.id,
      typedLegalName: "Amina Yusuf",
      affirmed: true,
      textHash: await textHashFor(foundation.id, founder.id),
      ipAddress: "203.0.113.7",
    });

    expect(deed.typedLegalName).toBe("Amina Yusuf");
    expect(deed.ipAddress).toBe("203.0.113.7");

    const founderRow = await prisma.founder.findUniqueOrThrow({ where: { id: founder.id } });
    const expectedText = renderFoundationDeedText(foundation, founderRow, [waqf]);
    expect(deed.deedText).toBe(expectedText);
    expect(deed.deedText).toContain(waqf.name);
    expect(deed.deedTemplateVersion).toBe(FOUNDATION_DEED_TEMPLATE_VERSION);

    const logs = await prisma.auditLog.findMany({ where: { entityId: deed.id, action: "foundation_deed.signed" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "founder_user", actorFounderId: founder.id, ipAddress: "203.0.113.7" });
  });

  test("sign() rejects signing the same foundation's deed twice", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    await service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true, textHash: await textHashFor(foundation.id, founder.id) });

    await expect(
      service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true, textHash: await textHashFor(foundation.id, founder.id) }),
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
      textHash: await textHashFor(foundation.id, founder.id),
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

  test("preview() shows exactly the text sign() then stores", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    const preview = await service.preview(foundation.id, founder.id);
    const deed = await service.sign({
      foundationId: foundation.id,
      founderId: founder.id,
      typedLegalName: "Amina Yusuf",
      affirmed: true,
      textHash: preview.textHash,
    });
    expect(deed.deedText).toBe(preview.deedText);
    expect(preview).toMatchObject({ joint: false, coFounders: [], alreadySigned: false });
    await expect(service.preview(foundation.id, founder.id)).resolves.toMatchObject({ alreadySigned: true });
  });

  test("sign() refuses a deed that changed after the signer's preview, and stores nothing", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    const staleHash = await textHashFor(foundation.id, founder.id);
    // A second fund goes active after the preview, so the stored text would differ.
    const later = await prisma.waqf.create({
      data: { name: "Foundation Deed Spec Later Waqf", type: "project", jurisdiction: "NG", foundationId: foundation.id, status: "active" },
    });
    waqfIds.push(later.id);

    await expect(
      service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true, textHash: staleHash }),
    ).rejects.toThrow(ConflictException);
    expect(await prisma.foundationDeed.findUnique({ where: { foundationId: foundation.id } })).toBeNull();
  });

  test("a jointly established foundation gets the joint deed, naming every co-founder the signer signs for", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    await prisma.foundation.update({ where: { id: foundation.id }, data: { establishedJointly: true } });
    const coFounder = await addCoFounder(foundation.id, "Yusuf Bello");

    const preview = await service.preview(foundation.id, founder.id);
    expect(preview).toMatchObject({ joint: true, coFounders: ["Yusuf Bello"] });

    const deed = await service.sign({
      foundationId: foundation.id,
      founderId: founder.id,
      typedLegalName: "Amina Yusuf",
      affirmed: true,
      textHash: preview.textHash,
    });
    expect(deed.deedTemplateVersion).toBe(JOINT_FOUNDATION_DEED_TEMPLATE_VERSION);
    expect(deed.deedText).toContain('(the "Signing Founder")');
    expect(deed.deedText).toContain("for themselves and on behalf of each co-founder");
    expect(deed.deedText).toContain(`  - ${coFounder.name}`);
  });

  test("a single-founder foundation that gains a co-founder before signing also gets the joint deed", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    await addCoFounder(foundation.id, "Late Co-Founder");
    const preview = await service.preview(foundation.id, founder.id);
    expect(preview.joint).toBe(true);
    expect(preview.deedText).toContain("Late Co-Founder");
  });

  test("a jointly established foundation with no co-founders yet still gets the joint deed, listing none", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    await prisma.foundation.update({ where: { id: foundation.id }, data: { establishedJointly: true } });
    const preview = await service.preview(foundation.id, founder.id);
    expect(preview.joint).toBe(true);
    expect(preview.deedText).toContain("None yet — each co-founder is bound from the day they accept");
  });

  test("findByFoundationIdForFounder() returns the deed with each co-founder's recorded statement", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    const deed = await service.sign({
      foundationId: foundation.id,
      founderId: founder.id,
      typedLegalName: "Amina Yusuf",
      affirmed: true,
      textHash: await textHashFor(foundation.id, founder.id),
    });
    const coFounder = await addCoFounder(foundation.id, "Consenting Co-Founder");
    const coUser = await prisma.user.create({
      data: { email: `foundation-deed-spec-co-${Date.now()}@example.test`, fullName: "Consenting Co-Founder", status: "active" },
    });
    userIds.push(coUser.id);
    await prisma.coFounderDeedConsent.create({
      data: {
        foundationId: foundation.id,
        founderId: coFounder.id,
        userId: coUser.id,
        kind: "adopt_signed_deed",
        foundationDeedId: deed.id,
        statementVersion: "spec",
        statementText: "I adopt it.",
      },
    });

    const found = await service.findByFoundationIdForFounder(foundation.id, founder.id);
    expect(found?.coFounderConsents).toEqual([
      expect.objectContaining({ founderName: "Consenting Co-Founder", kind: "adopt_signed_deed", statementText: "I adopt it." }),
    ]);
  });

  test("foundation_deeds is immutable at the DB level — UPDATE and DELETE are both rejected by a trigger", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    const deed = await service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true, textHash: await textHashFor(foundation.id, founder.id) });

    // Enforced via a BEFORE UPDATE/DELETE trigger — see
    // 20260827145212_add_foundation_deed/migration.sql.
    await expect(
      prisma.foundationDeed.update({ where: { id: deed.id }, data: { typedLegalName: "Tampered Name" } }),
    ).rejects.toThrow(/immutable once written/i);

    await expect(prisma.foundationDeed.delete({ where: { id: deed.id } })).rejects.toThrow(/immutable once written/i);
  });
});
