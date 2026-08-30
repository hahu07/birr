import { Injectable } from "@nestjs/common";
import { prisma } from "@birr/db";

@Injectable()
export class RolesService {
  /**
   * Every birr_staff role with its full permission grant set — the same
   * data PermissionGuard/GovernedActionsService check against, just read
   * back for display (Ops Console's Roles & Access page). Read-only:
   * roles/permissions/role_permissions have no write path here or
   * anywhere else in the API — they're seeded (packages/db/prisma/
   * seed-data.ts) and change by editing that file, not through this app.
   */
  list() {
    return prisma.role.findMany({
      orderBy: { name: "asc" },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });
  }
}
