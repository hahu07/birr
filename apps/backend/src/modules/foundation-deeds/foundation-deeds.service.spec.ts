import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { FoundationDeedsService } from "./foundation-deeds.service";
import { JOINT_FOUNDATION_DEED_TEMPLATE_VERSION, FOUNDATION_DEED_TEMPLATE_VERSION, renderFoundationDeedText } from "./foundation-deed-template";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";
import { withFounderScope } from "../../common/db/founder-scope";

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

  /** A co-founder with a primary contact who can sign in and agree. */
  async function addCoFounderWithContact(foundationId: string, name: string) {
    const coFounder = await addCoFounder(foundationId, name);
    const user = await prisma.user.create({
      data: { email: `foundation-deed-spec-cf-${Date.now()}-${Math.random()}@example.test`, fullName: name, status: "active" },
    });
    userIds.push(user.id);
    await prisma.founderMembership.create({ data: { founderId: coFounder.id, userId: user.id, permissionLevel: "primary_contact" } });
    return { coFounder, user };
  }

  /** The co-founder agrees to the statement they're shown, as the deed page does. */
  async function agree(foundationId: string, founderId: string, userId: string) {
    const statement = await service.consentStatus(foundationId, founderId);
    return service.giveConsent({ foundationId, founderId, userId, statementHash: statement!.hash });
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
    const { coFounder, user: coUser } = await addCoFounderWithContact(foundation.id, "Yusuf Bello");
    await agree(foundation.id, coFounder.id, coUser.id);

    const preview = await service.preview(foundation.id, founder.id);
    expect(preview).toMatchObject({ joint: true, coFounders: ["Yusuf Bello"], awaitingConsent: [] });

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

  test("a joint deed waits for every co-founder's own agreement, then signs for them all", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    const yusuf = await addCoFounderWithContact(foundation.id, "Yusuf Bello");
    const hauwa = await addCoFounderWithContact(foundation.id, "Hauwa Bello");

    let preview = await service.preview(foundation.id, founder.id);
    expect(preview.awaitingConsent.sort()).toEqual(["Hauwa Bello", "Yusuf Bello"]);
    const sign = (textHash: string) => service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true, textHash });
    await expect(sign(preview.textHash)).rejects.toMatchObject({ response: { code: "deed_awaiting_consent" } });

    // Each sees the "authorize the signer" statement and agrees in their own name.
    const statement = await service.consentStatus(foundation.id, yusuf.coFounder.id);
    expect(statement).toMatchObject({ kind: "authorize_signer" });
    const consent = await agree(foundation.id, yusuf.coFounder.id, yusuf.user.id);
    expect(consent).toMatchObject({ kind: "authorize_signer", userId: yusuf.user.id, statementText: statement!.text });
    expect(await prisma.auditLog.count({ where: { entityId: consent.id, action: "co_founder.deed_consented" } })).toBe(1);
    expect(await service.consentStatus(foundation.id, yusuf.coFounder.id)).toBeNull();
    await expect(
      service.giveConsent({ foundationId: foundation.id, founderId: yusuf.coFounder.id, userId: yusuf.user.id, statementHash: statement!.hash }),
    ).rejects.toThrow(/already agreed/);
    expect((await service.preview(foundation.id, founder.id)).awaitingConsent).toEqual(["Hauwa Bello"]);

    await agree(foundation.id, hauwa.coFounder.id, hauwa.user.id);
    preview = await service.preview(foundation.id, founder.id);
    expect(preview.awaitingConsent).toEqual([]);
    const deed = await sign(preview.textHash);
    expect(deed.deedTemplateVersion).toBe(JOINT_FOUNDATION_DEED_TEMPLATE_VERSION);
    // The signer has nothing to agree to; nor does anyone who already has.
    expect(await service.consentStatus(foundation.id, founder.id)).toBeNull();
  });

  test("a co-founder with no agreement on record can adopt a deed already signed, but not with a statement they weren't shown", async () => {
    const { founder, foundation } = await createFounderWithFoundation("active");
    const deed = await service.sign({ foundationId: foundation.id, founderId: founder.id, typedLegalName: "Amina Yusuf", affirmed: true, textHash: await textHashFor(foundation.id, founder.id) });
    // Added after signing by a path that records no agreement (e.g. FoundationsService.create).
    const late = await addCoFounderWithContact(foundation.id, "Late Bello");
    const statement = await service.consentStatus(foundation.id, late.coFounder.id);
    expect(statement).toMatchObject({ kind: "adopt_signed_deed" });
    expect(statement!.text).toContain("signed by Amina Yusuf");
    await expect(
      service.giveConsent({ foundationId: foundation.id, founderId: late.coFounder.id, userId: late.user.id, statementHash: "not-what-was-shown" }),
    ).rejects.toMatchObject({ response: { code: "statement_changed" } });
    const consent = await agree(foundation.id, late.coFounder.id, late.user.id);
    expect(consent).toMatchObject({ kind: "adopt_signed_deed", foundationDeedId: deed.id });
  });

  test("the deed lists funds and co-founders oldest first, however the rows come back", async () => {
    const { founder, foundation, waqf } = await createFounderWithFoundation("active");
    // Inserted after the first fund, but dated earlier.
    const older = await prisma.waqf.create({
      data: { name: "Aaa Older Spec Waqf", type: "project", jurisdiction: "NG", foundationId: foundation.id, status: "active", createdAt: new Date("2020-01-01T00:00:00Z") },
    });
    waqfIds.push(older.id);
    const { deedText } = await service.preview(foundation.id, founder.id);
    expect(deedText.indexOf(older.name)).toBeGreaterThan(-1);
    expect(deedText.indexOf(older.name)).toBeLessThan(deedText.indexOf(waqf.name));
    // Same text, same hash, on every read.
    const hashes = await Promise.all(Array.from({ length: 5 }, () => textHashFor(foundation.id, founder.id)));
    expect(new Set(hashes).size).toBe(1);
  });

  test("co-founders' agreements are isolated by the database: another founder's session can't read them", async () => {
    const { foundation } = await createFounderWithFoundation("active");
    const co = await addCoFounderWithContact(foundation.id, "Isolated Bello");
    await agree(foundation.id, co.coFounder.id, co.user.id);
    const outsider = await createFounderWithFoundation("active");
    const asOutsider = await withFounderScope(outsider.founder.id, (tx) => tx.coFounderDeedConsent.findMany({ where: { foundationId: foundation.id } }));
    expect(asOutsider).toEqual([]);
    const asMember = await withFounderScope(co.coFounder.id, (tx) => tx.coFounderDeedConsent.findMany({ where: { foundationId: foundation.id } }));
    expect(asMember).toHaveLength(1);
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
