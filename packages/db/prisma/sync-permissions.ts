import type { PrismaClient } from "@prisma/client";
import { roles, permissions, rolePermissions } from "./seed-data";

// The code-defined half of seeding, on its own: which staff roles exist,
// which governed/ungoverned permissions exist, and the DEFAULT grant of
// each permission to each role (canMaker = may propose / may do;
// canChecker = may approve), all from seed-data.ts. A deploy that adds a
// permission is broken until its rows exist, so this runs on every deploy.
//
// Since 2026-10-18 the database, not this file, is the source of truth for
// grants: the Board can change them in the Ops Console (the governed
// role.permission_change action). So by default this only ADDS — new
// roles, new permissions, and a grant row for any role/permission pair
// that has none yet — and never changes or switches off an existing grant.
// A grant the Board removed stays as a row with both flags false, so it
// isn't re-added here. `{ reset: true }` (sync:permissions --reset) is the
// deliberate, explicit way back to exactly seed-data.ts.
//
// Deliberately NOT part of this: the bootstrap platform_admin (its
// password is reset on every full seed), the AI agents' API keys, and
// every staff-tunable value (contribution/corpus minimums, vault donor
// thresholds, cause categories, ledger account names). Re-running the full
// seed in production overwrites those; this never touches them, which is
// why it — not the full seed — runs on every deploy (see
// apps/backend/docker-entrypoint.sh).
//
// With `reset`, grants removed from seed-data.ts are switched off (both
// flags false), not deleted — the row itself is harmless history.
export async function syncPermissions(prisma: PrismaClient, { reset = false }: { reset?: boolean } = {}) {
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

      if (reset) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId } },
          update: { canMaker, canChecker },
          create: { roleId, permissionId, canMaker, canChecker },
        });
        grants++;
      } else {
        // Add-only: a row that already exists was either seeded earlier or
        // decided in the Ops Console — leave it exactly as it is.
        const created = await prisma.rolePermission.createMany({
          data: [{ roleId, permissionId, canMaker, canChecker }],
          skipDuplicates: true,
        });
        grants += created.count;
      }
    }
  }

  // Reset only: switch off any grant that exists in the database but is no
  // longer in seed-data.ts (only for roles/permissions this file defines).
  let revoked = 0;
  if (!reset) return { roles: roles.length, permissions: permissions.length, grants, revoked };
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
