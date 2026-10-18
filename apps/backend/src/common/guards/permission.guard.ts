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

/**
 * `@RequiresAccess("vault.curate")` — the caller's role must hold this
 * plain access permission (seed-data.ts's accessPermissions). Replaced
 * every @RequiresStaffRole (2026-10-18): who may do what now lives in one
 * place, the roles/permissions tables, instead of role names scattered
 * across controllers. An access grant is stored as canMaker, so this is
 * the fixed-key maker check below under a name that reads correctly for
 * an action with no proposer/approver split.
 */
export const RequiresAccess = (permissionKey: string) => RequiresPermission("maker", permissionKey);

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
    // requireMfa: false — same reasoning as SessionAuthGuard: this
    // guard's own assertStaffMfa call right below is the exemption-aware
    // check.
    const birrStaff = await resolveBirrStaffFromSession(request, { requireMfa: false });
    assertStaffMfa(this.reflector, context, birrStaff);

    const permissionId = await this.resolveTargetPermissionId(request, fixedPermissionKey);

    // Eligible if ANY of the person's roles holds this side of the
    // permission (a staff member may hold several roles). The individual
    // maker != checker rule is still the database's checker_not_maker
    // constraint, which compares people, not roles.
    const grant = await prisma.rolePermission.findFirst({
      where: {
        permissionId,
        role: { key: { in: birrStaff.roles } },
        ...(side === "maker" ? { canMaker: true } : { canChecker: true }),
      },
      select: { roleId: true },
    });
    if (!grant) {
      throw new ForbiddenException(
        `None of your roles (${birrStaff.roles.join(", ")}) is eligible as ${side} for this permission.`,
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
