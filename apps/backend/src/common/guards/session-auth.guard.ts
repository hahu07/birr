import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { AuthenticatedBirrStaff, resolveBirrStaffFromSession } from "../auth/current-birr-staff";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Default-deny floor for every route in the app: requires a valid
 * Birr-staff session unless the route (or its whole controller) is
 * marked @Public(). Runs before PermissionGuard/StaffRoleGuard (see
 * providers order in app.module.ts) — those two guards keep
 * independently resolving staff for their own eligibility checks; this
 * guard's job is only to make "no guard metadata at all" mean "still
 * requires being signed in," not "wide open," which is what let 8+
 * controllers (assets, audit-logs, beneficiaries, birr-staff,
 * distributions, investments, waqf-causes, ai-agents, plus several
 * ungated read routes elsewhere) go unauthenticated before this guard
 * existed.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const staff = await resolveBirrStaffFromSession(request);
    (request as Request & { birrStaff: AuthenticatedBirrStaff }).birrStaff = staff;
    return true;
  }
}
