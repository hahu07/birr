import { Injectable } from "@nestjs/common";
import { prisma } from "@birr/db";

@Injectable()
export class RolesService {
  /**
   * Every birr_staff role with its full permission grant set — the same
   * data PermissionGuard/GovernedActionsService check against, just read
   * back for display (Ops Console's Roles & Access page). Read-only here:
   * the one write path is the governed role.permission_change action
   * (proposed by platform_admin, approved by board_of_trustees — see
   * GovernedActionsService). seed-data.ts only supplies defaults for new
   * permissions; the database is the source of truth (sync-permissions).
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
