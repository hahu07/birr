import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { BirrStaffRole } from "@birr/db";
import { AuthenticatedBirrStaff, resolveBirrStaffFromSession } from "../auth/current-birr-staff";
import { assertStaffMfa } from "./mfa-exempt.decorator";

/**
 * A plain "does this staff member hold this role" check — deliberately
 * NOT built on PermissionGuard/@RequiresPermission, which is entirely
 * shaped around governed_actions maker/checker eligibility
 * (RolePermission.canMaker/canChecker). Platform administration (e.g.
 * provider credential management) isn't a fiduciary action on waqf
 * assets in the CLAUDE.md sense — forcing it through that machinery
 * would conflate two different concepts. Follows this codebase's own
 * documented convention of using a route with no @RequiresPermission at
 * all when something isn't a governed_actions concept (see
 * invitations.controller.ts, conflict-of-interest-declarations.controller.ts,
 * waqf-case-assignments.controller.ts).
 */
export const REQUIRES_STAFF_ROLE_KEY = "requiresStaffRole";
// Accepts either one role or several — e.g. a route that's fine with
// "platform_admin" OR "mutawalli_officer" — normalized to an array below
// so every existing single-role call site keeps working unchanged.
export const RequiresStaffRole = (role: BirrStaffRole | BirrStaffRole[]) => SetMetadata(REQUIRES_STAFF_ROLE_KEY, role);

@Injectable()
export class StaffRoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.get<BirrStaffRole | BirrStaffRole[]>(REQUIRES_STAFF_ROLE_KEY, context.getHandler());
    if (!requiredRole) return true;
    const requiredRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

    const request = context.switchToHttp().getRequest<Request>();
    // requireMfa: false — this guard's own assertStaffMfa call right
    // below is the exemption-aware check; see
    // resolveBirrStaffFromSession's own comment on why its default
    // would preempt that.
    const staff = await resolveBirrStaffFromSession(request, { requireMfa: false });
    assertStaffMfa(this.reflector, context, staff);
    if (!requiredRoles.includes(staff.staffRole as BirrStaffRole)) {
      throw new ForbiddenException(`Requires one of the following roles: ${requiredRoles.join(", ")}.`);
    }

    (request as Request & { birrStaff: AuthenticatedBirrStaff }).birrStaff = staff;
    return true;
  }
}
