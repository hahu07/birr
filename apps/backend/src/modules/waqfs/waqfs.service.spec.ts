import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { prisma } from "@birr/db";
import { WaqfsService } from "./waqfs.service";
import { TrusteeLicensesService } from "../trustee-licenses/trustee-licenses.service";

describe("WaqfsService", () => {
  const service = new WaqfsService(new TrusteeLicensesService());

  const waqfIds: string[] = [];

  let founderAId: string;
  let founderBId: string;
  let foundationAId: string;
  let foundationBId: string;
  let waqfAId: string;
  let waqfBId: string;

  beforeAll(async () => {
    const founderA = await prisma.founder.create({
      data: { name: "Waqfs List Founder A", kind: "institution" },
    });
    founderAId = founderA.id;
    const founderB = await prisma.founder.create({
      data: { name: "Waqfs List Founder B", kind: "institution" },
    });
    founderBId = founderB.id;

    // Each fixture waqf gets its own Foundation, mirroring the fact that
    // a founder relationship is now derived transitively via
    // foundationId -> foundation_founders, not a direct join on Waqf.
    const foundationA = await prisma.foundation.create({
      data: { name: "Waqfs List Foundation A" },
    });
    foundationAId = foundationA.id;
    await prisma.foundationFounder.create({
      data: { foundationId: foundationA.id, founderId: founderAId },
    });
    const foundationB = await prisma.foundation.create({
      data: { name: "Waqfs List Foundation B" },
    });
    foundationBId = foundationB.id;
    await prisma.foundationFounder.create({
      data: { foundationId: foundationB.id, founderId: founderBId },
    });

    const waqfA = await prisma.waqf.create({
      data: {
        name: "Waqfs List Test Waqf A",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundationA.id,
      },
    });
    waqfAId = waqfA.id;
    waqfIds.push(waqfA.id);

    const waqfB = await prisma.waqf.create({
      data: {
        name: "Waqfs List Test Waqf B",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundationB.id,
      },
    });
    waqfBId = waqfB.id;
    waqfIds.push(waqfB.id);
  });

  afterAll(async () => {
    // Founders/Foundations are left in place, same reasoning as every
    // other spec — simplest to not chase FK cleanup for rows nothing
    // else depends on.
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("list(founderId) sets app.current_founder_id and returns only that founder's waqfs — proves the RLS policy and the WHERE clause are both actually live for this call, not just the WHERE clause alone", async () => {
    // If founder_isolation ever regresses to denying all rows (the exact
    // empty-string gotcha fixed earlier this session), this would come
    // back empty instead of exactly one row, even though the WHERE
    // clause alone would still find it.
    const resultsForA = await service.list(founderAId);
    expect(resultsForA.map((w) => w.id)).toEqual([waqfAId]);
    // Founder Portal groups its waqf list by Foundation — this field
    // must actually be populated, not just present on the type.
    expect(resultsForA[0].foundation.name).toBe("Waqfs List Foundation A");

    const resultsForB = await service.list(founderBId);
    expect(resultsForB.map((w) => w.id)).toEqual([waqfBId]);
  });

  test("list() with no founderId is unrestricted (internal/ops-console path unchanged)", async () => {
    const all = await service.list();
    const ids = all.map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining([waqfAId, waqfBId]));
    const waqfA = all.find((w) => w.id === waqfAId)!;
    expect(waqfA.foundation.name).toBe("Waqfs List Foundation A");
  });

  test("findByIdForFounder() resolves the caller's own waqf but returns null for another founder's waqf", async () => {
    const own = await service.findByIdForFounder(waqfAId, founderAId);
    expect(own?.id).toBe(waqfAId);

    // The RLS-leak this closes: without founder scoping, findById() would
    // happily return Founder B's waqf to Founder A's session.
    const other = await service.findByIdForFounder(waqfBId, founderAId);
    expect(other).toBeNull();
  });

  test("createSelfService() creates the waqf and audit-logs it against the calling founder when they own the foundation", async () => {
    const waqf = await service.createSelfService({
      name: "Self Service Waqf",
      type: "asset",
      jurisdiction: "AE",
      foundationId: foundationAId,
      founderId: founderAId,
    });
    waqfIds.push(waqf.id);

    expect(waqf.foundationId).toBe(foundationAId);

    const logs = await prisma.auditLog.findMany({ where: { entityId: waqf.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "waqf.created",
      actorType: "founder_user",
      actorFounderId: founderAId,
    });
  });

  test("createSelfService() rejects a founder creating a waqf under a foundation that isn't theirs", async () => {
    // founderB attempting to create a waqf under founderA's Foundation —
    // the security-critical ownership check this whole self-service path
    // depends on: without it, any founder could create a waqf under any
    // other founder's Foundation just by guessing/enumerating an id.
    await expect(
      service.createSelfService({
        name: "Should Be Rejected",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundationAId,
        founderId: founderBId,
      }),
    ).rejects.toThrow(ForbiddenException);

    const created = await prisma.waqf.findFirst({ where: { name: "Should Be Rejected" } });
    expect(created).toBeNull();
  });

  test("createSelfService() rejects when the founder's primary_contact hasn't verified their email", async () => {
    const unverifiedUser = await prisma.user.create({
      data: { email: `waqfs-spec-unverified-${randomUUID()}@example.test`, fullName: "Unverified Contact" },
    });
    const unverifiedFounder = await prisma.founder.create({
      data: { name: "Waqfs Spec Unverified Founder", kind: "individual" },
    });
    await prisma.founderMembership.create({
      data: { founderId: unverifiedFounder.id, userId: unverifiedUser.id, permissionLevel: "primary_contact" },
    });
    const foundation = await prisma.foundation.create({
      data: { name: "Waqfs Spec Unverified Foundation", purpose: "Testing" },
    });
    await prisma.foundationFounder.create({
      data: { foundationId: foundation.id, founderId: unverifiedFounder.id },
    });

    await expect(
      service.createSelfService({
        name: "Should Be Blocked",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundation.id,
        founderId: unverifiedFounder.id,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
