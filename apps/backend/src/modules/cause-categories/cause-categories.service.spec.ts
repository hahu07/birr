import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { CauseCategoriesService } from "./cause-categories.service";

describe("CauseCategoriesService", () => {
  const service = new CauseCategoriesService();

  const causeCategoryIds: string[] = [];
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `cause-categories-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "platform_admin" },
    });
  });

  afterAll(async () => {
    await prisma.causeCategory.deleteMany({ where: { id: { in: causeCategoryIds } } });
    await prisma.$disconnect();
  });

  function fixtureName(label: string) {
    return `Cause Categories Fixture ${label} ${randomUUID()}`;
  }

  test("create() writes the row and a matching audit_logs record", async () => {
    const category = await service.create(
      { name: fixtureName("Create"), description: "A fixture description." },
      actorUserId,
    );
    causeCategoryIds.push(category.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: category.id, action: "cause_category.created" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entityType: "CauseCategory", actorType: "birr_staff", actorUserId });
  });

  test("create() trims name/description/icon", async () => {
    const category = await service.create(
      { name: `  ${fixtureName("Trim")}  `, description: "  Padded description.  ", icon: "  🌙  " },
      actorUserId,
    );
    causeCategoryIds.push(category.id);
    expect(category.name.startsWith(" ")).toBe(false);
    expect(category.name.endsWith(" ")).toBe(false);
    expect(category.description).toBe("Padded description.");
    expect(category.icon).toBe("🌙");
  });

  test("projectPlan: create() stores it, update() changes it, and omitting it on update leaves it unchanged", async () => {
    const category = await service.create(
      { name: fixtureName("ProjectPlan"), description: "A fixture description.", projectPlan: "  A default starting draft.  " },
      actorUserId,
    );
    causeCategoryIds.push(category.id);
    expect(category.projectPlan).toBe("A default starting draft."); // trimmed, same as description

    const updated = await service.update(category.id, { projectPlan: "A revised default draft." }, actorUserId);
    expect(updated.projectPlan).toBe("A revised default draft.");

    // Omitted (not blanked) — same "only overwrite whichever field is
    // sent" contract description/icon already have.
    const unchanged = await service.update(category.id, { description: "Still here." }, actorUserId);
    expect(unchanged.projectPlan).toBe("A revised default draft.");
  });

  test("create() rejects a whitespace-only description", async () => {
    await expect(
      service.create({ name: fixtureName("BlankDesc"), description: "   " }, actorUserId),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() rejects a duplicate name with a clean conflict, not a raw DB error", async () => {
    const name = fixtureName("Duplicate");
    const first = await service.create({ name, description: "First." }, actorUserId);
    causeCategoryIds.push(first.id);

    await expect(service.create({ name, description: "Second." }, actorUserId)).rejects.toThrow(ConflictException);
  });

  describe("parent hierarchy", () => {
    let parentId: string;

    beforeAll(async () => {
      const parent = await service.create({ name: fixtureName("Parent"), description: "A parent." }, actorUserId);
      parentId = parent.id;
      causeCategoryIds.push(parent.id);
    });

    test("create() accepts a valid parentId", async () => {
      const child = await service.create(
        { name: fixtureName("Child"), description: "A child.", parentId },
        actorUserId,
      );
      causeCategoryIds.push(child.id);
      expect(child.parentId).toBe(parentId);
    });

    test("create() rejects a parentId that doesn't exist", async () => {
      await expect(
        service.create(
          { name: fixtureName("OrphanChild"), description: "An orphan.", parentId: "00000000-0000-0000-0000-000000000000" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    test("update() rejects a category becoming its own parent", async () => {
      const category = await service.create({ name: fixtureName("SelfParent"), description: "Fixture." }, actorUserId);
      causeCategoryIds.push(category.id);

      await expect(
        service.update(category.id, { parentId: category.id }, actorUserId),
      ).rejects.toThrow(BadRequestException);
    });

    test("update() rejects a change that would create a circular hierarchy", async () => {
      const child = await service.create(
        { name: fixtureName("CycleChild"), description: "Fixture.", parentId },
        actorUserId,
      );
      causeCategoryIds.push(child.id);

      // parentId is currently the top-level fixture parent. Trying to
      // make THAT parent's parent be its own child would close a loop.
      await expect(
        service.update(parentId, { parentId: child.id }, actorUserId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  test("update() writes before/after snapshots on the audit log", async () => {
    const category = await service.create({ name: fixtureName("UpdateMe"), description: "Original." }, actorUserId);
    causeCategoryIds.push(category.id);

    const updated = await service.update(category.id, { description: "Updated." }, actorUserId);
    expect(updated.description).toBe("Updated.");

    const logs = await prisma.auditLog.findMany({ where: { entityId: category.id, action: "cause_category.updated" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].before).toMatchObject({ description: "Original." });
    expect(logs[0].after).toMatchObject({ description: "Updated." });
  });

  test("update() rejects an unknown id", async () => {
    await expect(
      service.update("00000000-0000-0000-0000-000000000000", { description: "New." }, actorUserId),
    ).rejects.toThrow(NotFoundException);
  });

  test("update() rejects clearing description to whitespace-only", async () => {
    const category = await service.create({ name: fixtureName("BlankUpdate"), description: "Has content." }, actorUserId);
    causeCategoryIds.push(category.id);

    await expect(service.update(category.id, { description: "   " }, actorUserId)).rejects.toThrow(BadRequestException);
  });

  describe("retire()/restore()", () => {
    let categoryId: string;

    beforeAll(async () => {
      const category = await service.create({ name: fixtureName("RetireMe"), description: "Fixture." }, actorUserId);
      categoryId = category.id;
      causeCategoryIds.push(category.id);
    });

    test("retire() soft-deletes and is excluded from list() by default", async () => {
      await service.retire(categoryId, actorUserId);

      const retired = await prisma.causeCategory.findUnique({ where: { id: categoryId } });
      expect(retired!.deletedAt).not.toBeNull();

      const activeList = await service.list(false);
      expect(activeList.some((c) => c.id === categoryId)).toBe(false);

      const fullList = await service.list(true);
      expect(fullList.some((c) => c.id === categoryId)).toBe(true);

      const logs = await prisma.auditLog.findMany({ where: { entityId: categoryId, action: "cause_category.retired" } });
      expect(logs).toHaveLength(1);
    });

    test("restore() un-deletes and it reappears in the default list", async () => {
      await service.restore(categoryId, actorUserId);

      const restored = await prisma.causeCategory.findUnique({ where: { id: categoryId } });
      expect(restored!.deletedAt).toBeNull();

      const activeList = await service.list(false);
      expect(activeList.some((c) => c.id === categoryId)).toBe(true);

      const logs = await prisma.auditLog.findMany({ where: { entityId: categoryId, action: "cause_category.restored" } });
      expect(logs).toHaveLength(1);
    });

    test("retire() rejects an unknown id", async () => {
      await expect(service.retire("00000000-0000-0000-0000-000000000000", actorUserId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  test("list() attaches usageCount from active WaqfCause selections", async () => {
    const category = await service.create({ name: fixtureName("Usage"), description: "Fixture." }, actorUserId);
    causeCategoryIds.push(category.id);

    const foundation = await prisma.foundation.create({ data: { name: fixtureName("UsageFoundation") } });
    const waqf = await prisma.waqf.create({
      data: { name: fixtureName("UsageWaqf"), type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    const waqfCause = await prisma.waqfCause.create({
      data: { waqfId: waqf.id, causeCategoryId: category.id, name: category.name },
    });

    const list = await service.list(false);
    const row = list.find((c) => c.id === category.id)!;
    expect(row.usageCount).toBe(1);

    await prisma.waqfCause.delete({ where: { id: waqfCause.id } });
    await prisma.waqf.delete({ where: { id: waqf.id } });
    await prisma.foundation.delete({ where: { id: foundation.id } });
  });
});
