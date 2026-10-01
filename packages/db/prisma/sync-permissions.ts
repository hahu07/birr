import type { PrismaClient } from "@prisma/client";
import { roles, permissions, rolePermissions } from "./seed-data";

// The code-defined half of seeding, on its own: which staff roles exist,
// which governed/ungoverned permissions exist, and which role may propose
// (canMaker) or approve (canChecker) each. All of it lives in seed-data.ts,
// and the Ops Console's Roles & Access page is read-only — so the database
// copy must always equal this file, and a deploy that adds a permission
// (e.g. blog.publish, staff.mfa_reset, founder.mfa_reset) is broken until
// the rows exist.
//
// Deliberately NOT part of this: the bootstrap platform_admin (its
// password is reset on every full seed), the AI agents' API keys, and
// every staff-tunable value (contribution/corpus minimums, vault donor
// thresholds, cause categories, ledger account names). Re-running the full
// seed in production overwrites those; this never touches them, which is
// why it — not the full seed — runs on every deploy (see
// apps/backend/docker-entrypoint.sh).
//
// Grants removed from seed-data.ts are switched off (both flags false),
// not deleted: a role that loses an approval right must lose it in the
// database too, but the row itself is harmless history.
export async function syncPermissions(prisma: PrismaClient) {
  const roleIdByKey = new Map<string, string>();
  for (const role of roles) {
    const row = await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description },
      create: role,
    });
    roleIdByKey.set(role.key, row.id);
  }

  const permissionIdByKey = new Map<string, string>();
  for (const permission of permissions) {
    const row = await prisma.permission.upsert({
      where: { key: permission.key },
      update: {
        category: permission.category,
        description: permission.description,
        requiresMakerChecker: permission.requiresMakerChecker,
      },
      create: permission,
    });
    permissionIdByKey.set(permission.key, row.id);
  }

  let grants = 0;
  for (const [roleKey, roleGrants] of Object.entries(rolePermissions)) {
    const roleId = roleIdByKey.get(roleKey);
    if (!roleId) throw new Error(`Unknown role key in rolePermissions: ${roleKey}`);

    for (const [permissionKey, { canMaker = false, canChecker = false }] of Object.entries(roleGrants)) {
      const permissionId = permissionIdByKey.get(permissionKey);
      if (!permissionId) throw new Error(`Unknown permission key in rolePermissions: ${permissionKey}`);

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: { canMaker, canChecker },
        create: { roleId, permissionId, canMaker, canChecker },
      });
      grants++;
    }
  }

  // Switch off any grant that exists in the database but is no longer in
  // seed-data.ts (only for roles/permissions this file defines).
  let revoked = 0;
  const existing = await prisma.rolePermission.findMany({
    where: {
      roleId: { in: [...roleIdByKey.values()] },
      permissionId: { in: [...permissionIdByKey.values()] },
      OR: [{ canMaker: true }, { canChecker: true }],
    },
    include: { role: { select: { key: true } }, permission: { select: { key: true } } },
  });
  for (const row of existing) {
    if (rolePermissions[row.role.key]?.[row.permission.key]) continue;
    await prisma.rolePermission.update({
      where: { roleId_permissionId: { roleId: row.roleId, permissionId: row.permissionId } },
      data: { canMaker: false, canChecker: false },
    });
    revoked++;
  }

  return { roles: roles.length, permissions: permissions.length, grants, revoked };
}
