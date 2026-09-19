import { prisma } from "@birr/db";
import { NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ShariahProhibitedSectorsService } from "./shariah-prohibited-sectors.service";

describe("ShariahProhibitedSectorsService", () => {
  const service = new ShariahProhibitedSectorsService();

  const sectorIds: string[] = [];
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `shariah-prohibited-sectors-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "platform_admin" } });
  });

  afterAll(async () => {
    await prisma.shariahProhibitedSector.deleteMany({ where: { id: { in: sectorIds } } });
    await prisma.$disconnect();
  });

  test("create() writes the sector and a matching audit_logs record", async () => {
    const sector = await service.create(
      { name: `Fixture Sector ${randomUUID()}`, description: "A test-only prohibited sector." },
      actorUserId,
    );
    sectorIds.push(sector.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: sector.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "ShariahProhibitedSector",
      action: "shariah_prohibited_sector.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });

  test("update() writes a matching audit_logs record with before/after", async () => {
    const sector = await service.create({ name: `Fixture Sector ${randomUUID()}` }, actorUserId);
    sectorIds.push(sector.id);

    const updated = await service.update(sector.id, { name: sector.name, description: "Updated description." }, actorUserId);
    expect(updated.description).toBe("Updated description.");

    const logs = await prisma.auditLog.findMany({
      where: { entityId: sector.id, action: "shariah_prohibited_sector.updated" },
    });
    expect(logs).toHaveLength(1);
    expect((logs[0].before as any).description).toBeNull();
    expect((logs[0].after as any).description).toBe("Updated description.");
  });

  test("update() throws NotFoundException for an unknown id", async () => {
    await expect(
      service.update("00000000-0000-0000-0000-000000000000", { name: "Doesn't matter" }, actorUserId),
    ).rejects.toThrow(NotFoundException);
  });

  test("remove() deletes the sector and writes a .deleted audit log", async () => {
    const sector = await service.create({ name: `Fixture Sector ${randomUUID()}` }, actorUserId);

    await service.remove(sector.id, actorUserId);

    const found = await prisma.shariahProhibitedSector.findUnique({ where: { id: sector.id } });
    expect(found).toBeNull();

    const logs = await prisma.auditLog.findMany({
      where: { entityId: sector.id, action: "shariah_prohibited_sector.deleted" },
    });
    expect(logs).toHaveLength(1);
  });

  test("remove() throws NotFoundException for an unknown id", async () => {
    await expect(service.remove("00000000-0000-0000-0000-000000000000", actorUserId)).rejects.toThrow(NotFoundException);
  });

  test("list() includes the seeded classical exclusions plus any fixtures created above", async () => {
    const list = await service.list();
    expect(list.some((s) => s.name === "Gambling")).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(8);
  });
});
