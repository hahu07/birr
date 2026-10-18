import { prisma } from "@birr/db";

/**
 * Whether a staff member's role holds `permissionKey` (an access grant, or
 * the maker side of a governed permission). For checks that can't be a
 * route decorator because they depend on the request's data — e.g.
 * caseload.view_all, which decides whether a caller sees every waqf or
 * only their assigned ones. Same tables PermissionGuard reads.
 */
export async function staffHasAccess(staff: { staffRole: string }, permissionKey: string): Promise<boolean> {
  const grant = await prisma.rolePermission.findFirst({
    where: { role: { key: staff.staffRole }, permission: { key: permissionKey }, canMaker: true },
    select: { roleId: true },
  });
  return grant !== null;
}

/** Every permission key the role holds — what GET /birr-staff/me reports to the Ops Console. */
export async function staffAccessKeys(staff: { staffRole: string }): Promise<string[]> {
  const grants = await prisma.rolePermission.findMany({
    where: { role: { key: staff.staffRole }, canMaker: true },
    select: { permission: { select: { key: true } } },
  });
  return grants.map((g) => g.permission.key).sort();
}
