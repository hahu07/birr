import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { prisma } from "@birr/db";
import {
  AuthenticatedBirrStaff,
  resolveBirrStaffFromSession,
} from "../auth/current-birr-staff";
import { assertStaffMfa } from "./mfa-exempt.decorator";

/**
 * Usage:
 *   @RequiresPermission('maker') / @RequiresPermission('checker')
 *     — governed_actions routes. The permission being acted on is
 *     resolved from the request itself: the existing GovernedAction's
 *     permissionId (via the :id route param) for decide, or
 *     body.permissionKey for propose.
 *   @RequiresPermission('maker', 'compliance.report_export')
 *     — ungoverned-but-gated routes (no propose/decide, just a direct
 *     read). The permission key is fixed here instead of resolved
 *     dynamically, since there's no request body or GovernedAction to
 *     resolve it from.
 *
 * This guard checks ROLE eligibility only (role_permissions.can_maker /
 * can_checker). It does NOT enforce the individual-level maker != checker
 * rule — that's the checker_not_maker DB constraint on governed_actions
 * (see packages/db/prisma/migrations/20260731201431_governed_actions_constraints/),
 * not something this guard can or should re-implement.
 *
 * Do not build a "canCheck" path into this guard for AI agents. Agent
 * requests should never reach a route this guard protects for a checker
 * action in the first place — see services/agents' tool allow-lists.
 */
export type PermissionSide = "maker" | "checker";

interface PermissionRequirement {
  side: PermissionSide;
  permissionKey?: string;
}

export const REQUIRES_PERMISSION_KEY = "requiresPermission";
export const RequiresPermission = (side: PermissionSide, permissionKey?: string) =>
  SetMetadata(REQUIRES_PERMISSION_KEY, { side, permissionKey } satisfies PermissionRequirement);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.get<PermissionRequirement>(
      REQUIRES_PERMISSION_KEY,
      context.getHandler(),
    );
    if (!requirement) return true;
    const { side, permissionKey: fixedPermissionKey } = requirement;

    const request = context.switchToHttp().getRequest<Request>();
    // requireMfa: false — same reasoning as SessionAuthGuard/
    // StaffRoleGuard: this guard's own assertStaffMfa call right below
    // is the exemption-aware check.
    const birrStaff = await resolveBirrStaffFromSession(request, { requireMfa: false });
    assertStaffMfa(this.reflector, context, birrStaff);

    const permissionId = await this.resolveTargetPermissionId(request, fixedPermissionKey);

    const role = await prisma.role.findUnique({
      where: { key: birrStaff.staffRole },
    });
    if (!role) {
      // Role/BirrStaffRole enum are meant to stay in sync by key — see the
      // comment on BirrStaffRole in schema.prisma. If this fires, the two
      // have drifted.
      throw new ForbiddenException(
        `No role_permissions entry for staff role "${birrStaff.staffRole}".`,
      );
    }

    const rolePermission = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
    });
    const eligible =
      side === "maker" ? rolePermission?.canMaker : rolePermission?.canChecker;
    if (!eligible) {
      throw new ForbiddenException(
        `Role "${birrStaff.staffRole}" is not eligible as ${side} for this permission.`,
      );
    }

    (request as Request & { birrStaff: AuthenticatedBirrStaff }).birrStaff =
      birrStaff;

    return true;
  }

  private async resolveTargetPermissionId(
    request: Request,
    fixedPermissionKey?: string,
  ): Promise<string> {
    if (fixedPermissionKey) {
      const permission = await prisma.permission.findUnique({
        where: { key: fixedPermissionKey },
      });
      if (!permission) {
        throw new ForbiddenException(`Unknown permission key "${fixedPermissionKey}".`);
      }
      return permission.id;
    }

    const governedActionId = request.params?.id;
    if (governedActionId) {
      const action = await prisma.governedAction.findUnique({
        where: { id: governedActionId },
      });
      if (!action) {
        throw new ForbiddenException(
          `No governed action found for id "${governedActionId}".`,
        );
      }
      return action.permissionId;
    }

    const permissionKey = (request.body as { permissionKey?: string })
      ?.permissionKey;
    if (!permissionKey) {
      throw new ForbiddenException("Request is missing permissionKey.");
    }
    const permission = await prisma.permission.findUnique({
      where: { key: permissionKey },
    });
    if (!permission) {
      throw new ForbiddenException(`Unknown permission key "${permissionKey}".`);
    }
    return permission.id;
  }
}
