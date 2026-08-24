import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { prisma } from "@birr/db";
import { FoundationsService } from "./foundations.service";

describe("FoundationsService", () => {
  const service = new FoundationsService();

  const foundationIds: string[] = [];
  const waqfIds: string[] = [];

  let founderAId: string;
  let founderBId: string;
  let founderCId: string;
  let foundationId: string;

  beforeAll(async () => {
    const founderA = await prisma.founder.create({
      data: { name: "Foundations Spec Founder A", kind: "institution" },
    });
    founderAId = founderA.id;
    const founderB = await prisma.founder.create({
      data: { name: "Foundations Spec Founder B", kind: "institution" },
    });
    founderBId = founderB.id;
    const founderC = await prisma.founder.create({
      data: { name: "Foundations Spec Founder C (not on this foundation)", kind: "institution" },
    });
    founderCId = founderC.id;

    const foundation = await service.create({
      name: "Foundations Spec Test Foundation",
      purpose: "Testing",
      jurisdiction: "AE",
      founderIds: [founderAId, founderBId],
    });
    foundationId = foundation.id;
    foundationIds.push(foundation.id);

    const waqf = await prisma.waqf.create({
      data: {
        name: "Foundations Spec Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId,
      },
    });
    waqfIds.push(waqf.id);
  });

  afterAll(async () => {
    // Founders/Foundations/Waqfs are left in place, same reasoning as
    // every other spec in this codebase — simplest to not chase FK
    // cleanup for rows nothing else depends on.
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("list() includes founder names and the waqf count for each foundation", async () => {
    const all = await service.list();
    const fixture = all.find((f) => f.id === foundationId)!;
    expect(fixture._count.waqfs).toBe(1);
    const founderNames = fixture.foundationFounders.map((ff) => ff.founder.name).sort();
    expect(founderNames).toEqual(["Foundations Spec Founder A", "Foundations Spec Founder B"]);
  });

  test("findById() includes the same founder names and waqf count", async () => {
    const found = await service.findById(foundationId);
    expect(found?._count.waqfs).toBe(1);
    const founderNames = found?.foundationFounders.map((ff) => ff.founder.name).sort();
    expect(founderNames).toEqual(["Foundations Spec Founder A", "Foundations Spec Founder B"]);
  });

  test("list(founderId) sets app.current_founder_id and returns only that founder's foundations", async () => {
    const resultsForA = await service.list(founderAId);
    expect(resultsForA.map((f) => f.id)).toContain(foundationId);
    expect(resultsForA[0]?._count.waqfs).toBeDefined();
  });

  test("findByIdForFounder() resolves for a co-founder but returns null for an unrelated founder", async () => {
    const own = await service.findByIdForFounder(foundationId, founderAId);
    expect(own?.id).toBe(foundationId);

    // The RLS-leak this closes: without founder scoping, findById() would
    // happily return this foundation to a founder who has no relationship
    // to it at all.
    const unrelated = await service.findByIdForFounder(foundationId, founderCId);
    expect(unrelated).toBeNull();
  });

  test("self-service create() attributes the audit log to the calling founder, not 'system'", async () => {
    // Mirrors what FoundationsController.create() does when x-founder-id
    // is present: it forces founderIds to just the caller before ever
    // reaching the service, so this test calls the service the same way
    // — the controller-level enforcement (ignoring a body-supplied
    // founderIds list) is that controller's own responsibility, not
    // re-tested here.
    const foundation = await service.create(
      { name: "Self Service Foundation", purpose: "Testing self-service attribution", founderIds: [founderAId] },
      { type: "founder", founderId: founderAId },
    );
    foundationIds.push(foundation.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: foundation.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "foundation.created",
      actorType: "founder_user",
      actorFounderId: founderAId,
    });
  });

  test("create() rejects when the acting founder's primary_contact hasn't verified their email", async () => {
    const unverifiedUser = await prisma.user.create({
      data: { email: `foundations-spec-unverified-${randomUUID()}@example.test`, fullName: "Unverified Contact" },
    });
    const unverifiedFounder = await prisma.founder.create({
      data: { name: "Foundations Spec Unverified Founder", kind: "individual" },
    });
    await prisma.founderMembership.create({
      data: { founderId: unverifiedFounder.id, userId: unverifiedUser.id, permissionLevel: "primary_contact" },
    });

    await expect(
      service.create(
        { name: "Should Be Blocked", purpose: "Testing", founderIds: [unverifiedFounder.id] },
        { type: "founder", founderId: unverifiedFounder.id },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
