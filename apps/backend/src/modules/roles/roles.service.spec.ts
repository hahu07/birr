import { prisma } from "@birr/db";
import { RolesService } from "./roles.service";

describe("RolesService", () => {
  const service = new RolesService();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("list() returns every seeded role with its permission grants attached", async () => {
    const roles = await service.list();
    expect(roles.length).toBeGreaterThan(0);

    const platformAdmin = roles.find((r) => r.key === "platform_admin");
    expect(platformAdmin).toBeDefined();
    expect(Array.isArray(platformAdmin!.rolePermissions)).toBe(true);
    // Every rolePermission entry carries its full Permission row, not
    // just the join's own columns — that's what makes this read useful
    // for display rather than just a list of opaque permissionIds.
    for (const rp of platformAdmin!.rolePermissions) {
      expect(rp.permission).toBeDefined();
      expect(typeof rp.permission.key).toBe("string");
    }
  });

  test("list() is ordered by name ascending", async () => {
    const roles = await service.list();
    const names = roles.map((r) => r.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});
