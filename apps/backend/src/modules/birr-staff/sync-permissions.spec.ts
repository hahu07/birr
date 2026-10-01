import { prisma } from "@birr/db";
import { permissions, rolePermissions } from "@birr/db/prisma/seed-data";
import { syncPermissions } from "@birr/db/prisma/sync-permissions";

// The deploy-time permission sync (see packages/db/prisma/sync-permissions.ts
// and apps/backend/docker-entrypoint.sh). Runs against the shared dev
// database, so every test that perturbs a row puts it back.
describe("syncPermissions", () => {
  afterAll(() => prisma.$disconnect());

  const grantRow = (roleKey: string, permissionKey: string) =>
    prisma.rolePermission.findFirst({ where: { role: { key: roleKey }, permission: { key: permissionKey } } });

  it("makes the database match seed-data.ts, and is idempotent", async () => {
    const first = await syncPermissions(prisma);
    const second = await syncPermissions(prisma);
    expect(second.grants).toBe(first.grants);
    expect(second.revoked).toBe(0);

    for (const permission of permissions) {
      const row = await prisma.permission.findUnique({ where: { key: permission.key } });
      expect(row?.requiresMakerChecker).toBe(permission.requiresMakerChecker);
    }
    for (const [roleKey, grants] of Object.entries(rolePermissions)) {
      for (const [permissionKey, { canMaker = false, canChecker = false }] of Object.entries(grants)) {
        const row = await grantRow(roleKey, permissionKey);
        expect({ canMaker: row?.canMaker, canChecker: row?.canChecker }).toEqual({ canMaker, canChecker });
      }
    }
  }, 60000);

  it("registers the permissions this release's features depend on", async () => {
    await syncPermissions(prisma);
    for (const key of ["blog.publish", "staff.mfa_reset", "founder.mfa_reset"]) {
      expect((await prisma.permission.findUnique({ where: { key } }))?.requiresMakerChecker).toBe(true);
    }
  });

  it("re-creates a missing grant (the 'forgot to seed' case)", async () => {
    const row = await grantRow("platform_admin", "founder.mfa_reset");
    expect(row?.canMaker).toBe(true);
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: row!.roleId, permissionId: row!.permissionId } } });

    await syncPermissions(prisma);

    expect((await grantRow("platform_admin", "founder.mfa_reset"))?.canMaker).toBe(true);
  }, 60000);

  it("switches off a grant that's no longer in seed-data.ts, instead of leaving the old approval right in place", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "legal_adviser" } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "asset.dispose" } });
    expect(rolePermissions.legal_adviser?.["asset.dispose"]).toBeUndefined();
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: { canChecker: true },
      create: { roleId: role.id, permissionId: permission.id, canChecker: true },
    });

    try {
      const result = await syncPermissions(prisma);
      expect(result.revoked).toBeGreaterThanOrEqual(1);
      const after = await prisma.rolePermission.findUniqueOrThrow({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      });
      expect(after).toMatchObject({ canMaker: false, canChecker: false });
    } finally {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
    }
  }, 60000);

  it("never touches the bootstrap admin's password, agent keys, or staff-tuned values (the full seed does)", async () => {
    const currency = `ZT${Math.floor(Math.random() * 90 + 10)}`;
    await prisma.vaultDonorThreshold.create({ data: { currency, thresholdAmount: "12345" } });
    const admin = await prisma.user.findUnique({ where: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@birr.dev" } });
    const agentsBefore = await prisma.aiAgent.findMany({ select: { id: true, apiKeyHash: true }, orderBy: { id: "asc" } });
    const minimumsBefore = await prisma.contributionMinimum.findMany({ orderBy: { currency: "asc" } });

    try {
      await syncPermissions(prisma);

      expect((await prisma.vaultDonorThreshold.findUnique({ where: { currency } }))?.thresholdAmount.toString()).toBe("12345");
      if (admin) {
        expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash).toBe(admin.passwordHash);
      }
      expect(await prisma.aiAgent.findMany({ select: { id: true, apiKeyHash: true }, orderBy: { id: "asc" } })).toEqual(agentsBefore);
      expect(await prisma.contributionMinimum.findMany({ orderBy: { currency: "asc" } })).toEqual(minimumsBefore);
    } finally {
      await prisma.vaultDonorThreshold.deleteMany({ where: { currency } });
    }
  }, 60000);
});
